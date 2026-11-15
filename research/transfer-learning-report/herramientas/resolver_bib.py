"""Arma referencias.bib desde metadatos de Crossref y DBLP, nunca de memoria.

Cada semilla trae (clave, fuente preferida, título, apellido del primer autor, año). Un resultado se acepta solo si el
título normalizado coincide (similitud >= 0,90), el apellido aparece entre los autores y el año difiere en 1 o menos.
La entrada BibTeX se descarga del propio servicio (doi.org con Accept: application/x-bibtex, o dblp.org/rec/*.bib) y
solo se le cambia la clave. Lo que no se resuelve queda en el registro y no entra al .bib.

Uso: python resolver_bib.py <salida.bib> <registro.tsv>
"""

from __future__ import annotations

import difflib
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

UA = {"User-Agent": "informe-bib-resolver/1.0 (script academico)"}

SEMILLAS = [
    # Historia y fundamentos de la transferencia
    ("thorndike1901", "crossref", "The influence of improvement in one mental function upon the efficiency of other functions", "Thorndike", 1901),
    ("bozinovski2020", "crossref", "Reminder of the first paper on transfer learning in neural networks, 1976", "Bozinovski", 2020),
    ("pratt1991", "dblp", "Direct transfer of learned information among neural networks", "Pratt", 1991),
    ("pratt1993", "dblp", "Discriminability-based transfer between neural networks", "Pratt", 1992),
    ("thrun1996", "dblp", "Is learning the n-th thing any easier than learning the first?", "Thrun", 1995),
    ("caruana1997", "crossref", "Multitask learning", "Caruana", 1997),
    ("thrun1998", "crossref", "Learning to learn", "Thrun", 1998),
    ("baxter2000", "crossref", "A model of inductive bias learning", "Baxter", 2000),
    ("shimodaira2000", "crossref", "Improving predictive inference under covariate shift by weighting the log-likelihood function", "Shimodaira", 2000),
    ("hinton2006dbn", "crossref", "A fast learning algorithm for deep belief nets", "Hinton", 2006),
    ("hinton2006science", "crossref", "Reducing the dimensionality of data with neural networks", "Hinton", 2006),
    ("bengio2007", "dblp", "Greedy layer-wise training of deep networks", "Bengio", 2006),
    ("raina2007", "crossref", "Self-taught learning: transfer learning from unlabeled data", "Raina", 2007),
    ("dai2007", "crossref", "Boosting for transfer learning", "Dai", 2007),
    ("quinonero2009", "crossref", "Dataset shift in machine learning", "Quiñonero-Candela", 2008),
    ("erhan2010", "dblp", "Why does unsupervised pre-training help deep learning?", "Erhan", 2010),
    ("pan2010", "crossref", "A survey on transfer learning", "Pan", 2010),
    ("bendavid2010", "crossref", "A theory of learning from different domains", "Ben-David", 2010),
    ("bengio2012", "dblp", "Deep learning of representations for unsupervised and transfer learning", "Bengio", 2012),
    ("donahue2014", "dblp", "DeCAF: A deep convolutional activation feature for generic visual recognition", "Donahue", 2014),
    ("oquab2014", "crossref", "Learning and transferring mid-level image representations using convolutional neural networks", "Oquab", 2014),
    ("razavian2014", "crossref", "CNN features off-the-shelf: an astounding baseline for recognition", "Razavian", 2014),
    ("girshick2014", "crossref", "Rich feature hierarchies for accurate object detection and semantic segmentation", "Girshick", 2014),
    ("yosinski2014", "dblp", "How transferable are features in deep neural networks?", "Yosinski", 2014),
    ("weiss2016", "crossref", "A survey of transfer learning", "Weiss", 2016),
    ("ganin2016", "dblp", "Domain-adversarial training of neural networks", "Ganin", 2016),
    ("ioffe2015", "dblp", "Batch normalization: accelerating deep network training by reducing internal covariate shift", "Ioffe", 2015),
    ("li2018adabn", "crossref", "Adaptive batch normalization for practical domain adaptation", "Li", 2018),
    ("schneider2020", "dblp", "Improving robustness against common corruptions by covariate shift adaptation", "Schneider", 2020),
    ("mccloskey1989", "crossref", "Catastrophic interference in connectionist networks: the sequential learning problem", "McCloskey", 1989),
    ("kirkpatrick2017", "crossref", "Overcoming catastrophic forgetting in neural networks", "Kirkpatrick", 2017),
    ("vaswani2017", "dblp", "Attention is all you need", "Vaswani", 2017),
    ("howard2018", "crossref", "Universal language model fine-tuning for text classification", "Howard", 2018),
    ("tan2018", "crossref", "A survey on deep transfer learning", "Tan", 2018),
    ("devlin2019", "crossref", "BERT: pre-training of deep bidirectional transformers for language understanding", "Devlin", 2019),
    ("houlsby2019", "dblp", "Parameter-efficient transfer learning for NLP", "Houlsby", 2019),
    ("he2019", "crossref", "Rethinking ImageNet pre-training", "He", 2019),
    ("raghu2019", "dblp", "Transfusion: understanding transfer learning for medical imaging", "Raghu", 2019),
    ("kornblith2019", "crossref", "Do better ImageNet models transfer better?", "Kornblith", 2019),
    ("neyshabur2020", "dblp", "What is being transferred in transfer learning?", "Neyshabur", 2020),
    ("dodge2020", "dblp", "Fine-tuning pretrained language models: weight initializations, data orders, and early stopping", "Dodge", 2020),
    ("zhuang2021", "crossref", "A comprehensive survey on transfer learning", "Zhuang", 2021),
    ("bommasani2021", "dblp", "On the opportunities and risks of foundation models", "Bommasani", 2021),
    ("hu2022", "dblp", "LoRA: low-rank adaptation of large language models", "Hu", 2022),
    ("kumar2022", "dblp", "Fine-tuning can distort pretrained features and underperform out-of-distribution", "Kumar", 2022),
    ("lee2023", "dblp", "Surgical fine-tuning improves adaptation to distribution shifts", "Lee", 2023),
    # Series de tiempo
    ("fawaz2018", "crossref", "Transfer learning for time series classification", "Fawaz", 2018),
    ("oreshkin2021", "crossref", "Meta-learning framework with applications to zero-shot time-series forecasting", "Oreshkin", 2021),
    ("kim2022", "dblp", "Reversible instance normalization for accurate time-series forecasting against distribution shift", "Kim", 2022),
    ("zeng2023", "crossref", "Are transformers effective for time series forecasting?", "Zeng", 2023),
    ("nie2023", "dblp", "A time series is worth 64 words: long-term forecasting with transformers", "Nie", 2023),
    ("rasul2023", "dblp", "Lag-Llama: towards foundation models for probabilistic time series forecasting", "Rasul", 2023),
    ("ansari2024", "dblp", "Chronos: learning the language of time series", "Ansari", 2024),
    ("das2024", "dblp", "A decoder-only foundation model for time-series forecasting", "Das", 2024),
    ("woo2024", "dblp", "Unified training of universal time series forecasting transformers", "Woo", 2024),
    ("goswami2024", "dblp", "MOMENT: a family of open time-series foundation models", "Goswami", 2024),
    ("ansari2025", "dblp", "Chronos-2: from univariate to universal forecasting", "Ansari", 2025),
    ("hyndman2006", "crossref", "Another look at measures of forecast accuracy", "Hyndman", 2006),
    # Estadística y metodología
    ("hoerl1970", "crossref", "Ridge regression: biased estimation for nonorthogonal problems", "Hoerl", 1970),
    ("efron1979", "crossref", "Bootstrap methods: another look at the jackknife", "Efron", 1979),
    ("efron1993", "crossref", "An introduction to the bootstrap", "Efron", 1993),
    ("field2007", "crossref", "Bootstrapping clustered data", "Field", 2007),
    ("vovk2005", "crossref", "Algorithmic learning in a random world", "Vovk", 2005),
    ("lei2018", "crossref", "Distribution-free predictive inference for regression", "Lei", 2018),
    ("nelson1984", "crossref", "The Shewhart control chart—tests for special causes", "Nelson", 1984),
    ("page1954", "crossref", "Continuous inspection schemes", "Page", 1954),
    ("saeb2017", "crossref", "The need to approximate the use-case in clinical machine learning", "Saeb", 2017),
    ("kapoor2023", "crossref", "Leakage and the reproducibility crisis in machine-learning-based science", "Kapoor", 2023),
    ("benjamini1995", "crossref", "Controlling the false discovery rate: a practical and powerful approach to multiple testing", "Benjamini", 1995),
    ("bouthillier2021", "dblp", "Accounting for variance in machine learning benchmarks", "Bouthillier", 2021),
    ("prechelt1998", "crossref", "Early stopping - but when?", "Prechelt", 1998),
    ("kingma2015", "dblp", "Adam: a method for stochastic optimization", "Kingma", 2015),
    ("loshchilov2019", "dblp", "Decoupled weight decay regularization", "Loshchilov", 2019),
    ("srivastava2014", "dblp", "Dropout: a simple way to prevent neural networks from overfitting", "Srivastava", 2014),
    # Fisiología espacial, análogos y datos
    ("pavy2007", "crossref", "From space to Earth: advances in human physiology from 20 years of bed rest studies (1986–2006)", "Pavy-Le Traon", 2007),
    ("hargens2016", "crossref", "Long-duration bed rest as an analog to microgravity", "Hargens", 2016),
    ("meck2009", "crossref", "Long-duration head-down bed rest: project overview, vital signs, and fluid balance", "Meck", 2009),
    ("platts2009", "crossref", "Cardiovascular adaptations to long-duration head-down bed rest", "Platts", 2009),
    ("hughson2018", "crossref", "Heart in space: effect of the extraterrestrial environment on the cardiovascular system", "Hughson", 2018),
    ("norsk2020", "crossref", "Adaptation of the cardiovascular system to weightlessness: surprises, paradoxes and implications for deep space missions", "Norsk", 2020),
    ("stahn2017", "crossref", "Increased core body temperature in astronauts during long-duration space missions", "Stahn", 2017),
    ("garrettbakelman2019", "crossref", "The NASA Twins Study: a multidimensional analysis of a year-long human spaceflight", "Garrett-Bakelman", 2019),
    ("overbey2024", "crossref", "The Space Omics and Medical Atlas (SOMA) and international astronaut biobank", "Overbey", 2024),
    ("yfantidou2022", "crossref", "LifeSnaps, a 4-month multi-modal dataset capturing unobtrusive snapshots of our lives in the wild", "Yfantidou", 2022),
    ("li2017", "crossref", "Digital health: tracking physiomes and activity using wearable biosensors reveals useful health-related information", "Li", 2017),
    ("mishra2020", "crossref", "Pre-symptomatic detection of COVID-19 from smartwatch data", "Mishra", 2020),
    # Software
    ("paszke2019", "dblp", "PyTorch: an imperative style, high-performance deep learning library", "Paszke", 2019),
    ("wolf2020", "crossref", "Transformers: state-of-the-art natural language processing", "Wolf", 2020),
    ("pedregosa2011", "dblp", "Scikit-learn: machine learning in Python", "Pedregosa", 2011),
    ("harris2020", "crossref", "Array programming with NumPy", "Harris", 2020),
    ("virtanen2020", "crossref", "SciPy 1.0: fundamental algorithms for scientific computing in Python", "Virtanen", 2020),
    ("mckinney2010", "crossref", "Data structures for statistical computing in Python", "McKinney", 2010),
]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def sim(a: str, b: str) -> float:
    a, b = norm(a), norm(b)
    if a == b:
        return 1.0
    # el título buscado puede ser el inicio de uno más largo (subtítulos)
    if b.startswith(a) and len(a) > 25:
        return 0.95
    return difflib.SequenceMatcher(None, a, b).ratio()


def get(url: str, accept: str | None = None) -> str:
    h = dict(UA)
    if accept:
        h["Accept"] = accept
    for intento in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=40) as r:
                return r.read().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            if intento == 3:
                raise
            time.sleep(3 * (intento + 1))
    raise RuntimeError("inalcanzable")


def apellido_en(apellido: str, autores: list[str]) -> bool:
    a = norm(apellido)
    return any(a in norm(x) or norm(x).endswith(a.split()[-1]) for x in autores)


def crossref(titulo: str, apellido: str, anio: int):
    q = urllib.parse.urlencode({"query.bibliographic": titulo, "query.author": apellido, "rows": 8,
                                "select": "DOI,title,author,issued,type,container-title"})
    items = json.loads(get("https://api.crossref.org/works?" + q))["message"]["items"]
    mejor = None
    for it in items:
        t = (it.get("title") or [""])[0]
        autores = [a.get("family", "") + " " + a.get("given", "") for a in it.get("author", [])] + \
                  [a.get("name", "") for a in it.get("author", [])]
        y = (it.get("issued", {}).get("date-parts") or [[None]])[0][0]
        s = sim(titulo, t)
        ok = s >= 0.90 and apellido_en(apellido, autores) and y is not None and abs(int(y) - anio) <= 1
        tipo = it.get("type", "")
        if ok and tipo not in ("peer-review", "erratum"):
            if mejor is None or s > mejor[0]:
                mejor = (s, it["DOI"], t, y, tipo, (it.get("container-title") or [""])[0])
    if not mejor:
        return None
    bib = get("https://doi.org/" + urllib.parse.quote(mejor[1]), accept="application/x-bibtex; charset=utf-8")
    return mejor, bib


def dblp(titulo: str, apellido: str, anio: int):
    q = urllib.parse.urlencode({"q": titulo, "format": "json", "h": 20})
    hits = json.loads(get("https://dblp.org/search/publ/api?" + q))["result"]["hits"].get("hit", [])
    cands = []
    for h in hits:
        info = h["info"]
        t = info.get("title", "").rstrip(".")
        aut = info.get("authors", {}).get("author", [])
        aut = [a["text"] if isinstance(a, dict) else a for a in (aut if isinstance(aut, list) else [aut])]
        y = int(info.get("year", 0))
        s = sim(titulo, t)
        if s >= 0.90 and apellido_en(apellido, aut) and abs(y - anio) <= 1:
            corr = info.get("venue", "") == "CoRR"
            cands.append((not corr, s, info["key"], t, y, info.get("venue", ""), info.get("type", "")))
    if not cands:
        return None
    cands.sort(reverse=True)  # primero lo publicado en una sede, después el preprint
    _, s, key, t, y, venue, tipo = cands[0]
    bib = get(f"https://dblp.org/rec/{key}.bib?param=1")
    return (s, key, t, y, tipo, venue), bib


def recodificar(bib: str, clave: str) -> str:
    bib = bib.strip()
    bib = re.sub(r"^@(\w+)\s*\{\s*[^,]+,", lambda m: "@" + m.group(1) + "{" + clave + ",", bib, count=1)
    return bib


def main() -> None:
    salida, registro = sys.argv[1], sys.argv[2]
    entradas, filas = [], ["clave\tfuente\testado\tsimilitud\tid\ttitulo_encontrado\tanio\ttipo\tsede"]
    for clave, fuente, titulo, apellido, anio in SEMILLAS:
        orden = [fuente, "dblp" if fuente == "crossref" else "crossref"]
        hecho = None
        for f in orden:
            try:
                r = crossref(titulo, apellido, anio) if f == "crossref" else dblp(titulo, apellido, anio)
            except Exception as e:  # noqa: BLE001
                filas.append(f"{clave}\t{f}\terror\t\t\t{e!r}\t\t\t")
                r = None
            time.sleep(1.0)
            if r:
                hecho = (f, r)
                break
        if not hecho:
            filas.append(f"{clave}\t-\tNO RESUELTA\t\t\t{titulo}\t{anio}\t\t")
            print("NO", clave, flush=True)
            continue
        f, ((s, ident, t, y, tipo, sede), bib) = hecho
        entradas.append(recodificar(bib, clave))
        filas.append(f"{clave}\t{f}\tok\t{s:.3f}\t{ident}\t{t}\t{y}\t{tipo}\t{sede}")
        print("ok", clave, f, f"{s:.2f}", y, sede[:40], flush=True)
    with open(salida, "w", encoding="utf-8") as fh:
        fh.write("% Generado por herramientas/resolver_bib.py desde Crossref y DBLP. No editar a mano.\n\n")
        fh.write("\n\n".join(entradas) + "\n")
    with open(registro, "w", encoding="utf-8") as fh:
        fh.write("\n".join(filas) + "\n")


if __name__ == "__main__":
    main()
