#!/usr/bin/env python3
"""Biblioteca médica de NOVA: descarga las fuentes del catálogo, extrae el texto, lo divide en fragmentos y los
vectoriza con el modelo de búsqueda local (llama.cpp --embedding, nomic-embed-text-v2-moe).

Esto corre en la Tierra (o al preparar la nave). Lo que sube a la nave es la carpeta de salida:
  catalogo.json      fuentes con licencia, fecha y huella SHA-256
  fragmentos.jsonl   un fragmento por línea: {i, fuente, pagina, seccion, texto}
  vectores.f32       matriz float32 normalizada (n × dim), en el mismo orden

Uso: .venv/bin/python indexar.py [--solo id1,id2] [--rehacer] [--salida ~/.nova-pc/biblioteca]
Las fuentes que no cambiaron (misma huella SHA-256) reusan sus vectores: agregar una fuente solo vectoriza la nueva.
"""

import argparse
import hashlib
import html
import json
import os
import re
import struct
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO

from pypdf import PdfReader

AQUI = os.path.dirname(os.path.abspath(__file__))
EMBED = os.environ.get("NOVA_EMBED", "http://127.0.0.1:8084")
TAM = 900        # caracteres por fragmento
SOLAPE = 150     # caracteres que se repiten entre fragmentos vecinos
LOTE = 32


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def ultimo_medlineplus():
    """El archivo de MedlinePlus cambia de nombre cada día: se busca el comprimido más reciente"""
    pagina = urllib.request.urlopen(urllib.request.Request("https://medlineplus.gov/xml.html", headers={"User-Agent": "NOVA-biblioteca/0.1"}), timeout=60).read().decode("utf-8", "ignore")
    enlaces = sorted(set(re.findall(r"https://medlineplus\.gov/xml/mplus_topics_compressed_\d{4}-\d{2}-\d{2}\.zip", pagina)))
    if not enlaces:
        raise RuntimeError("no encontré el archivo de MedlinePlus")
    return enlaces[-1]


def descargar(f, carpeta):
    if f["url"] == "ULTIMO_MEDLINEPLUS":
        f["url"] = ultimo_medlineplus()
    ext = {"pdf": "pdf", "xml": "xml", "zip": "zip", "html": "html"}.get(f["formato"], "bin")
    ruta = os.path.join(carpeta, f"{f['id']}.{ext}")
    if not os.path.exists(ruta):
        log(f"  bajando {f['id']} …")
        pedido = urllib.request.Request(f["url"], headers={"User-Agent": "NOVA-biblioteca/0.1 (hackathon prototype)"})
        with urllib.request.urlopen(pedido, timeout=180) as r, open(ruta + ".tmp", "wb") as o:
            o.write(r.read())
        os.replace(ruta + ".tmp", ruta)
    datos = open(ruta, "rb").read()
    return ruta, datos, hashlib.sha256(datos).hexdigest()


# ---------------------------------------------------------------- extracción

TITULO = re.compile(r"^(\d+(\.\d+)*\.?\s+)?[A-Z][A-Za-z0-9 ,:;()'’\-/&]{3,90}$")


def limpiar(t):
    t = t.replace("­", "").replace("ﬁ", "fi").replace("ﬂ", "fl")
    t = re.sub(r"-\n(?=[a-z])", "", t)          # palabras cortadas al final de línea
    t = re.sub(r"[ \t]+", " ", t)
    return t


def paginas_pdf(datos):
    lector = PdfReader(BytesIO(datos))
    for n, p in enumerate(lector.pages, 1):
        try:
            yield n, limpiar(p.extract_text() or "")
        except Exception:
            continue


def paginas_medlineplus(datos):
    """MedlinePlus health topics: cada tema es una «página» con su título como sección"""
    if datos[:2] == b"PK":
        with zipfile.ZipFile(BytesIO(datos)) as z:
            datos = z.read(z.namelist()[0])
    raiz = ET.fromstring(datos)
    for n, tema in enumerate(raiz.iter("health-topic"), 1):
        if tema.get("language") != "English":
            continue
        resumen = tema.findtext("full-summary") or ""
        texto = re.sub(r"<[^>]+>", " ", html.unescape(resumen))
        yield n, f"{tema.get('title')}\n{limpiar(texto)}"


def paginas_html(datos):
    t = datos.decode("utf-8", "ignore")
    t = re.sub(r"(?is)<(script|style|nav|header|footer).*?</\1>", " ", t)
    t = re.sub(r"(?i)<(br|p|div|h\d|li|tr)[^>]*>", "\n", t)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    yield 1, limpiar(t)


def fragmentar(fuente, paginas):
    """Fragmentos de ~TAM caracteres respetando párrafos; recuerda la última sección vista"""
    seccion = ""
    for pagina, texto in paginas:
        lineas = [l.strip() for l in texto.split("\n")]
        parrafos, actual = [], []
        for l in lineas:
            if not l:
                if actual:
                    parrafos.append(" ".join(actual))
                    actual = []
                continue
            if TITULO.match(l) and len(l) < 90 and not l.endswith("."):
                if actual:
                    parrafos.append(" ".join(actual))
                    actual = []
                parrafos.append(("§", l))
                continue
            actual.append(l)
        if actual:
            parrafos.append(" ".join(actual))
        buf = ""
        for p in parrafos:
            if isinstance(p, tuple):
                seccion = p[1]
                continue
            if len(buf) + len(p) > TAM and len(buf) > 200:
                yield {"fuente": fuente, "pagina": pagina, "seccion": seccion, "texto": buf.strip()}
                buf = buf[-SOLAPE:] + " "
            buf += p + " "
            while len(buf) > TAM * 1.6:   # párrafos enormes
                yield {"fuente": fuente, "pagina": pagina, "seccion": seccion, "texto": buf[:TAM].strip()}
                buf = buf[TAM - SOLAPE:]
        if len(buf.strip()) > 120:
            yield {"fuente": fuente, "pagina": pagina, "seccion": seccion, "texto": buf.strip()}


REF = re.compile(r"\[\d{1,3}\]\s+[A-Z]|et al\.|doi[:\s]|\b(19|20)\d{2}[;:)]|\b\d+\(\d+\):|https?://|PMID", re.I)


def es_bibliografia(t):
    """Listas de referencias: muchas citas por cada mil caracteres. No sirven para responder."""
    return len(REF.findall(t)) * 1000 / max(len(t), 1) > 6


def vectorizar(textos):
    pedido = urllib.request.Request(f"{EMBED}/v1/embeddings", data=json.dumps({"input": textos}).encode(),
                                    headers={"content-type": "application/json"})
    with urllib.request.urlopen(pedido, timeout=300) as r:
        datos = json.loads(r.read())["data"]
    salida = []
    for d in sorted(datos, key=lambda x: x["index"]):
        v = d["embedding"]
        n = sum(x * x for x in v) ** 0.5 or 1.0
        salida.append([x / n for x in v])
    return salida


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalogo", default=os.path.join(AQUI, "fuentes.json"))
    ap.add_argument("--salida", default=os.path.expanduser("~/.nova-pc/biblioteca"))
    ap.add_argument("--solo", default="")
    ap.add_argument("--rehacer", action="store_true", help="vectorizar todo de nuevo, aunque la fuente no haya cambiado")
    a = ap.parse_args()
    fuentes = [f for f in json.load(open(a.catalogo)) if f.get("usar", True)]
    if a.solo:
        fuentes = [f for f in fuentes if f["id"] in a.solo.split(",")]
    crudos = os.path.join(a.salida, "fuentes")
    os.makedirs(crudos, exist_ok=True)

    # lo ya indexado: si una fuente no cambió (misma huella), se reusan sus fragmentos y vectores
    previo = {}
    if not a.rehacer:
        try:
            cat0 = json.load(open(os.path.join(a.salida, "catalogo.json")))
            frs0 = [json.loads(l) for l in open(os.path.join(a.salida, "fragmentos.jsonl"))]
            with open(os.path.join(a.salida, "vectores.f32"), "rb") as v:
                n0, d0 = struct.unpack("<II", v.read(8))
                vec0 = [list(struct.unpack(f"<{d0}f", v.read(4 * d0))) for _ in range(n0)]
            if len(frs0) == n0:
                for c in cat0["fuentes"]:
                    previo[c["id"]] = {"sha256": c["sha256"], "items": []}
                for fr, vv in zip(frs0, vec0):
                    if fr["fuente"] in previo:
                        previo[fr["fuente"]]["items"].append(({k: fr[k] for k in fr if k != "i"}, vv))
        except (OSError, ValueError, KeyError, struct.error):
            previo = {}

    catalogo, fragmentos, vectores = [], [], []
    for f in fuentes:
        try:
            ruta, datos, huella = descargar(f, crudos)
        except Exception as e:
            log(f"  ✗ {f['id']}: no se pudo bajar ({e})")
            continue
        p0 = previo.get(f["id"])
        if p0 and p0["sha256"] == huella and p0["items"]:
            fragmentos += [x for x, _ in p0["items"]]
            vectores += [vv for _, vv in p0["items"]]
            log(f"  = {f['id']}: {len(p0['items'])} fragmentos (sin cambios)")
            catalogo.append({**{k: f[k] for k in f if k != "usar"}, "sha256": huella, "fragmentos": len(p0["items"]),
                             "indexado": next((c.get("indexado") for c in cat0["fuentes"] if c["id"] == f["id"]), time.strftime("%Y-%m-%d"))})
            continue
        if f["formato"] == "pdf":
            paginas = paginas_pdf(datos)
        elif f["id"].startswith("medlineplus"):
            paginas = paginas_medlineplus(datos)
        else:
            paginas = paginas_html(datos)
        try:
            todos = list(fragmentar(f["id"], paginas))
        except Exception as e:
            log(f"  ✗ {f['id']}: no se pudo leer ({e})")
            continue
        propios = [x for x in todos if not es_bibliografia(x["texto"])]
        if len(todos) != len(propios):
            log(f"    ({len(todos) - len(propios)} fragmentos de bibliografía descartados)")
        log(f"  ✓ {f['id']}: {len(propios)} fragmentos")
        fragmentos += propios
        vectores += [None] * len(propios)
        catalogo.append({**{k: f[k] for k in f if k != "usar"}, "sha256": huella, "fragmentos": len(propios),
                         "indexado": time.strftime("%Y-%m-%d")})

    faltan = [i for i, v in enumerate(vectores) if v is None]
    log(f"vectorizando {len(faltan)} fragmentos nuevos (de {len(fragmentos)}) …")
    t0 = time.time()
    for j in range(0, len(faltan), LOTE):
        idx = faltan[j:j + LOTE]
        textos = [f"search_document: {fragmentos[i]['seccion']}. {fragmentos[i]['texto']}"[:1100] for i in idx]
        try:
            nuevos = vectorizar(textos)
        except urllib.error.HTTPError:
            # el modelo acepta hasta 512 tokens: de a uno, acortando si hace falta (el fragmento completo se guarda igual)
            nuevos = []
            for t in textos:
                for largo in (1100, 800, 500, 300):
                    try:
                        nuevos += vectorizar([t[:largo]])
                        break
                    except urllib.error.HTTPError:
                        continue
                else:
                    raise RuntimeError("no se pudo vectorizar un fragmento")
        for i, v in zip(idx, nuevos):
            vectores[i] = v
        if j // LOTE % 20 == 0:
            log(f"  {j + len(idx)}/{len(faltan)} ({time.time() - t0:.0f}s)")

    dim = len(vectores[0]) if vectores else 0
    with open(os.path.join(a.salida, "vectores.f32.tmp"), "wb") as o:
        o.write(struct.pack("<II", len(vectores), dim))
        for v in vectores:
            o.write(struct.pack(f"<{dim}f", *v))
    with open(os.path.join(a.salida, "fragmentos.jsonl.tmp"), "w") as o:
        for i, f in enumerate(fragmentos):
            o.write(json.dumps({"i": i, **f}, ensure_ascii=False) + "\n")
    json.dump({"version": time.strftime("%Y-%m-%d %H:%M"), "modelo": "nomic-embed-text-v2-moe Q4_K_M", "dim": dim,
               "fuentes": catalogo}, open(os.path.join(a.salida, "catalogo.json.tmp"), "w"), ensure_ascii=False, indent=2)
    for n in ("vectores.f32", "fragmentos.jsonl", "catalogo.json"):
        os.replace(os.path.join(a.salida, n + ".tmp"), os.path.join(a.salida, n))
    log(f"listo: {len(fragmentos)} fragmentos de {len(catalogo)} fuentes, dim {dim}")


if __name__ == "__main__":
    main()
