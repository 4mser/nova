"""Segunda pasada de la bibliografía: OpenAlex (y arXiv de respaldo) para lo que Crossref no resolvió.

DBLP quedó detrás de una verificación anti-bots, así que no sirve desde un script. Mismas reglas de aceptación que
resolver_bib.py: título (>= 0,90), apellido del primer autor y año (±1). Si la obra tiene DOI, el BibTeX se baja de
doi.org; si no, se arma con los metadatos de OpenAlex o arXiv, sin agregar nada de memoria. También guarda los
resúmenes (abstract) de todas las obras, para contrastar lo que el informe dice de cada una.

Uso: python resolver_bib2.py <crudas.bib> <registro.tsv> <salida.bib> <resumenes.json>
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
from resolver_bib import SEMILLAS, apellido_en, get, norm, recodificar, sim  # noqa: E402

# Sede exigida cuando la primera coincidencia suele ser una reimpresión (capítulo de libro, etc.)
SEDE = {"caruana1997": "machine learning", "ganin2016": "journal of machine learning research"}
OA = "https://api.openalex.org/works"


def oa_busca(titulo: str):
    q = urllib.parse.urlencode({"filter": "title.search:" + re.sub(r"[,:;?]", " ", titulo), "per-page": 15,
                                "select": "id,doi,title,publication_year,authorships,primary_location,type,biblio,"
                                          "locations,abstract_inverted_index,ids"})
    return json.loads(get(OA + "?" + q))["results"]


def abstract(inv: dict | None) -> str:
    if not inv:
        return ""
    pos = {p: w for w, ps in inv.items() for p in ps}
    return " ".join(pos[i] for i in sorted(pos))


def sede_de(w: dict) -> str:
    src = (w.get("primary_location") or {}).get("source") or {}
    return src.get("display_name") or ""


def oa_elegir(clave: str, titulo: str, apellido: str, anio: int, obras: list[dict]):
    cands = []
    for w in obras:
        autores = [a["author"]["display_name"] for a in w.get("authorships", [])]
        y = w.get("publication_year") or 0
        s = sim(titulo, w.get("title") or "")
        sedes = " | ".join(sede_de({"primary_location": l}) for l in w.get("locations", []) if l) + " " + sede_de(w)
        if s < 0.90 or not apellido_en(apellido, autores) or abs(y - anio) > 1:
            continue
        if clave in SEDE and SEDE[clave] not in sedes.lower():
            continue
        arxiv = "arxiv" in sede_de(w).lower()
        cands.append((not arxiv, bool(w.get("doi")), s, w))
    if not cands:
        return None
    cands.sort(key=lambda c: (c[0], c[1], c[2]), reverse=True)
    return cands[0][3]


def esc(s: str) -> str:
    return s.replace("&", r"\&").replace("%", r"\%").replace("#", r"\#")


def bib_desde_oa(clave: str, w: dict) -> str:
    autores = " and ".join(a["author"]["display_name"] for a in w.get("authorships", []))
    src = (w.get("primary_location") or {}).get("source") or {}
    sede, tipo_src = src.get("display_name") or "", src.get("type") or ""
    b = w.get("biblio") or {}
    paginas = "--".join(x for x in (b.get("first_page"), b.get("last_page")) if x)
    campos = {"author": autores, "title": "{" + esc(w["title"]) + "}", "year": str(w["publication_year"])}
    if "arxiv" in sede.lower():
        tipo = "misc"
        arx = (w.get("ids") or {}).get("arxiv") or ""
        m = re.search(r"(\d{4}\.\d{4,5})", json.dumps(w.get("locations", [])))
        if m:
            campos.update(eprint=m.group(1), eprinttype="arxiv")
        campos["howpublished"] = "arXiv"
    elif tipo_src == "journal":
        tipo = "article"
        campos.update(journal=esc(sede), volume=b.get("volume") or "", number=b.get("issue") or "", pages=paginas)
    elif tipo_src in ("conference", "repository") or w.get("type") in ("proceedings-article",):
        tipo = "inproceedings"
        campos.update(booktitle=esc(sede), pages=paginas)
    elif w.get("type") == "book":
        tipo = "book"
        campos["publisher"] = esc(src.get("host_organization_name") or "")
    else:
        tipo = "inproceedings" if sede else "misc"
        if sede:
            campos["booktitle"] = esc(sede)
        campos["pages"] = paginas
    cuerpo = ",\n".join(f"  {k} = {{{v}}}" if not v.startswith("{") else f"  {k} = {v}"
                        for k, v in campos.items() if v)
    return f"@{tipo}{{{clave},\n{cuerpo},\n  note = {{Metadatos de OpenAlex {w['id'].rsplit('/', 1)[-1]}}}\n}}"


def arxiv_busca(titulo: str, apellido: str, anio: int):
    q = urllib.parse.urlencode({"search_query": f'ti:"{re.sub(r"[^A-Za-z0-9 -]", " ", titulo)}"', "max_results": 10})
    xml = get("http://export.arxiv.org/api/query?" + q)
    ns = {"a": "http://www.w3.org/2005/Atom"}
    for e in ET.fromstring(xml).findall("a:entry", ns):
        t = " ".join(e.find("a:title", ns).text.split())
        autores = [a.find("a:name", ns).text for a in e.findall("a:author", ns)]
        y = int(e.find("a:published", ns).text[:4])
        if sim(titulo, t) >= 0.90 and apellido_en(apellido, autores) and abs(y - anio) <= 1:
            ident = e.find("a:id", ns).text.rsplit("/abs/", 1)[-1].split("v")[0]
            resumen = " ".join(e.find("a:summary", ns).text.split())
            return ident, t, autores, y, resumen
    return None


def main() -> None:
    crudas, registro, salida, resumenes = sys.argv[1:5]
    ok_previas = {}
    for bloque in open(crudas, encoding="utf-8").read().split("\n\n"):
        m = re.match(r"@\w+\{([^,]+),", bloque.strip())
        if m:
            ok_previas[m.group(1)] = bloque.strip()
    rehacer = set(SEDE)  # coincidencias de Crossref que eran la versión equivocada
    entradas, filas, res = {}, ["clave\tfuente\testado\tsimilitud\tid\ttitulo\tanio\tsede"], {}
    for clave, _, titulo, apellido, anio in SEMILLAS:
        if clave in ok_previas and clave not in rehacer:
            entradas[clave] = ok_previas[clave]
            doi = re.search(r"doi\s*=\s*\{([^}]+)\}", ok_previas[clave], re.I)
            filas.append(f"{clave}\tcrossref\tok\t\t{doi.group(1) if doi else ''}\t\t\t")
            # resumen por DOI
            if doi:
                try:
                    w = json.loads(get(OA + "/doi:" + urllib.parse.quote(doi.group(1))))
                    res[clave] = {"titulo": w.get("title"), "resumen": abstract(w.get("abstract_inverted_index"))}
                except Exception as e:  # noqa: BLE001
                    res[clave] = {"titulo": titulo, "resumen": "", "error": repr(e)}
                time.sleep(0.3)
            continue
        hecho = None
        try:
            w = oa_elegir(clave, titulo, apellido, anio, oa_busca(titulo))
        except Exception as e:  # noqa: BLE001
            w = None
            filas.append(f"{clave}\topenalex\terror\t\t\t{e!r}\t\t")
        time.sleep(0.4)
        if w:
            doi = (w.get("doi") or "").replace("https://doi.org/", "")
            bib = None
            if doi and "arxiv" not in doi.lower():
                try:
                    bib = recodificar(get("https://doi.org/" + urllib.parse.quote(doi),
                                          accept="application/x-bibtex; charset=utf-8"), clave)
                except Exception:  # noqa: BLE001
                    bib = None
            bib = bib or bib_desde_oa(clave, w)
            entradas[clave] = bib
            res[clave] = {"titulo": w.get("title"), "resumen": abstract(w.get("abstract_inverted_index"))}
            hecho = f"{clave}\topenalex\tok\t{sim(titulo, w['title']):.3f}\t{doi or w['id']}\t{w['title']}\t" \
                    f"{w['publication_year']}\t{sede_de(w)}"
        else:
            try:
                a = arxiv_busca(titulo, apellido, anio)
            except Exception as e:  # noqa: BLE001
                a = None
                filas.append(f"{clave}\tarxiv\terror\t\t\t{e!r}\t\t")
            time.sleep(3.0)
            if a:
                ident, t, autores, y, resumen = a
                entradas[clave] = (f"@misc{{{clave},\n  author = {{{' and '.join(autores)}}},\n  title = {{{{{esc(t)}}}}},\n"
                                   f"  year = {{{y}}},\n  eprint = {{{ident}}},\n  eprinttype = {{arxiv}},\n"
                                   f"  howpublished = {{arXiv}},\n  note = {{Metadatos de arXiv}}\n}}")
                res[clave] = {"titulo": t, "resumen": resumen}
                hecho = f"{clave}\tarxiv\tok\t{sim(titulo, t):.3f}\t{ident}\t{t}\t{y}\tarXiv"
        if hecho:
            filas.append(hecho)
            print("ok", hecho.split("\t")[1], clave, flush=True)
        else:
            filas.append(f"{clave}\t-\tNO RESUELTA\t\t\t{titulo}\t{anio}\t")
            print("NO", clave, flush=True)
    with open(salida, "w", encoding="utf-8") as fh:
        fh.write("% Generado por herramientas/resolver_bib.py y resolver_bib2.py (Crossref, OpenAlex, arXiv).\n\n")
        fh.write("\n\n".join(entradas[c] for c, *_ in SEMILLAS if c in entradas) + "\n")
    with open(registro, "w", encoding="utf-8") as fh:
        fh.write("\n".join(filas) + "\n")
    with open(resumenes, "w", encoding="utf-8") as fh:
        json.dump(res, fh, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
