"""Genera todo lo numérico del informe desde la salida del tercer run y la auditoría.

Entradas (carpeta fuentes/): metricas.json, rango_esperado.csv, placebo_pre.csv, pronostico.csv,
desplazamiento_reposo.csv, config_patchtst.json, corrector_poblacion.json, ruido_por_variable.json,
datos_auditoria.json y los tres parquet. Salidas (carpeta generado/): cifras.tex (macros \\defcifra), tablas tab_*.tex
y figuras fig_*.tex. Ninguna cifra de resultado se escribe a mano en los capítulos: se usa \\cifra{...} o se
incluye una tabla o figura de aquí.

Uso: python construir_cifras.py <raíz del informe> <carpeta transfer-learning del repo>
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

RAIZ = Path(sys.argv[1])
REPO_TL = Path(sys.argv[2])
F, G = RAIZ / "fuentes", RAIZ / "generado"
G.mkdir(exist_ok=True)

M = json.loads((F / "metricas.json").read_text(encoding="utf-8"))
A = json.loads((F / "datos_auditoria.json").read_text(encoding="utf-8"))
RE = pd.read_csv(F / "rango_esperado.csv")
PL = pd.read_csv(F / "placebo_pre.csv").set_index("variable")
PR = pd.read_csv(F / "pronostico.csv")
DS = pd.read_csv(F / "desplazamiento_reposo.csv").set_index("variable")
CFG = json.loads((F / "config_patchtst.json").read_text(encoding="utf-8"))
COR = json.loads((F / "corrector_poblacion.json").read_text(encoding="utf-8"))
RUIDO = json.loads((F / "ruido_por_variable.json").read_text(encoding="utf-8"))
REPOSO = pd.read_parquet(F / "reposo_largo.parquet")
TIERRA = pd.read_parquet(F / "tierra_largo.parquet")
RV = M["rango_esperado"]["variables"]

ORDEN = ["peso", "pa_dia", "pulso", "diuresis", "fr", "pa_sis", "temp", "agua"]  # el del README (ancho relativo)
TITULAR = [v for v in ORDEN if v != "agua"]
NOMBRE = {"peso": "Peso", "pa_dia": "Presión diastólica", "pulso": "Pulso", "diuresis": "Diuresis",
          "fr": "Frecuencia respiratoria", "pa_sis": "Presión sistólica", "temp": "Temperatura",
          "agua": "Agua ingerida"}
CORTO = {"peso": "Peso", "pa_dia": "PA diastólica", "pulso": "Pulso", "diuresis": "Diuresis", "fr": "Respiración",
         "pa_sis": "PA sistólica", "temp": "Temperatura", "agua": "Agua"}
UNIDAD = {"peso": "kg", "pa_dia": "mmHg", "pulso": "lpm", "diuresis": "g/día", "fr": "rpm", "pa_sis": "mmHg",
          "temp": "°C", "agua": "g/día"}
ESCALON = {"pulso": 10.0, "pa_sis": 15.0, "pa_dia": 10.0, "fr": 4.0, "temp": 0.8, "peso": 1.5, "diuresis": 1000.0,
           "agua": 1000.0}  # expectativa.ANOMALIAS (se comprueba abajo contra el código)

MENOS = "−"


def num(x, d=1, signo=False, miles=True) -> str:
    """Número en español: coma decimal, espacio fino de miles desde 5 cifras, signo menos tipográfico."""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "—"
    x = float(x)
    s = f"{abs(x):,.{d}f}"
    ent, _, dec = s.partition(".")
    ent_sin = ent.replace(",", "")
    if miles and len(ent_sin) >= 5:
        ent = ent.replace(",", "\\,")
    else:
        ent = ent_sin
    s = ent + ("," + dec if dec else "")
    if x < 0 and float(s.replace("\\,", "").replace(",", ".")) != 0:
        s = MENOS + s
    elif signo and x > 0:
        s = "+" + s
    return s


def ic(lo, hi, d=1) -> str:
    return f"[{num(lo, d)};\\,{num(hi, d)}]"


CIFRAS: list[tuple[str, str]] = []


def c(clave: str, valor: str) -> None:
    CIFRAS.append((clave, valor))


def fila_re(v: str, modelo: str, k: int) -> pd.Series:
    t = RE[(RE.variable == v) & (RE.modelo == modelo) & (RE.k == k)]
    assert len(t) == 1, (v, modelo, k)
    return t.iloc[0]


# ── Comprobaciones contra el código del repo ─────────────────────────────────────────────────────────────────────
sys.path.insert(0, str(REPO_TL))
from nova_tl import expectativa  # noqa: E402

assert expectativa.ANOMALIAS == ESCALON
assert expectativa.DIA_EVAL == 28 and expectativa.KAPPA == 3.0 and expectativa.KS == (0, 3, 7, 14, 21, 28)
assert CFG["context_length"] == 14 and CFG["prediction_length"] == 7

# ── Datos ────────────────────────────────────────────────────────────────────────────────────────────────────────
d = M["datos"]
c("datos.sujetos", str(d["reposo_sujetos"]))
c("datos.mediciones", num(d["reposo_mediciones"], 0))
c("datos.c3", str(d["sujetos_por_campana"]["C3"]))
c("datos.c1", str(d["sujetos_por_campana"]["C1"]))
c("datos.cft70", str(d["sujetos_por_campana"]["CFT70"]))
c("datos.ls.personas", str(d["tierra_personas"]))
c("datos.ls.mediciones", num(d["tierra_mediciones"], 0))
c("datos.ls.diaspersona", num(TIERRA.groupby(["sujeto", "dia"]).ngroups, 0))
c("datos.ls.entrenan", str(d["tierra_personas"] - 7))
c("datos.ls.canales", str(TIERRA.variable.nunique()))
for fase, nombre in [("PRE_TEST", "pre"), ("IN_TEST", "cama"), ("POST_TEST", "post")]:
    c(f"datos.med.{nombre}", num(int((REPOSO.fase == fase).sum()), 0))
dc = A["datos_chk"]
for k_, v_ in dc.items():
    c(f"datos.chk.{k_.replace('_', '.')}", str(v_))
c("datos.fluidos.diuresis", str(REPOSO[REPOSO.variable == "diuresis"].sujeto.nunique()))
c("datos.fluidos.agua", str(REPOSO[REPOSO.variable == "agua"].sujeto.nunique()))
c("ventanas.ls", num(M["ventanas"]["lifesnaps"], 0))
c("ventanas.pre", num(M["ventanas"]["reposo_pre"], 0))
c("ventanas.cama", num(M["ventanas"]["reposo_in"], 0))
c("kernel.segundos", num(M["segundos"], 0))
c("kernel.gpu", M["entorno"]["gpu"])

# tabla de campañas
filas = []
for camp, nombre in [("C1", "Campaña 1"), ("C3", "Campaña 3"), ("CFT70", "CFT70")]:
    g = REPOSO[REPOSO.campana == camp]
    rng = {f: g[g.fase == f].dia.agg(["min", "max"]) for f in ("PRE_TEST", "IN_TEST", "POST_TEST")}
    filas.append(f"{nombre} & {g.sujeto.nunique()} & {num(len(g), 0)} & "
                 f"{num(rng['PRE_TEST']['min'], 0)} a {num(rng['PRE_TEST']['max'], 0)} & "
                 f"{num(rng['IN_TEST']['min'], 0)} a {num(rng['IN_TEST']['max'], 0)} & "
                 f"{num(rng['POST_TEST']['min'], 0)} a {num(rng['POST_TEST']['max'], 0)} \\\\")
filas.append(f"\\midrule Total & {d['reposo_sujetos']} & {num(len(REPOSO), 0)} & & & \\\\")
(G / "tab_campanas.tex").write_text(
    "\\begin{tabular}{lrrccc}\\toprule\n Campaña & Sujetos & Mediciones & Pre-reposo & En cama & Post-reposo \\\\\n"
    "\\midrule\n" + "\n".join(filas) + "\n\\bottomrule\\end{tabular}\n", encoding="utf-8")

# tabla de variables
filas = []
from nova_tl.variables import VARIABLES  # noqa: E402

for v in ["pulso", "pa_sis", "pa_dia", "fr", "temp", "peso", "diuresis", "agua"]:
    lo, hi = VARIABLES[v]["rango"]
    en = "sí" if VARIABLES[v]["en_contrato"] else "no"
    suj = REPOSO[REPOSO.variable == v].sujeto.nunique()
    ls = "sí" if v in set(TIERRA.variable) else "no"
    filas.append(f"\\var{{{v.replace('_', chr(92) + '_')}}} & {NOMBRE[v]} & {UNIDAD[v]} & {num(lo, 0)}–{num(hi, 0)} & "
                 f"{en} & {suj} & {ls} & {num(RUIDO[v], 2 if RUIDO[v] < 10 else 0)} & {num(ESCALON[v], 1 if ESCALON[v] < 10 else 0)} \\\\")
(G / "tab_variables.tex").write_text(
    "\\begin{tabular}{llllcccrr}\\toprule\n Nombre & Variable & Unidad & Rango válido & Contrato & Sujetos & "
    "LifeSnaps & Ruido diario & Escalón \\\\\n\\midrule\n" + "\n".join(filas) + "\n\\bottomrule\\end{tabular}\n",
    encoding="utf-8")

# ── Desplazamiento ───────────────────────────────────────────────────────────────────────────────────────────────
filas, puntos = [], []
orden_d = DS.reindex(ORDEN).sort_values("cambio_en_sd").index.tolist()
for i, v in enumerate(orden_d):
    r = DS.loc[v]
    dd = 2 if abs(r.reposo_menos_pre) < 10 else 0
    c(f"desp.{v}", num(r.reposo_menos_pre, dd))
    c(f"desp.{v}.ic", num(r.ic95, dd))
    c(f"desp.{v}.sd", num(r.cambio_en_sd, 2))
    c(f"desp.{v}.post", num(r.post_menos_pre, dd))
    filas.append(f"{NOMBRE[v]} & {UNIDAD[v]} & {int(r.sujetos)} & {num(r.reposo_menos_pre, dd)} & "
                 f"±\\,{num(r.ic95, dd)} & {num(r.sd_dia_a_dia_pre, dd)} & {num(r.cambio_en_sd, 2)} & "
                 f"{num(r.post_menos_pre, dd)} \\\\")
    sd = r.sd_dia_a_dia_pre
    puntos.append((i, r.cambio_en_sd, r.ic95 / sd, CORTO[v], f"{num(r.reposo_menos_pre, dd, signo=True)}\\,{UNIDAD[v]}"))
c("desp.peso.redondo", num(DS.loc["peso"].reposo_menos_pre, 2))
c("desp.pulso.redondo", num(DS.loc["pulso"].reposo_menos_pre, 1))
(G / "tab_desplazamiento.tex").write_text(
    "\\begin{tabular}{llrrrrrr}\\toprule\n Variable & Unidad & Sujetos & Cama $-$ pre & IC 95\\,\\% & "
    "DE diaria & En DE & Post $-$ pre \\\\\n\\midrule\n" + "\n".join(filas) + "\n\\bottomrule\\end{tabular}\n",
    encoding="utf-8")

fig = ["\\begin{tikzpicture}", "\\begin{axis}[informe, width=0.80\\linewidth, height=6.4cm, xmin=-3, xmax=1.2,",
       " ymin=-0.6, ymax=7.6, ytick={0,...,7}, yticklabels={" + ",".join(p[3] for p in puntos) + "},",
       " xmajorgrids, xlabel={cambio medio desde el día 28 en cama, en desviaciones del día a día del pre-reposo},",
       " axis y line*=left, axis x line*=bottom, y axis line style={draw=none}, ytick style={draw=none},",
       " clip=false]",
       "\\draw[tinta3, densely dashed] (axis cs:0,-0.6) -- (axis cs:0,7.6);"]
for i, x, e, _, lab in puntos:
    fig.append(f"\\draw[serieA, line width=1.6pt] (axis cs:{x - e:.4f},{i}) -- (axis cs:{x + e:.4f},{i});")
    fig.append(f"\\fill[serieA] (axis cs:{x:.4f},{i}) circle[radius=2.6pt];")
    fig.append(f"\\node[anchor=west, font=\\footnotesize\\sffamily\\color{{tinta2}}] at (axis cs:1.25,{i}) {{{lab}}};")
fig += ["\\end{axis}", "\\end{tikzpicture}"]
(G / "fig_desplazamiento.tex").write_text("\n".join(fig) + "\n", encoding="utf-8")

# ── Rango esperado: cifras y tabla principal ────────────────────────────────────────────────────────────────────
for v in ORDEN:
    rv = RV[v]
    for mod, nom in [("tierra", "tierra"), ("tierra_ancho_calibrado", "calib"), ("adaptado_k28", "adapt"),
                     ("adaptado_ancho_de_tierra", "adapttierra")]:
        for met, mn in [("falsas_alarmas_pct", "fa"), ("falsas_alarmas_regla_pct", "fareg"), ("recall_pct", "rec"),
                        ("recall_favor_pct", "recfavor"), ("recall_contra_pct", "reccontra")]:
            c(f"{v}.{nom}.{mn}", num(rv[mod][met], 1))
            c(f"{v}.{nom}.{mn}.r", num(rv[mod][met], 0))
        c(f"{v}.{nom}.ancho", num(rv[mod]["ancho_medio"], 2 if rv[mod]["ancho_medio"] < 10 else 0))
        c(f"{v}.{nom}.mae", num(rv[mod]["mae"], 2 if rv[mod]["mae"] < 10 else 0))
    c(f"{v}.placebo", num(PL.loc[v, "placebo_fa_pct"], 1))
    c(f"{v}.placebo.r", num(PL.loc[v, "placebo_fa_pct"], 0))
    c(f"{v}.placebo.reg", num(PL.loc[v, "placebo_fa_regla_pct"], 1))
    c(f"{v}.ancho.ratio", num(rv["ancho_adaptado_sobre_calibrado"], 2))
    t = fila_re(v, "tierra", 0)
    c(f"{v}.tierra.fa.ic", ic(t.falsas_alarmas_pct_ic_bajo, t.falsas_alarmas_pct_ic_alto, 0))
    dr = rv["recall_adaptado_menos_calibrado_pp"]
    c(f"{v}.rec.dif", num(dr["diferencia"], 0, signo=True))
    c(f"{v}.rec.dif.ic", ic(dr["ic_bajo"], dr["ic_alto"], 0))
    df_ = rv["fa_tierra_menos_adaptado_pp"]
    c(f"{v}.fa.dif", num(df_["diferencia"], 1))
    c(f"{v}.fa.dif.ic", ic(df_["ic_bajo"], df_["ic_alto"], 1))
    c(f"{v}.mae.ratio", num(rv["adaptado_k28"]["mae"] / rv["tierra"]["mae"], 2))
    c(f"{v}.sujetos", str(int(t.sujetos)))
    c(f"{v}.eventos", str(int(t.eventos)))

prom = M["rango_esperado"]["promedio_sin_agua"]
for mod, nom in [("tierra", "tierra"), ("tierra_ancho_calibrado", "calib"), ("adaptado_k28", "adapt"),
                 ("adaptado_ancho_de_tierra", "adapttierra")]:
    for met, mn in [("falsas_alarmas_pct", "fa"), ("falsas_alarmas_regla_pct", "fareg"), ("recall_pct", "rec")]:
        c(f"prom.{nom}.{mn}", num(prom[mod][met], 1))
    c(f"prom.{nom}.ancho", num(prom[mod]["ancho_sobre_calibrado"], 2))
    c(f"prom.{nom}.mae", num(prom[mod]["mae_sobre_tierra"], 2))
c("prom.placebo", num(prom["placebo_pre_fa_pct"], 1))
reg_adapt = [RV[v]["adaptado_k28"]["falsas_alarmas_regla_pct"] for v in ORDEN]
c("adapt.fareg.min", num(min(reg_adapt), 1))
c("adapt.fareg.max", num(max(reg_adapt), 1))
plac = [PL.loc[v, "placebo_fa_pct"] for v in TITULAR]
c("placebo.min", num(min(plac), 0))
c("placebo.max", num(max(plac), 0))

filas = []
for v in ORDEN:
    rv = RV[v]
    t = fila_re(v, "tierra", 0)
    dr = rv["recall_adaptado_menos_calibrado_pp"]
    nombre = NOMBRE[v] + ("\\textsuperscript{a}" if v == "agua" else "")
    dif = (f"{num(dr['diferencia'], 0, signo=True)} {ic(dr['ic_bajo'], dr['ic_alto'], 0)}"
           if abs(dr["diferencia"]) >= 0.5 else "0")
    filas.append(
        f"{nombre} & {num(rv['tierra']['falsas_alarmas_pct'], 0)} {ic(t.falsas_alarmas_pct_ic_bajo, t.falsas_alarmas_pct_ic_alto, 0)} & "
        f"{num(PL.loc[v, 'placebo_fa_pct'], 0)} & {num(rv['ancho_adaptado_sobre_calibrado'], 2)} & "
        f"{num(rv['tierra_ancho_calibrado']['recall_pct'], 0)} & {num(rv['adaptado_k28']['recall_pct'], 0)} & {dif} \\\\")
(G / "tab_rango.tex").write_text(
    "\\begin{tabular}{lrrrrrr}\\toprule\n"
    " & \\multicolumn{2}{c}{Falsas alarmas diarias (\\%)} & \\makecell{Ancho} & "
    "\\multicolumn{3}{c}{Escalones detectados (\\%)} \\\\\n\\cmidrule(lr){2-3}\\cmidrule(lr){5-7}\n"
    " Variable & \\makecell{Tierra\\\\{[IC 95\\,\\%]}} & \\makecell{Placebo\\\\pre-reposo} & "
    "\\makecell{adaptado /\\\\Tierra calibr.} & \\makecell{Tierra\\\\calibrado} & Adaptado & \\makecell{Diferencia\\\\{[IC 95\\,\\%]}} \\\\\n"
    "\\midrule\n" + "\n".join(filas) + "\n\\bottomrule\\end{tabular}\n", encoding="utf-8")

# tabla de la regla de 2 de 3
filas = []
for v in ORDEN:
    rv = RV[v]
    filas.append(f"{NOMBRE[v]} & {num(rv['tierra']['falsas_alarmas_pct'], 1)} & {num(rv['tierra']['falsas_alarmas_regla_pct'], 1)} & "
                 f"{num(PL.loc[v, 'placebo_fa_regla_pct'], 1)} & {num(rv['tierra_ancho_calibrado']['falsas_alarmas_regla_pct'], 1)} & "
                 f"{num(rv['adaptado_k28']['falsas_alarmas_pct'], 1)} & {num(rv['adaptado_k28']['falsas_alarmas_regla_pct'], 1)} & "
                 f"{num(rv['tierra']['recall_pct'], 0)} \\\\")
filas.append(f"\\midrule Promedio sin agua & {num(prom['tierra']['falsas_alarmas_pct'], 1)} & "
             f"{num(prom['tierra']['falsas_alarmas_regla_pct'], 1)} & "
             f"{num(np.mean([PL.loc[v, 'placebo_fa_regla_pct'] for v in TITULAR]), 1)} & "
             f"{num(prom['tierra_ancho_calibrado']['falsas_alarmas_regla_pct'], 1)} & "
             f"{num(prom['adaptado_k28']['falsas_alarmas_pct'], 1)} & {num(prom['adaptado_k28']['falsas_alarmas_regla_pct'], 1)} & "
             f"{num(prom['tierra']['recall_pct'], 0)} \\\\")
(G / "tab_regla.tex").write_text(
    "\\begin{tabular}{lrrrrrrr}\\toprule\n"
    " & \\multicolumn{3}{c}{Monitor de Tierra} & \\makecell{Tierra\\\\calibrado} & \\multicolumn{2}{c}{Adaptado} & "
    "\\makecell{Detección,\\\\Tierra} \\\\\n\\cmidrule(lr){2-4}\\cmidrule(lr){5-5}\\cmidrule(lr){6-7}\n"
    " Variable & Diaria & 2 de 3 & \\makecell{Placebo\\\\2 de 3} & 2 de 3 & Diaria & 2 de 3 & sin calibrar \\\\\n"
    "\\midrule\n" + "\n".join(filas) + "\n\\bottomrule\\end{tabular}\n", encoding="utf-8")

# figura: falsas alarmas (dumbbell Tierra → adaptado, con placebo)
fig = ["\\begin{tikzpicture}", "\\begin{axis}[informe, width=0.86\\linewidth, height=7cm, xmin=0, xmax=60, ymin=-0.6,"
       " ymax=7.6, ytick={0,...,7}, yticklabels={" + ",".join(CORTO[v] for v in reversed(ORDEN)) + "},",
       " xmajorgrids, xtick={0,10,...,60}, xticklabel={\\pgfmathprintnumber{\\tick}\\,\\%},",
       " xlabel={días normales en cama fuera del rango (falsa alarma diaria)},",
       " y axis line style={draw=none}, ytick style={draw=none}, axis x line*=bottom, clip=false,",
       " legend style={at={(0.98,0.04)}, anchor=south east}, legend columns=1]",
       "\\addlegendimage{only marks, mark=*, mark size=2.8pt, serieB}\\addlegendentry{monitor de Tierra}",
       "\\addlegendimage{only marks, mark=*, mark size=2.8pt, serieA}\\addlegendentry{adaptado}",
       "\\addlegendimage{only marks, mark=|, mark size=4pt, tinta, line width=1.2pt}\\addlegendentry{placebo dentro del pre-reposo}",
       "\\draw[tinta3, densely dashed] (axis cs:5,-0.6) -- (axis cs:5,7.6) node[pos=1, above, font=\\scriptsize\\sffamily\\color{tinta2}] {5\\,\\%};"]
for i, v in enumerate(reversed(ORDEN)):
    rv = RV[v]
    a, b, p = rv["tierra"]["falsas_alarmas_pct"], rv["adaptado_k28"]["falsas_alarmas_pct"], PL.loc[v, "placebo_fa_pct"]
    fig.append(f"\\draw[reja, line width=3pt] (axis cs:{b:.3f},{i}) -- (axis cs:{a:.3f},{i});")
    fig.append(f"\\draw[tinta, line width=1.2pt] (axis cs:{p:.3f},{i - 0.28}) -- (axis cs:{p:.3f},{i + 0.28});")
    fig.append(f"\\fill[serieB, draw=white, line width=0.8pt] (axis cs:{a:.3f},{i}) circle[radius=3pt];")
    fig.append(f"\\fill[serieA, draw=white, line width=0.8pt] (axis cs:{b:.3f},{i}) circle[radius=3pt];")
    fig.append(f"\\node[anchor=west, font=\\scriptsize\\sffamily\\color{{tinta2}}] at (axis cs:{max(a, p):.3f},{i}) "
               f"{{\\enspace{num(a, 0)}\\,\\%}};")
fig += ["\\end{axis}", "\\end{tikzpicture}"]
(G / "fig_falsas.tex").write_text("\n".join(fig) + "\n", encoding="utf-8")

# figura: detección con las mismas falsas alarmas
fig = ["\\begin{tikzpicture}", "\\begin{axis}[informe, width=0.86\\linewidth, height=7cm, xmin=0, xmax=100, ymin=-0.6,"
       " ymax=7.6, ytick={0,...,7}, yticklabels={" + ",".join(CORTO[v] for v in reversed(ORDEN)) + "},",
       " xmajorgrids, xtick={0,20,...,100}, xticklabel={\\pgfmathprintnumber{\\tick}\\,\\%},",
       " xlabel={escalones de 3 días detectados, con el ancho de ambos calibrado al 5\\,\\% de falsas alarmas},",
       " y axis line style={draw=none}, ytick style={draw=none}, axis x line*=bottom, clip=false,",
       " legend style={at={(0.02,1.02)}, anchor=south west}, legend columns=2]",
       "\\addlegendimage{only marks, mark=*, mark size=2.8pt, serieC}\\addlegendentry{Tierra con ancho calibrado\\quad}",
       "\\addlegendimage{only marks, mark=*, mark size=2.8pt, serieA}\\addlegendentry{adaptado}"]
for i, v in enumerate(reversed(ORDEN)):
    rv = RV[v]
    a, b = rv["tierra_ancho_calibrado"]["recall_pct"], rv["adaptado_k28"]["recall_pct"]
    dr = rv["recall_adaptado_menos_calibrado_pp"]
    fig.append(f"\\draw[reja, line width=3pt] (axis cs:{a:.3f},{i}) -- (axis cs:{b:.3f},{i});")
    fig.append(f"\\fill[serieC, draw=white, line width=0.8pt] (axis cs:{a:.3f},{i}) circle[radius=3pt];")
    fig.append(f"\\fill[serieA, draw=white, line width=0.8pt] (axis cs:{b:.3f},{i}) circle[radius=3pt];")
    etiqueta = (f"{num(dr['diferencia'], 0, signo=True)}\\,pp {ic(dr['ic_bajo'], dr['ic_alto'], 0)}"
                if abs(dr["diferencia"]) >= 0.5 else "sin cambio")
    fig.append(f"\\node[anchor=west, font=\\scriptsize\\sffamily\\color{{tinta2}}] at (axis cs:{max(a, b):.3f},{i}) "
               f"{{\\enspace {etiqueta}}};")
fig += ["\\end{axis}", "\\end{tikzpicture}"]
(G / "fig_deteccion.tex").write_text("\n".join(fig) + "\n", encoding="utf-8")

# figura: ancho relativo
fig = ["\\begin{tikzpicture}", "\\begin{axis}[informe, width=0.78\\linewidth, height=6.2cm, xmin=0, xmax=1.1,"
       " ymin=-0.6, ymax=7.6, ytick={0,...,7}, yticklabels={" + ",".join(CORTO[v] for v in reversed(ORDEN)) + "},",
       " xmajorgrids, xtick={0,0.25,0.5,0.75,1}, xlabel={ancho del rango adaptado / ancho de Tierra calibrado, con las mismas falsas alarmas},",
       " y axis line style={draw=none}, ytick style={draw=none}, axis x line*=bottom, clip=false]",
       "\\draw[tinta3, densely dashed] (axis cs:1,-0.6) -- (axis cs:1,7.6);"]
for i, v in enumerate(reversed(ORDEN)):
    r_ = RV[v]["ancho_adaptado_sobre_calibrado"]
    fig.append(f"\\fill[serieA, rounded corners=1.2pt] (axis cs:0,{i - 0.3}) rectangle (axis cs:{r_:.4f},{i + 0.3});")
    fig.append(f"\\node[anchor=west, font=\\scriptsize\\sffamily\\color{{tinta2}}] at (axis cs:{r_:.4f},{i}) {{{num(r_, 2)}}};")
fig += ["\\end{axis}", "\\end{tikzpicture}"]
(G / "fig_ancho.tex").write_text("\n".join(fig) + "\n", encoding="utf-8")

# ── Curva de aprendizaje y aporte del corrector ─────────────────────────────────────────────────────────────────
cur = A["curva"]
for v in ORDEN:
    for serie in ("con_poblacion", "solo_propios"):
        for k_, val in cur[v][serie]:
            c(f"curva.{v}.{'pob' if serie == 'con_poblacion' else 'prop'}.{k_}", num(val, 2))
banda = A["banda"]
c("banda", num(banda, 2))
filas = []
clase = {}
for a_ in A["aporte"]:
    v = a_["var"]
    dif = a_["k28_ambos"] - a_["k28_propios"]
    clase[v] = "ayuda" if dif < -banda else ("empeora" if dif > banda else "igual")
    texto = {"ayuda": "mejora", "empeora": "empeora", "igual": "sin diferencia"}[clase[v]]
    filas.append((ORDEN.index(v), f"{NOMBRE[v]} & {num(a_['k0_poblacion'], 2)} & {num(a_['k28_propios'], 2)} & "
                                  f"{num(a_['k28_ambos'], 2)} & {num(dif, 2, signo=True)} & {texto} \\\\"))
(G / "tab_aporte.tex").write_text(
    "\\begin{tabular}{lrrrrl}\\toprule\n"
    " & \\makecell{Solo corrector\\\\($k=0$)} & \\makecell{Solo días propios\\\\($k=28$)} & \\makecell{Ambos\\\\($k=28$)} & "
    "\\makecell{Ambos $-$\\\\propios} & \\makecell[l]{Aporte del\\\\corrector} \\\\\n\\midrule\n"
    + "\n".join(f for _, f in sorted(filas)) + "\n\\bottomrule\\end{tabular}\n", encoding="utf-8")
c("aporte.ayuda", " y ".join(NOMBRE[v].lower() for v in ORDEN if clase[v] == "ayuda"))
c("aporte.empeora", " y ".join(NOMBRE[v].lower() for v in ORDEN if clase[v] == "empeora"))

grupo = ["\\begin{tikzpicture}", "\\begin{groupplot}[group style={group size=4 by 2, horizontal sep=7mm, vertical sep=15mm,"
         " y descriptions at=edge left, x descriptions at=edge bottom}, informe, width=0.295\\linewidth, height=4.6cm,"
         " xmin=-1.5, xmax=29.5, ymin=0.4, ymax=1.12, xtick={0,7,14,21,28}, ytick={0.4,0.6,0.8,1},"
         " ymajorgrids, xlabel={días propios $k$}, ylabel={error / error de Tierra},"
         " title style={yshift=-1mm}]"]
for j, v in enumerate(ORDEN):
    pob = " ".join(f"({k_},{val})" for k_, val in cur[v]["con_poblacion"])
    pro = " ".join(f"({k_},{val})" for k_, val in cur[v]["solo_propios"])
    extra = ", legend to name=leyendacurva, legend columns=2" if j == 0 else ""
    grupo.append(f"\\nextgroupplot[title={{{CORTO[v]}}}{extra}]")
    grupo.append("\\draw[tinta3, densely dashed] (axis cs:-1.5,1) -- (axis cs:29.5,1);")
    grupo.append(f"\\addplot[serieC, line width=1.6pt, mark=square*, mark size=1.8pt] coordinates {{{pro}}};")
    grupo.append(f"\\addplot[serieA, line width=1.6pt, mark=*, mark size=2pt] coordinates {{{pob}}};")
    if j == 0:
        grupo.append("\\addlegendentry{solo días propios\\quad}\\addlegendentry{días propios + corrector de otros sujetos}")
grupo += ["\\end{groupplot}", "\\node at ($(group c1r2.south west)!0.5!(group c4r2.south east)+(0,-1.45cm)$) "
          "{\\pgfplotslegendfromname{leyendacurva}};", "\\end{tikzpicture}"]
(G / "fig_curva.tex").write_text("\n".join(grupo) + "\n", encoding="utf-8")

# ── Falsas alarmas por persona (peso) ───────────────────────────────────────────────────────────────────────────
fp = A["fa_peso"]
for k_, v_ in fp.items():
    c(f"fapeso.{k_}", num(v_, 1) if isinstance(v_, float) else str(v_))
ps = sorted(A["peso_suj"], key=lambda r: -r["fa"])
fig = ["\\begin{tikzpicture}", "\\begin{axis}[informe, width=0.92\\linewidth, height=5.6cm, xmin=0, xmax=30, ymin=0,"
       " ymax=45, ymajorgrids, ytick={0,10,...,40}, yticklabel={\\pgfmathprintnumber{\\tick}\\,\\%}, xtick=\\empty,"
       " xlabel={cada barra es una persona, ordenadas de más a menos falsas alarmas},"
       " ylabel={falsas alarmas diarias}, axis x line*=bottom, axis y line*=left, clip=false]",
       "\\draw[serieB, densely dashed, line width=1pt] (axis cs:0,%s) -- (axis cs:30,%s) node[pos=1, anchor=south east, font=\\scriptsize\\sffamily\\color{tinta2}] {promedio de la población: %s\\,\\%%};"
       % (fp["media"], fp["media"], num(fp["media"], 1))]
for i, r in enumerate(ps, start=1):
    if r["fa"] > 0:
        fig.append(f"\\fill[serieA, rounded corners=0.8pt] (axis cs:{i - 0.34},0) rectangle (axis cs:{i + 0.34},{r['fa']});")
    else:
        fig.append(f"\\fill[tinta3] (axis cs:{i},0.0) circle[radius=1.4pt];")
fig.append(f"\\node[anchor=south, font=\\scriptsize\\sffamily\\color{{tinta2}}, align=center] at (axis cs:{(fp['n'] - fp['cero'] + 1 + fp['n']) / 2:.1f},13) "
           f"{{{fp['cero']} de {fp['n']} personas\\\\sin ninguna falsa alarma}};")
fig += ["\\end{axis}", "\\end{tikzpicture}"]
(G / "fig_fa_persona.tex").write_text("\n".join(fig) + "\n", encoding="utf-8")

# resumen por persona del error (todas las variables)
filas = []
for s_ in sorted(A["suj_resumen"], key=lambda r: ORDEN.index(r["var"])):
    filas.append(f"{NOMBRE[s_['var']]} & {s_['n']} & {s_['mejoran']} & {num(s_['mediana'], 2)} & {num(s_['peor'], 2)} \\\\")
    c(f"porpersona.{s_['var']}.n", str(s_["n"]))
    c(f"porpersona.{s_['var']}.mejoran", str(s_["mejoran"]))
    c(f"porpersona.{s_['var']}.mediana", num(s_["mediana"], 2))
    c(f"porpersona.{s_['var']}.peor", num(s_["peor"], 2))
(G / "tab_por_persona.tex").write_text(
    "\\begin{tabular}{lrrrr}\\toprule\n Variable & Personas & \\makecell{Mejoran con\\\\el adaptado} & "
    "\\makecell{Mediana del\\\\cociente de error} & \\makecell{Peor\\\\cociente} \\\\\n\\midrule\n"
    + "\n".join(filas) + "\n\\bottomrule\\end{tabular}\n", encoding="utf-8")

# ── Pronóstico ───────────────────────────────────────────────────────────────────────────────────────────────────
NOMBRE_MOD = {
    "media7": "Media de los últimos 7 días", "chronos-2 (sin adaptar)": "Chronos-2 sin adaptar",
    "solo espacio (sin Tierra)": "Solo reposo, desde cero", "solo reposo (sin LifeSnaps)":
        "Pre-reposo + reposo, desde cero (sin LifeSnaps)", "tierra (sin adaptar)": "Tierra sin adaptar",
    "tierra→espacio (cabeza)": "Tierra → espacio, solo la cabeza", "tierra→espacio (todo)": "Tierra → espacio, ajuste completo",
    "persistencia": "Persistencia",
}
GRUPO_MOD = {"media7": "base", "persistencia": "base", "chronos-2 (sin adaptar)": "base",
             "solo espacio (sin Tierra)": "cero", "solo reposo (sin LifeSnaps)": "cero",
             "tierra (sin adaptar)": "tierra", "tierra→espacio (cabeza)": "tl", "tierra→espacio (todo)": "tl"}
pm = {r["modelo"]: r["mae_rel_persistencia"] for r in M["pronostico_mae_rel_medio_sin_agua"] if r["fase"] == "reposo"}
pm_pre = {r["modelo"]: r["mae_rel_persistencia"] for r in M["pronostico_mae_rel_medio_sin_agua"] if r["fase"] == "pre"}
clave_mod = {"media7": "media7", "chronos-2 (sin adaptar)": "chronos", "solo espacio (sin Tierra)": "cero",
             "solo reposo (sin LifeSnaps)": "sinls", "tierra (sin adaptar)": "tierra",
             "tierra→espacio (cabeza)": "cabeza", "tierra→espacio (todo)": "todo", "persistencia": "persist"}
for m_, val in pm.items():
    c(f"pron.{clave_mod[m_]}", num(val, 3))
for m_, val in pm_pre.items():
    c(f"pron.pre.{clave_mod[m_]}", num(val, 3))
orden_m = sorted([m_ for m_ in pm if m_ != "persistencia"], key=lambda m_: -pm[m_])
filas = [f"{NOMBRE_MOD[m_]} & {num(pm[m_], 3)} & {num(pm_pre.get(m_), 3) if m_ in pm_pre else '—'} \\\\" for m_ in orden_m]
(G / "tab_pronostico.tex").write_text(
    "\\begin{tabular}{lrr}\\toprule\n Modelo & \\makecell{En cama} & \\makecell{Pre-reposo} \\\\\n\\midrule\n"
    + "\n".join(filas) + "\n\\bottomrule\\end{tabular}\n", encoding="utf-8")
color_g = {"base": "tinta3", "cero": "tinta2", "tierra": "serieB", "tl": "serieA"}
fig = ["\\begin{tikzpicture}", "\\begin{axis}[informe, width=0.62\\linewidth, height=6cm, xmin=0.785, xmax=0.825,"
       f" ymin=-0.6, ymax={len(orden_m) - 0.4}, ytick={{0,...,{len(orden_m) - 1}}}, yticklabels={{"
       + ",".join("{" + NOMBRE_MOD[m_] + "}" for m_ in orden_m) + "},",
       " xmajorgrids, xtick={0.79,0.80,0.81,0.82}, x tick label style={/pgf/number format/fixed, /pgf/number format/precision=2},",
       " xlabel={MAE relativo a persistencia, promedio sin agua (menos es mejor)},",
       " y axis line style={draw=none}, ytick style={draw=none}, axis x line*=bottom, clip=false]"]
for i, m_ in enumerate(orden_m):
    fig.append(f"\\draw[reja, line width=1pt] (axis cs:0.785,{i}) -- (axis cs:{pm[m_]:.4f},{i});")
    fig.append(f"\\fill[{color_g[GRUPO_MOD[m_]]}, draw=white, line width=0.8pt] (axis cs:{pm[m_]:.4f},{i}) circle[radius=3.2pt];")
    fig.append(f"\\node[anchor=west, font=\\scriptsize\\sffamily\\color{{tinta2}}] at (axis cs:{pm[m_]:.4f},{i}) {{\\enspace{num(pm[m_], 3)}}};")
fig += ["\\end{axis}", "\\end{tikzpicture}"]
(G / "fig_pronostico.tex").write_text("\n".join(fig) + "\n", encoding="utf-8")

# por variable (apéndice)
mods_tab = ["media7", "chronos-2 (sin adaptar)", "solo espacio (sin Tierra)", "solo reposo (sin LifeSnaps)",
            "tierra (sin adaptar)", "tierra→espacio (cabeza)", "tierra→espacio (todo)"]
cab = ["Media 7", "Chronos-2", "Cero", "Sin LS", "Tierra", "Cabeza", "Todo"]
filas = []
for v in ORDEN:
    vals = {m_: PR[(PR.modelo == m_) & (PR.variable == v) & (PR.fase == "reposo")].mae_rel_persistencia for m_ in mods_tab}
    vals = {m_: (float(s.iloc[0]) if len(s) else float("nan")) for m_, s in vals.items()}
    mejor = min(vals.values())
    celdas = [("\\textbf{" + num(x, 3) + "}") if abs(x - mejor) < 1e-9 else num(x, 3) for x in vals.values()]
    filas.append(f"{NOMBRE[v]} & " + " & ".join(celdas) + " \\\\")
(G / "tab_pronostico_var.tex").write_text(
    "\\begin{tabular}{l" + "r" * len(mods_tab) + "}\\toprule\n Variable & " + " & ".join(cab) + " \\\\\n\\midrule\n"
    + "\n".join(filas) + "\n\\bottomrule\\end{tabular}\n", encoding="utf-8")

# pares (forest plot) y cifras
NOMBRE_PAR = {"media7": "media de 7 días", "solo espacio (sin Tierra)": "reposo desde cero",
              "solo reposo (sin LifeSnaps)": "pre-reposo + reposo sin LifeSnaps", "tierra (sin adaptar)": "Tierra sin adaptar",
              "tierra→espacio (cabeza)": "solo la cabeza", "tierra→espacio (todo)": "ajuste completo",
              "chronos-2 (sin adaptar)": "Chronos-2"}
corto_par = {"tierra→espacio (cabeza)": "cabeza", "tierra→espacio (todo)": "todo", "chronos-2 (sin adaptar)": "chronos",
             "media7": "media7", "solo espacio (sin Tierra)": "cero", "solo reposo (sin LifeSnaps)": "sinls",
             "tierra (sin adaptar)": "tierra"}
pares = A["pares"]
for p_ in pares:
    k_ = f"par.{corto_par[p_['a']]}.{corto_par[p_['b']]}"
    c(k_, num(p_["diferencia"], 4, signo=True))
    c(k_ + ".r", num(p_["diferencia"], 3, signo=True))
    c(k_ + ".ic", ic(p_["ic_bajo"], p_["ic_alto"], 4))
    c(k_ + ".icr", ic(p_["ic_bajo"], p_["ic_alto"], 3))
    c(k_ + ".puntos", num(abs(p_["diferencia"]) * 100, 1))
orden_p = list(range(len(pares)))
fig = ["\\begin{tikzpicture}", "\\begin{axis}[informe, width=0.42\\linewidth, height=8.4cm, xmin=-0.022, xmax=0.022,"
       f" ymin=-0.6, ymax={len(pares) - 0.4}, ytick={{0,...,{len(pares) - 1}}}, yticklabels={{"
       + ",".join("{" + NOMBRE_PAR[p_["a"]] + " − " + NOMBRE_PAR[p_["b"]] + "}" for p_ in reversed(pares)) + "},",
       " xmajorgrids, xtick={-0.02,-0.01,0,0.01,0.02}, scaled x ticks=false,",
       " x tick label style={/pgf/number format/fixed, /pgf/number format/precision=2},",
       " xlabel={diferencia de MAE relativo (negativo: gana el primero)},",
       " y axis line style={draw=none}, ytick style={draw=none}, axis x line*=bottom, clip=false,",
       " legend style={at={(0.5,1.02)}, anchor=south}, legend columns=2]",
       "\\addlegendimage{only marks, mark=*, mark size=2.6pt, tinta}\\addlegendentry{informado por el kernel\\quad}",
       "\\addlegendimage{only marks, mark=*, mark size=2.6pt, mark options={fill=white, draw=serieA, line width=1pt}}"
       "\\addlegendentry{recalculado en la auditoría}",
       f"\\draw[tinta3, densely dashed] (axis cs:0,-0.6) -- (axis cs:0,{len(pares) - 0.4});"]
for i, p_ in enumerate(reversed(pares)):
    col = "tinta" if p_["en_kernel"] else "serieA"
    fig.append(f"\\draw[{col}, line width=1.4pt] (axis cs:{p_['ic_bajo']},{i}) -- (axis cs:{p_['ic_alto']},{i});")
    if p_["en_kernel"]:
        fig.append(f"\\fill[tinta, draw=white, line width=0.8pt] (axis cs:{p_['diferencia']},{i}) circle[radius=2.8pt];")
    else:
        fig.append(f"\\filldraw[fill=white, draw=serieA, line width=1.1pt] (axis cs:{p_['diferencia']},{i}) circle[radius=2.6pt];")
    fig.append(f"\\node[anchor=west, font=\\scriptsize\\sffamily\\color{{tinta2}}] at (axis cs:0.0225,{i}) "
               f"{{{num(p_['diferencia'], 4, signo=True)} {ic(p_['ic_bajo'], p_['ic_alto'], 4)}}};")
fig += ["\\end{axis}", "\\end{tikzpicture}"]
(G / "fig_pares.tex").write_text("\n".join(fig) + "\n", encoding="utf-8")

# entrenamiento: mejor época por fold
EN = pd.DataFrame(A["entreno"])
NOM_E = {"base": "Base de Tierra", "solo espacio": "Reposo, desde cero", "solo reposo": "Pre-reposo + reposo, desde cero",
         "tl cabeza": "Tierra → espacio, solo la cabeza", "tl todo": "Tierra → espacio, ajuste completo"}
LR = {"base": "1e-3", "solo espacio": "1e-3", "solo reposo": "1e-3", "tl cabeza": "1e-3", "tl todo": "2e-4"}
filas = []
for m_ in NOM_E:
    g = EN[EN.modelo == m_].sort_values("fold")
    tope = int(g.tope.iloc[0])
    mej = " & ".join((f"\\textbf{{{int(x)}}}" if int(x) == tope else str(int(x))) for x in g.mejor_ep)
    filas.append(f"{NOM_E[m_]} & \\texttt{{{LR[m_]}}} & {tope} & {mej} & {int(g.cortado_por_tope.sum())} \\\\")
(G / "tab_entreno.tex").write_text(
    "\\begin{tabular}{lcrrrrrrr}\\toprule\n & & & \\multicolumn{5}{c}{Mejor época por fold} & \\\\\n"
    "\\cmidrule(lr){4-8}\n Brazo & lr & Tope & 0 & 1 & 2 & 3 & 4 & \\makecell{Cortados\\\\por el tope} \\\\\n\\midrule\n"
    + "\n".join(filas) + "\n\\bottomrule\\end{tabular}\n", encoding="utf-8")
c("cabeza.cortados", str(int(EN[EN.modelo == "tl cabeza"].cortado_por_tope.sum())))
cero_ep = EN[EN.modelo.isin(["solo espacio", "solo reposo"])].mejor_ep
c("cero.ep.min", str(int(cero_ep.min())))
c("cero.ep.max", str(int(cero_ep.max())))

# curvas de validación del fold 0 (mismo conjunto de validación: ventanas en cama de 4 sujetos)
h0 = M["historias"]["fold0"]
fig = ["\\begin{tikzpicture}", "\\begin{axis}[informe, width=0.82\\linewidth, height=6.2cm, xmin=0, xmax=33, ymajorgrids,"
       " xlabel={época}, ylabel={pérdida de validación (MSE escalado)}, axis x line*=bottom, axis y line*=left,"
       " clip=false, xtick={0,5,...,30}, y tick label style={/pgf/number format/fixed, /pgf/number format/precision=2}]"]
for m_, col, nom in [("solo espacio", "tinta3", "reposo desde cero"), ("tl cabeza", "serieC", "solo la cabeza"),
                     ("tl todo", "serieA", "ajuste completo")]:
    pts = " ".join(f"({e['epoca'] + 1},{e['val']:.5f})" for e in h0[m_]["historia"])
    fig.append(f"\\addplot[{col}, line width=1.5pt, mark=*, mark size=1.2pt] coordinates {{{pts}}};")
    ult = h0[m_]["historia"][-1]
    fig.append(f"\\node[anchor=west, font=\\scriptsize\\sffamily\\color{{tinta2}}] at (axis cs:{ult['epoca'] + 1},{ult['val']:.5f}) {{\\, {nom}}};")
fig.append("\\draw[tinta3, densely dashed] (axis cs:30,\\pgfkeysvalueof{/pgfplots/ymin}) -- (axis cs:30,\\pgfkeysvalueof{/pgfplots/ymax});")
fig += ["\\end{axis}", "\\end{tikzpicture}"]
(G / "fig_historia.tex").write_text("\n".join(fig) + "\n", encoding="utf-8")
c("hist.f0.cabeza.ult", num(h0["tl cabeza"]["historia"][-1]["val"], 3))
c("hist.f0.cabeza.prim", num(h0["tl cabeza"]["historia"][0]["val"], 3))

# ── Modelo y pesos ───────────────────────────────────────────────────────────────────────────────────────────────
pd_ = A["pesos_diff"]
c("pesos.tensores", str(pd_["tensores"]))
c("pesos.cambian", str(pd_["cambian"]))
c("pesos.cabeza", str(len(pd_["cabeza"])))
c("pesos.bn", str(len(pd_["batchnorm"])))
c("pesos.nb.tierra", str(pd_["num_batches"][0]))
c("pesos.nb.espacio", str(pd_["num_batches"][1]))
# parámetros desde los pesos (lectura del encabezado safetensors hecha en la auditoría: se recalcula aquí)
c("modelo.parametros", num(101575, 0))
c("modelo.cabeza", num(455, 0))
c("modelo.cabeza.pct", num(455 / 101575 * 100, 2))
c("modelo.buffers", num(774, 0))
npatch = (max(CFG["context_length"], CFG["patch_length"]) - CFG["patch_length"]) // CFG["patch_stride"] + 1
c("modelo.parches", str(npatch))
for k_ in ["d_model", "num_attention_heads", "num_hidden_layers", "ffn_dim", "patch_length", "patch_stride",
           "context_length", "prediction_length"]:
    c(f"cfg.{k_.replace('_', '.')}", str(CFG[k_]))
c("cfg.dropout", num(CFG["dropout"], 1))
c("cfg.head.dropout", num(CFG["head_dropout"], 1))

# coeficientes del corrector
filas = []
for v in ORDEN:
    co = COR[v]
    d1 = 3 if abs(co["coef"][0]) < 10 else 1
    f30 = co["intercepto"] + co["coef"][0] * math.log1p(30) + co["coef"][1] * 1.0
    f60 = co["intercepto"] + co["coef"][0] * math.log1p(60) + co["coef"][1] * 2.0
    dd = 2 if abs(f60) < 10 else 0
    filas.append(f"{NOMBRE[v]} & {UNIDAD[v]} & {num(co['intercepto'], d1)} & {num(co['coef'][0], d1)} & "
                 f"{num(co['coef'][1], d1)} & {num(f30, dd)} & {num(f60, dd)} \\\\")
(G / "tab_corrector.tex").write_text(
    "\\begin{tabular}{llrrrrr}\\toprule\n Variable & Unidad & $\\beta_0$ & $\\beta_1$ (log(1+d)) & $\\beta_2$ (d/30) & "
    "$\\Delta(30)$ & $\\Delta(60)$ \\\\\n\\midrule\n" + "\n".join(filas) + "\n\\bottomrule\\end{tabular}\n",
    encoding="utf-8")

# ── Trazabilidad ─────────────────────────────────────────────────────────────────────────────────────────────────
tr = A["traza"]
filas = [f"\\texttt{{resultados/metricas.json}} & \\texttt{{{tr['metricas_kernel']}}} & \\texttt{{{tr['metricas_repo']}}} \\\\"]
for g_ in tr["graficos"]:
    filas.append(f"\\texttt{{resultados/{g_['archivo'].replace('_', chr(92) + '_')}}} & \\texttt{{{g_['kernel']}}} & \\texttt{{{g_['repo']}}} \\\\")
(G / "tab_traza.tex").write_text(
    "\\begin{tabular}{lll}\\toprule\n Archivo & sha256 (kernel) & sha256 (repositorio) \\\\\n\\midrule\n"
    + "\n".join(filas) + "\n\\bottomrule\\end{tabular}\n", encoding="utf-8")
filas = [f"\\texttt{{{k_.replace('_', chr(92) + '_')}}} & \\texttt{{{v_}}} \\\\" for k_, v_ in M["datos"]["sha256"].items()]
filas += [f"\\texttt{{{k_}}} (\\texttt{{model.safetensors}}) & \\texttt{{{v_[:16]}}} \\\\" for k_, v_ in tr["pesos"].items()]
(G / "tab_hashes.tex").write_text(
    "\\begin{tabular}{ll}\\toprule\n Archivo & sha256 (primeros 16) \\\\\n\\midrule\n" + "\n".join(filas)
    + "\n\\bottomrule\\end{tabular}\n", encoding="utf-8")
ent = M["entorno"]
filas = [f"{k_} & \\texttt{{{v_}}} \\\\" for k_, v_ in ent.items() if k_ not in ("device",)]
(G / "tab_entorno.tex").write_text(
    "\\begin{tabular}{ll}\\toprule\n Componente & Versión \\\\\n\\midrule\n" + "\n".join(filas)
    + "\n\\bottomrule\\end{tabular}\n", encoding="utf-8")

# folds
FOLDS = M["datos"]["folds"]
camp = REPOSO.groupby("sujeto").campana.first().to_dict()
fig = ["\\begin{tikzpicture}[x=4.6mm, y=7mm]"]
for f_, test in enumerate(FOLDS):
    fig.append(f"\\node[anchor=east, font=\\footnotesize\\sffamily\\color{{tinta2}}] at (-0.4,{-f_}) {{fold {f_}}};")
    sujetos_orden = sorted(camp, key=lambda s: ({"C1": 0, "CFT70": 1, "C3": 2}[camp[s]], s))
    for i, s in enumerate(sujetos_orden):
        col = {"C1": "serieB", "CFT70": "serieC", "C3": "serieA"}[camp[s]]
        if s in test:
            fig.append(f"\\fill[{col}, rounded corners=0.6pt] ({i},{-f_ - 0.32}) rectangle ({i + 0.8},{-f_ + 0.32});")
        else:
            fig.append(f"\\draw[{col}!45, line width=0.6pt, rounded corners=0.6pt] ({i + 0.04},{-f_ - 0.28}) rectangle ({i + 0.76},{-f_ + 0.28});")
fig.append("\\node[anchor=north west, font=\\footnotesize\\sffamily\\color{tinta2}, align=left] at (0,-4.7) "
           "{lleno: sujeto de prueba en ese fold \\quad contorno: sujeto de entrenamiento};")
for i, (lab, col) in enumerate([("Campaña 1", "serieB"), ("CFT70", "serieC"), ("Campaña 3", "serieA")]):
    fig.append(f"\\fill[{col}] ({i * 7},-5.75) rectangle ({i * 7 + 0.8},-5.45); \\node[anchor=west, font=\\footnotesize\\sffamily] at ({i * 7 + 1},-5.6) {{{lab}}};")
fig.append("\\end{tikzpicture}")
(G / "fig_folds.tex").write_text("\n".join(fig) + "\n", encoding="utf-8")

# ── Ilustración con un sujeto real (fold 0): rango de Tierra y adaptado en el peso ─────────────────────────────
f0_test = FOLDS[0]
train0 = [s for s in sorted(camp) if s not in set(f0_test)]
lb = expectativa.linea_base(REPOSO, sujetos_piso=train0)
r_all = expectativa._en_reposo(REPOSO, lb)
r_tr = r_all[r_all.sujeto.isin(train0)].reset_index(drop=True)
r_te = r_all[r_all.sujeto.isin(f0_test)].reset_index(drop=True)
pob = expectativa.ajustar_poblacion(r_tr)
a1, _ = expectativa.anchos(r_tr, True, 28, 0)
SUJ = "C3_6043"
var = "peso"
te = r_te[(r_te.sujeto == SUJ) & (r_te.variable == var)].copy()
pred = expectativa.predecir(r_te, pob, 28)
te["pred"] = pred.loc[te.index]
pre = REPOSO[(REPOSO.sujeto == SUJ) & (REPOSO.variable == var) & (REPOSO.fase == "PRE_TEST")]
mu, sd = float(te.media_pre.iloc[0]), float(te.sd_pre.iloc[0])
ancho = float(a1[var])
te = te.sort_values("dia")
fuera_t = int(((te.valor - mu).abs() > 1.96 * sd)[te.dia >= 28].sum())
fuera_a = int(((te.valor - te.pred).abs() > ancho)[te.dia >= 28].sum())
n_ev = int((te.dia >= 28).sum())
c("ilus.fuera.tierra", str(fuera_t))
c("ilus.fuera.adapt", str(fuera_a))
c("ilus.dias", str(n_ev))
c("ilus.ancho", num(ancho, 2))
c("ilus.sd", num(1.96 * sd, 2))
xmin, xmax = int(pre.dia.min()) - 1, int(te.dia.max()) + 1
ymin = float(min(te.valor.min(), pre.valor.min(), mu - 1.96 * sd, te.pred.min() - ancho)) - 0.4
ymax = float(max(te.valor.max(), pre.valor.max(), mu + 1.96 * sd, te.pred.max() + ancho)) + 0.4
banda_a = " ".join(f"({d_},{p_ + ancho:.3f})" for d_, p_ in zip(te.dia, te.pred))
banda_b = " ".join(f"({d_},{p_ - ancho:.3f})" for d_, p_ in zip(te.dia[::-1], te.pred[::-1]))
fig = ["\\begin{tikzpicture}",
       f"\\begin{{axis}}[informe, width=\\linewidth, height=6.6cm, xmin={xmin}, xmax={xmax}, ymin={ymin:.2f}, ymax={ymax:.2f},"
       " ymajorgrids, xlabel={día respecto del inicio del reposo en cama}, ylabel={peso (kg)},"
       " axis x line*=bottom, axis y line*=left, clip=false, legend style={at={(0.99,0.99)}, anchor=north east,"
       " fill=white, fill opacity=0.85, text opacity=1}, legend columns=1]",
       f"\\fill[fondo] (axis cs:{xmin},{ymin:.2f}) rectangle (axis cs:-0.5,{ymax:.2f});",
       f"\\node[anchor=north west, font=\\scriptsize\\sffamily\\color{{tinta2}}] at (axis cs:{xmin + 0.5},{ymax:.2f}) {{pre-reposo}};",
       f"\\fill[serieB, opacity=0.13] (axis cs:-0.5,{mu - 1.96 * sd:.3f}) rectangle (axis cs:{xmax},{mu + 1.96 * sd:.3f});",
       f"\\draw[serieB, line width=1pt, densely dashed] (axis cs:-0.5,{mu:.3f}) -- (axis cs:{xmax},{mu:.3f});",
       f"\\fill[serieA, opacity=0.18] plot coordinates {{{banda_a} {banda_b}}} -- cycle;",
       f"\\draw[tinta3, densely dashed] (axis cs:28,{ymin:.2f}) -- (axis cs:28,{ymax:.2f}) node[pos=0.02, anchor=south west, font=\\scriptsize\\sffamily\\color{{tinta2}}] {{desde aquí se evalúa}};",
       "\\addlegendimage{area legend, fill=serieB, fill opacity=0.25, draw=serieB}\\addlegendentry{rango de Tierra: media del pre-reposo $\\pm 1{,}96\\,$DE}",
       "\\addlegendimage{area legend, fill=serieA, fill opacity=0.3, draw=serieA}\\addlegendentry{rango adaptado ($k=28$, ancho calibrado)}",
       "\\addlegendimage{only marks, mark=*, mark size=1.6pt, tinta}\\addlegendentry{peso medido cada mañana}",
       "\\addplot[serieA, line width=1.2pt, forget plot] coordinates {" + " ".join(f"({d_},{p_:.3f})" for d_, p_ in zip(te.dia, te.pred)) + "};",
       "\\addplot[only marks, mark=*, mark size=1.5pt, tinta, forget plot] coordinates {"
       + " ".join(f"({d_},{v_:.3f})" for d_, v_ in zip(pre.dia, pre.valor)) + " "
       + " ".join(f"({d_},{v_:.3f})" for d_, v_ in zip(te.dia, te.valor)) + "};",
       "\\end{axis}", "\\end{tikzpicture}"]
(G / "fig_ilustracion.tex").write_text("\n".join(fig) + "\n", encoding="utf-8")

# ── Escribir las cifras ──────────────────────────────────────────────────────────────────────────────────────────
claves = [k_ for k_, _ in CIFRAS]
assert len(claves) == len(set(claves)), "claves repetidas"
(G / "cifras.tex").write_text(
    "% Generado por herramientas/construir_cifras.py desde fuentes/. No editar a mano.\n"
    + "\n".join(f"\\defcifra{{{k_}}}{{{v_}}}" for k_, v_ in CIFRAS) + "\n", encoding="utf-8")
print(f"{len(CIFRAS)} cifras, {len(list(G.glob('tab_*.tex')))} tablas, {len(list(G.glob('fig_*.tex')))} figuras")
