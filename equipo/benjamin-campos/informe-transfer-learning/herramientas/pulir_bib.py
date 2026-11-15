"""Pule referencias_resueltas.bib y escribe generado/referencias.bib.

- Entradas armadas desde OpenAlex: completa autores y sede con Semantic Scholar (misma regla de coincidencia).
- Entradas de Crossref sin título o sin autores/editores: completa desde el JSON de Crossref del mismo DOI.
- Reintenta en arXiv las que faltan con el año del preprint.
- Agrega `keywords` por tema para dividir la bibliografía, y dos fuentes web comprobadas con una petición HEAD.

Uso: python pulir_bib.py <resueltas.bib> <salida.bib> <registro.tsv>
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
from resolver_bib import SEMILLAS, UA, apellido_en, get, sim  # noqa: E402
from resolver_bib2 import arxiv_busca, esc  # noqa: E402

TEMAS = {
    "historia": "thorndike1901 bozinovski2020 pratt1991 pratt1993 thrun1996 caruana1997 thrun1998 baxter2000 "
                "shimodaira2000 hinton2006dbn hinton2006science bengio2007 raina2007 dai2007 erhan2010 pan2010 "
                "bendavid2010 bengio2012 donahue2014 oquab2014 razavian2014 girshick2014 yosinski2014 weiss2016 "
                "ganin2016 mccloskey1989 kirkpatrick2017 tan2018 zhuang2021",
    "ajuste": "ioffe2015 li2018adabn schneider2020 vaswani2017 howard2018 devlin2019 houlsby2019 he2019 raghu2019 "
              "kornblith2019 neyshabur2020 dodge2020 bommasani2021 hu2022 kumar2022 lee2023 srivastava2014 "
              "kingma2015 loshchilov2019 prechelt1998",
    "series": "fawaz2018 oreshkin2021 zeng2023 nie2023 rasul2023 ansari2024 das2024 woo2024 goswami2024 ansari2025 "
              "hyndman2006",
    "estadistica": "hoerl1970 efron1979 efron1993 field2007 vovk2005 lei2018 nelson1984 page1954 saeb2017 kapoor2023 "
                   "benjamini1995 bouthillier2021",
    "fisiologia": "pavy2007 hargens2016 meck2009 platts2009 hughson2018 norsk2020 stahn2017 garrettbakelman2019 "
                  "overbey2024 yfantidou2022 li2017 mishra2020 lsda",
    "software": "paszke2019 wolf2020 pedregosa2011 harris2020 virtanen2020 mckinney2010 spaceapps",
}
TEMA_DE = {k: t for t, ks in TEMAS.items() for k in ks.split()}
WEB = {
    "lsda": ("NASA Life Sciences Data Archive", "https://lsda.jsc.nasa.gov/", "NASA"),
    "spaceapps": ("NASA International Space Apps Challenge", "https://www.spaceappschallenge.org/", "NASA"),
}
REINTENTAR = {"loshchilov2019": ("Decoupled weight decay regularization", "Loshchilov", 2017)}


def entradas(texto: str) -> dict[str, str]:
    out = {}
    for m in re.finditer(r"@(\w+)\s*\{\s*([^,\s]+)\s*,", texto):
        ini = m.start()
        prof, i = 0, texto.index("{", ini)
        for j in range(i, len(texto)):
            prof += texto[j] == "{"
            prof -= texto[j] == "}"
            if prof == 0:
                out[m.group(2)] = texto[ini:j + 1]
                break
    return out


def campo(bib: str, nombre: str) -> str | None:
    m = re.search(r"(?<![a-z])" + nombre + r"\s*=\s*\{", bib, re.I)
    if not m:
        return None
    prof, i = 1, m.end()
    for j in range(i, len(bib)):
        prof += bib[j] == "{"
        prof -= bib[j] == "}"
        if prof == 0:
            return bib[i:j]
    return None


def poner(bib: str, nombre: str, valor: str) -> str:
    """Agrega o reemplaza un campo antes de la llave final."""
    actual = campo(bib, nombre)
    if actual is not None:
        return bib.replace(f"{actual}", valor, 1) if actual else bib
    return bib.rstrip()[:-1].rstrip().rstrip(",") + f",\n  {nombre} = {{{valor}}}\n}}"


def s2(titulo: str, apellido: str, anio: int):
    q = urllib.parse.urlencode({"query": titulo, "fields": "title,year,authors,venue,journal,externalIds,publicationVenue"})
    for espera in (4, 8, 16, 32, 60):
        try:
            r = json.loads(get("https://api.semanticscholar.org/graph/v1/paper/search/match?" + q))
            break
        except Exception:  # noqa: BLE001
            time.sleep(espera)
    else:
        return None
    for p in r.get("data", []):
        autores = [a["name"] for a in p.get("authors", [])]
        if sim(titulo, p.get("title", "")) >= 0.90 and apellido_en(apellido, autores) and abs((p.get("year") or 0) - anio) <= 1:
            return p
    return None


def rehacer_desde_s2(clave: str, bib: str, p: dict) -> str:
    autores = " and ".join(a["name"] for a in p["authors"])
    j = p.get("journal") or {}
    venue = (p.get("publicationVenue") or {}).get("name") or p.get("venue") or ""
    ext = p.get("externalIds") or {}
    anio = campo(bib, "year") or str(p.get("year"))
    campos = {"author": autores, "title": "{" + esc(p["title"]) + "}", "year": anio}
    pv_tipo = (p.get("publicationVenue") or {}).get("type") or ""
    if j.get("name") and pv_tipo == "journal" and "arxiv" not in j["name"].lower():
        tipo = "article"
        campos.update(journal=esc(j["name"]), volume=j.get("volume", "").strip(), pages=(j.get("pages") or "").strip().replace("-", "--"))
    elif venue and "arxiv" not in venue.lower():
        tipo = "inproceedings"
        campos.update(booktitle=esc(venue), pages=(j.get("pages") or "").strip().replace("-", "--"))
    else:
        tipo = "misc"
        campos["howpublished"] = "arXiv"
    if ext.get("ArXiv"):
        campos.update(eprint=ext["ArXiv"], eprinttype="arxiv")
    if ext.get("DOI") and "arxiv" not in ext["DOI"].lower():
        campos["doi"] = ext["DOI"]
    cuerpo = ",\n".join(f"  {k} = {v}" if v.startswith("{") else f"  {k} = {{{v}}}" for k, v in campos.items() if v)
    return f"@{tipo}{{{clave},\n{cuerpo}\n}}"


def crossref_json(doi: str) -> dict:
    return json.loads(get("https://api.crossref.org/works/" + urllib.parse.quote(doi)))["message"]


def nombres(lista: list[dict]) -> str:
    return " and ".join(f"{a.get('family', '')}, {a.get('given', '')}".strip(", ") for a in lista)


def autores_openalex(doi: str) -> str:
    """Autores desde OpenAlex, para libros cuyo registro de Crossref no los trae (p. ej. 10.1007/b106715)."""
    w = json.loads(get("https://api.openalex.org/works/doi:" + urllib.parse.quote(doi)))
    lista = []
    for a in w.get("authorships", []):
        partes = a["author"]["display_name"].rsplit(" ", 1)
        lista.append(f"{partes[1]}, {partes[0]}" if len(partes) == 2 else partes[0])
    return " and ".join(lista)


def quitar_mes(bib: str) -> str:
    """Crossref escribe `month=June`, `July` o `Sept`, que biber no reconoce; el estilo autor-año solo usa el año."""
    return re.sub(r",\s*month\s*=\s*\{?[A-Za-z]+\}?(?=\s*[,}])", "", bib)


def escapar_ampersand(bib: str) -> str:
    """Crossref de ACM trae `series = {ICML ’07 & ILP ’07}`; un & sin escapar rompe la bibliografía en LaTeX."""
    return re.sub(r"(?<!\\)&", r"\\&", bib)


def main() -> None:
    entrada, salida, registro = sys.argv[1:4]
    E = entradas(open(entrada, encoding="utf-8").read())
    semilla = {k: (t, a, y) for k, _, t, a, y in SEMILLAS}
    log = ["clave\taccion\tdetalle"]
    for clave, args in REINTENTAR.items():
        if clave in E:
            continue
        a = arxiv_busca(*args)
        time.sleep(3)
        if a:
            ident, t, autores, y, _ = a
            E[clave] = (f"@misc{{{clave},\n  author = {{{' and '.join(autores)}}},\n  title = {{{{{esc(t)}}}}},\n"
                        f"  year = {{{y}}},\n  eprint = {{{ident}}},\n  eprinttype = {{arxiv}},\n  howpublished = {{arXiv}}\n}}")
            log.append(f"{clave}\tarxiv\t{ident} {t} {y}")
        else:
            log.append(f"{clave}\tNO RESUELTA\t{args}")
    for clave, bib in list(E.items()):
        if "Metadatos de OpenAlex" in bib and clave in semilla:
            t, ap, y = semilla[clave]
            p = s2(t, ap, y)
            time.sleep(3.5)
            if p:
                E[clave] = rehacer_desde_s2(clave, bib, p)
                log.append(f"{clave}\ts2\t{p.get('title')} | {p.get('venue')} | {(p.get('journal') or {}).get('name')}")
            else:
                E[clave] = re.sub(r",\s*note = \{Metadatos de OpenAlex [^}]*\}", "", bib)
                log.append(f"{clave}\topenalex (sin s2)\t")
        doi = campo(E[clave], "doi")
        falta_t = not campo(E[clave], "title")
        falta_a = not campo(E[clave], "author") and not campo(E[clave], "editor")
        if doi and (falta_t or falta_a):
            w = crossref_json(doi)
            time.sleep(1)
            if falta_t and w.get("title"):
                E[clave] = poner(E[clave], "title", "{" + esc(w["title"][0]) + "}")
            if falta_a:
                if w.get("author"):
                    E[clave] = poner(E[clave], "author", nombres(w["author"]))
                elif w.get("editor"):
                    E[clave] = poner(E[clave], "editor", nombres(w["editor"]))
                elif autores := autores_openalex(doi):
                    E[clave] = poner(E[clave], "author", autores)
            log.append(f"{clave}\tcrossref-json\ttitulo={falta_t} autores={falta_a}")
    for clave, (titulo, url, org) in WEB.items():
        try:
            req = urllib.request.Request(url, headers=UA, method="HEAD")
            with urllib.request.urlopen(req, timeout=30) as r:
                estado = r.status
        except Exception as e:  # noqa: BLE001
            estado = repr(e)
        log.append(f"{clave}\tweb\t{url} -> {estado}")
        if estado == 200:
            E[clave] = (f"@online{{{clave},\n  title = {{{titulo}}},\n  organization = {{{org}}},\n  url = {{{url}}},\n"
                        f"  urldate = {{2026-11-14}}\n}}")
    piezas = []
    for clave, bib in E.items():
        bib = re.sub(r",?\s*url\s*=\s*\{http://dx\.doi\.org/[^}]*\}", "", bib)
        bib = quitar_mes(escapar_ampersand(bib))
        if clave in TEMA_DE:
            bib = poner(bib, "keywords", TEMA_DE[clave])
        else:
            log.append(f"{clave}\tsin tema\t")
        piezas.append(bib)
    with open(salida, "w", encoding="utf-8") as fh:
        fh.write("% Generado por herramientas/resolver_bib.py, resolver_bib2.py y pulir_bib.py.\n"
                 "% Fuentes: Crossref, OpenAlex, Semantic Scholar y arXiv. No editar a mano.\n\n")
        fh.write("\n\n".join(piezas) + "\n")
    with open(registro, "w", encoding="utf-8") as fh:
        fh.write("\n".join(log) + "\n")
    print(len(piezas), "entradas")


if __name__ == "__main__":
    main()
