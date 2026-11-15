"""NOVA · transfer learning Tierra → espacio. Script del kernel de Kaggle (GPU T4).

Entrada: el dataset privado `benjacampos/nova-tl` (código `nova_tl/` y tres parquet hechos por `nova_tl.datos`).
Salida en /kaggle/working/salida: metricas.json, log.txt, tablas .csv, gráficos .png y pesos/.

Dos tareas, con validación por sujetos (5 grupos estratificados por campaña; los de prueba nunca entran al ajuste):
1. Rango esperado en vuelo (`nova_tl.expectativa`): línea base de Tierra + corrector poblacional + ajuste personal.
2. Pronóstico a 7 días con PatchTST: el modelo de Tierra se entrena en cada fold con LifeSnaps y el pre-reposo de los
   sujetos de entrenamiento solamente; se evalúa sin adaptar y adaptado, contra modelos sin Tierra y baselines.
"""

import glob
import hashlib
import json
import subprocess
import sys
import time
import traceback
import zipfile
from importlib import metadata
from pathlib import Path

T0 = time.time()
SALIDA = Path("/kaggle/working/salida") if Path("/kaggle").exists() else Path("salida")
SALIDA.mkdir(parents=True, exist_ok=True)
(SALIDA / "pesos").mkdir(exist_ok=True)
LOG = SALIDA / "log.txt"
METRICAS: dict = {"etapas": {}, "avisos": [], "historias": {}}


def log(*a):
    linea = f"[{time.time() - T0:7.1f}s] " + " ".join(str(x) for x in a)
    print(linea, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(linea + "\n")


def guardar():
    METRICAS["segundos"] = round(time.time() - T0, 1)
    (SALIDA / "metricas.json").write_text(json.dumps(METRICAS, indent=2, ensure_ascii=False, default=str),
                                          encoding="utf-8")


def fallo(etapa: str, e: Exception):
    METRICAS["etapas"][etapa] = f"error: {e!r}"
    log(f"ERROR {etapa}", repr(e))
    log(traceback.format_exc())


def preparar_codigo() -> Path:
    raiz = Path("/kaggle/input") if Path("/kaggle/input").exists() else Path("..")
    init = glob.glob(str(raiz / "**" / "nova_tl" / "__init__.py"), recursive=True)
    if init:
        sys.path.insert(0, str(Path(init[0]).parent.parent))
    else:
        zips = glob.glob(str(raiz / "**" / "nova_tl*.zip"), recursive=True)
        if not zips:
            raise FileNotFoundError(f"no encuentro nova_tl/ en {raiz}: ¿está adjunto el dataset benjacampos/nova-tl?")
        destino = Path("/kaggle/working/codigo")
        with zipfile.ZipFile(zips[0]) as z:
            z.extractall(destino)
        sys.path.insert(0, str(destino))
    datos = glob.glob(str(raiz / "**" / "reposo_largo.parquet"), recursive=True)
    if not datos:
        raise FileNotFoundError(f"no encuentro reposo_largo.parquet en {raiz}")
    return Path(datos[0]).parent


def version(paquete: str) -> str | None:
    try:
        return metadata.version(paquete)
    except metadata.PackageNotFoundError:
        return None


DATOS = preparar_codigo()
log("datos en", DATOS)

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from nova_tl import baselines, expectativa, graficos, incertidumbre, ventanas  # noqa: E402
from nova_tl.variables import TITULAR  # noqa: E402

METRICAS["entorno"] = {p: version(p) for p in ("pandas", "numpy", "scikit-learn", "scipy", "torch", "transformers")}
SEMILLA, C, H = 0, 14, 7
reposo = pd.read_parquet(DATOS / "reposo_largo.parquet")
tierra = pd.read_parquet(DATOS / "tierra_largo.parquet")
sujetos = sorted(reposo.sujeto.unique())
campana = reposo.groupby("sujeto")["campana"].first()
_rng = np.random.default_rng(SEMILLA)
_orden = [s for c in sorted(campana.unique()) for s in _rng.permutation(sorted(campana[campana == c].index))]
FOLDS = [([s for s in sujetos if s not in set(_orden[i::5])], list(_orden[i::5])) for i in range(5)]
METRICAS["datos"] = {
    "reposo_sujetos": len(sujetos), "reposo_mediciones": len(reposo), "sujetos_por_campana":
        campana.value_counts().to_dict(), "tierra_personas": int(tierra.sujeto.nunique()),
    "tierra_mediciones": len(tierra), "folds": [f[1] for f in FOLDS],
    "sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest()[:16] for p in sorted(DATOS.glob("*.parquet"))}}

# ── Tarea 1: rango esperado (CPU) ────────────────────────────────────────────────────────────────────────────────
try:
    # coeficientes del corrector poblacional con los 29 sujetos: viajan en el paquete firmado (se escriben primero)
    lb = expectativa.linea_base(reposo)
    pob = expectativa.ajustar_poblacion(expectativa._en_reposo(reposo, lb))
    (SALIDA / "pesos" / "corrector_poblacion.json").write_text(json.dumps(
        {v: {"rasgos": ["log1p(dia)", "dia/30"], "coef": m.coef_.tolist(), "intercepto": float(m.intercept_)}
         for v, m in pob.items()}, indent=2), encoding="utf-8")
    desp = expectativa.desplazamiento(reposo)
    desp.to_csv(SALIDA / "desplazamiento_reposo.csv", index=False)
    METRICAS["desplazamiento"] = desp.round(3).to_dict("records")
    reg = expectativa.evaluar(reposo, FOLDS, semilla=SEMILLA)
    reg.to_csv(SALIDA / "rango_esperado_por_sujeto.csv", index=False)
    tab = expectativa.resumir(reg, semilla=SEMILLA)
    tab.to_csv(SALIDA / "rango_esperado.csv", index=False)
    plac = expectativa.resumir_placebo(expectativa.placebo_pre(reposo), semilla=SEMILLA)
    plac.to_csv(SALIDA / "placebo_pre.csv", index=False)
    METRICAS["rango_esperado"] = expectativa.titular(tab, plac, reg, semilla=SEMILLA)
    METRICAS["etapas"]["rango_esperado"] = "ok"
    log("rango esperado listo")
except Exception as e:  # noqa: BLE001
    tab = plac = None
    fallo("rango_esperado", e)
guardar()

# ── Tarea 2: PatchTST ────────────────────────────────────────────────────────────────────────────────────────────
import torch  # noqa: E402

from nova_tl import modelo  # noqa: E402

DEV = "cuda" if torch.cuda.is_available() else "cpu"
METRICAS["entorno"].update(device=DEV, gpu=torch.cuda.get_device_name(0) if DEV == "cuda" else None)
log("device", DEV, METRICAS["entorno"])

ls_personas = sorted(tierra.sujeto.unique())
val_ls = set(np.random.default_rng(SEMILLA).choice(ls_personas, size=7, replace=False))
w_ls = ventanas.construir(tierra, C, H, min_ctx=7, relleno_inicio=True)
w_pre = ventanas.construir(reposo, C, H, min_ctx=5, fases_objetivo={"PRE_TEST"}, relleno_inicio=True)
w_in = ventanas.construir(reposo, C, H, min_ctx=5, fases_objetivo={"IN_TEST"}, relleno_inicio=True)
METRICAS["ventanas"] = {"lifesnaps": len(w_ls), "reposo_pre": len(w_pre), "reposo_in": len(w_in)}
log("ventanas", METRICAS["ventanas"])
guardar()


def de(w, suj):
    return w.filtrar(w.meta.sujeto.isin(set(suj)))


def sin(w, suj):
    return w.filtrar(~w.meta.sujeto.isin(set(suj)))


def ruido_de(suj_reposo):
    return ventanas.ruido_por_variable(pd.concat([tierra, reposo[(reposo.fase == "PRE_TEST")
                                                                 & reposo.sujeto.isin(set(suj_reposo))]]))


def entrenar_base(suj_tr, suj_val, ruido, semilla):
    """Modelo de Tierra: LifeSnaps + pre-reposo de `suj_tr`; parada temprana con LifeSnaps y pre-reposo apartados."""
    tr = ventanas.Ventanas.unir([sin(w_ls, val_ls), de(w_pre, suj_tr)])
    va = ventanas.Ventanas.unir([de(w_ls, val_ls), de(w_pre, suj_val)])
    base = modelo.crear(C, H, semilla)
    info = modelo.entrenar(base, tr, va, epocas=60, lr=1e-3, device=DEV, semilla=semilla, ruido=ruido)
    return base, {"ventanas_train": len(tr), "ventanas_val": len(va), **info}


eval_in = w_in.meta.dia0 >= C  # contexto entero dentro del reposo
filas: list[dict] = []


def registrar(nombre, yhat, v, fase_eval, fold, destino=filas):
    d = v.meta[["variable", "sujeto"]].assign(e=baselines.mae(yhat, v))
    for (var, suj), g in d.groupby(["variable", "sujeto"]):
        destino.append({"modelo": nombre, "variable": var, "sujeto": suj, "fase": fase_eval, "fold": fold,
                        "n": len(g), "mae_sum": float(g["e"].sum())})


try:
    for f, (train, test) in enumerate(FOLDS):
        val_suj = sorted(np.random.default_rng(SEMILLA + f).choice(train, size=4, replace=False))
        tr_suj = [s for s in train if s not in set(val_suj)]
        ruido = ruido_de(train)
        base, info_b = entrenar_base(tr_suj, val_suj, ruido, SEMILLA + f)
        te_in, te_pre = w_in.filtrar(w_in.meta.sujeto.isin(test) & eval_in), de(w_pre, test)
        tr_in, va_in = de(w_in, tr_suj), de(w_in, val_suj)
        for v, fase in [(te_in, "reposo"), (te_pre, "pre")]:
            registrar("persistencia", baselines.persistencia(v), v, fase, f)
            registrar("media7", baselines.media7(v), v, fase, f)
            registrar("tierra (sin adaptar)", modelo.predecir(base, v, DEV), v, fase, f)
        hist = {"base": info_b}
        m = modelo.crear(C, H, SEMILLA + 100 + f)
        hist["solo espacio"] = modelo.entrenar(m, tr_in, va_in, epocas=60, lr=1e-3, device=DEV, semilla=SEMILLA,
                                               ruido=ruido)
        registrar("solo espacio (sin Tierra)", modelo.predecir(m, te_in, DEV), te_in, "reposo", f)
        m = modelo.crear(C, H, SEMILLA + 200 + f)
        hist["solo reposo"] = modelo.entrenar(
            m, ventanas.Ventanas.unir([de(w_pre, tr_suj), tr_in]), ventanas.Ventanas.unir([de(w_pre, val_suj), va_in]),
            epocas=60, lr=1e-3, device=DEV, semilla=SEMILLA, ruido=ruido)
        registrar("solo reposo (sin LifeSnaps)", modelo.predecir(m, te_in, DEV), te_in, "reposo", f)
        for modo in ("cabeza", "todo"):
            m, hist[f"tl {modo}"] = modelo.adaptar(base, tr_in, va_in, modo, DEV, semilla=SEMILLA, ruido=ruido)
            registrar(f"tierra→espacio ({modo})", modelo.predecir(m, te_in, DEV), te_in, "reposo", f)
        METRICAS["historias"][f"fold{f}"] = hist
        log(f"fold {f} listo", {k: round(h["mejor_val"], 3) for k, h in hist.items()})
        pd.DataFrame(filas).to_csv(SALIDA / "pronostico_por_sujeto.csv", index=False)
        guardar()
    METRICAS["etapas"]["pronostico"] = "ok"
except Exception as e:  # noqa: BLE001
    fallo("pronostico", e)

# modelos que se publican (ninguna cifra sale de ellos): Tierra con todo el pre-reposo, y adaptado con los 29 sujetos
try:
    val_suj = sorted(np.random.default_rng(SEMILLA).choice(sujetos, size=4, replace=False))
    resto = [s for s in sujetos if s not in set(val_suj)]
    ruido = ruido_de(sujetos)
    base, info_b = entrenar_base(resto, val_suj, ruido, SEMILLA)
    base.save_pretrained(SALIDA / "pesos" / "nova-tierra")
    final, info_f = modelo.adaptar(base, de(w_in, resto), de(w_in, val_suj), "cabeza", DEV, semilla=SEMILLA,
                                   ruido=ruido)
    final.save_pretrained(SALIDA / "pesos" / "nova-espacio")
    (SALIDA / "pesos" / "ruido_por_variable.json").write_text(json.dumps(ruido, indent=2), encoding="utf-8")
    METRICAS["historias"]["publicados"] = {"nova-tierra": info_b, "nova-espacio": info_f}
    METRICAS["etapas"]["pesos"] = "ok"
    log("pesos guardados")
except Exception as e:  # noqa: BLE001
    fallo("pesos", e)
guardar()

# Chronos-2 sin adaptar, como referencia (va al final: instalarlo puede cambiar paquetes ya importados)
try:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "chronos-forecasting>=2.0"], check=True)
    from chronos import Chronos2Pipeline

    METRICAS["entorno"]["chronos-forecasting"] = version("chronos-forecasting")
    pipe = Chronos2Pipeline.from_pretrained("amazon/chronos-2", device_map=DEV)
    chronos: list[dict] = []
    for f, (train, test) in enumerate(FOLDS):
        for v, fase in [(w_in.filtrar(w_in.meta.sujeto.isin(test) & eval_in), "reposo"), (de(w_pre, test), "pre")]:
            ctx = np.where(v.mx.astype(bool), v.x, np.nan)
            fechas = pd.date_range("2020-01-01", periods=C, freq="D")
            cdf = pd.DataFrame({"id": np.repeat(np.arange(len(v)), C), "timestamp": np.tile(fechas, len(v)),
                                "target": ctx.ravel()})
            cdf["target"] = cdf.groupby("id")["target"].transform(lambda s: s.ffill().bfill())
            p = pipe.predict_df(cdf, prediction_length=H, quantile_levels=[0.1, 0.5, 0.9], id_column="id",
                                timestamp_column="timestamp", target="target")
            col = "0.5" if "0.5" in p.columns else "predictions"
            yhat = p.sort_values(["id", "timestamp"])[col].to_numpy(np.float32).reshape(len(v), H)
            registrar("chronos-2 (sin adaptar)", yhat, v, fase, f, destino=chronos)
    filas.extend(chronos)  # solo si corrió en los 5 folds
    METRICAS["etapas"]["chronos2"] = "ok"
except Exception as e:  # noqa: BLE001
    fallo("chronos2", e)

# ── Resumen del pronóstico ───────────────────────────────────────────────────────────────────────────────────────
pron = None
try:
    por_suj = pd.DataFrame(filas)
    por_suj.to_csv(SALIDA / "pronostico_por_sujeto.csv", index=False)
    pron = por_suj.groupby(["modelo", "variable", "fase"], as_index=False).agg(
        sujetos=("sujeto", "nunique"), n=("n", "sum"), mae_sum=("mae_sum", "sum"))
    pron["mae"] = pron["mae_sum"] / pron["n"]
    ref = pron[pron.modelo == "persistencia"][["variable", "fase", "mae"]].rename(columns={"mae": "_ref"})
    pron = pron.merge(ref, on=["variable", "fase"], how="left")
    pron["mae_rel_persistencia"] = pron["mae"] / pron["_ref"]
    pron = pron.drop(columns=["mae_sum", "_ref"])
    pron.to_csv(SALIDA / "pronostico.csv", index=False)
    METRICAS["pronostico_mae_rel_medio_sin_agua"] = (
        pron[pron.variable.isin(TITULAR)].groupby(["modelo", "fase"])["mae_rel_persistencia"].mean().round(3)
        .reset_index().to_dict("records"))
    pares = [("tierra→espacio (cabeza)", "media7"), ("tierra→espacio (todo)", "media7"),
             ("tierra (sin adaptar)", "media7"), ("tierra→espacio (cabeza)", "solo espacio (sin Tierra)"),
             ("tierra→espacio (cabeza)", "solo reposo (sin LifeSnaps)"),
             ("solo reposo (sin LifeSnaps)", "solo espacio (sin Tierra)")]
    if "chronos-2 (sin adaptar)" in set(por_suj.modelo):
        pares.append(("chronos-2 (sin adaptar)", "media7"))
    METRICAS["pronostico_comparaciones"] = [
        incertidumbre.diferencia_relativa_media(por_suj, a, b, "persistencia", TITULAR, "reposo", semilla=SEMILLA)
        for a, b in pares]
    METRICAS["etapas"]["resumen_pronostico"] = "ok"
    log("pronóstico resumido")
except Exception as e:  # noqa: BLE001
    fallo("resumen_pronostico", e)
guardar()

# ── Gráficos ──────────────────────────────────────────────────────────────────────────────────────────────────────
try:
    METRICAS["graficos"] = graficos.todos(tab, plac, pron, SALIDA / "graficos")
    METRICAS["etapas"]["graficos"] = "ok"
except Exception as e:  # noqa: BLE001
    fallo("graficos", e)

# Los pesos se suben a Hugging Face desde el PC (`kaggle kernels output`): la CLI de Kaggle no maneja secretos.
METRICAS["etapas"]["huggingface"] = "pendiente: se sube desde el PC"
log("fin")
guardar()
