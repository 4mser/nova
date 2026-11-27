"""Validación de ángulos contra goniómetro: hoja de medición y cálculo de errores.

    python -m pose_twin.validacion plantilla
    python -m pose_twin.validacion calcular

CONVENCIÓN. `geometria` entrega el ángulo interior en el vértice (180 = articulación extendida).
El goniómetro se lee en FLEXIÓN (0 = extendida). Aquí todo se compara en flexión:
flexión = 180 - interior. El hombro no se admite porque su ángulo interior no sigue esa regla.

Nunca abre la cámara: solo lee archivos existentes (videos o CSV de sesión).
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import random
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .geometria import ANGULOS

RAIZ = Path(__file__).resolve().parents[1]
CARPETA = RAIZ / "data" / "validacion"
HOJA = CARPETA / "hoja.csv"

# Articulaciones donde flexión = 180 - interior. El orden define el de la hoja (rodilla primero).
ARTICULACIONES = ("rodilla", "codo", "cadera")
LADOS = ("izq", "der")
OBJETIVOS = (30, 60, 90, 120)
REPETICIONES = 3
COLUMNAS = ["orden", "articulacion", "lado", "angulo_objetivo_flexion", "repeticion",
            "goniometro_flexion", "archivo", "inicio_s", "fin_s", "notas"]
EXT_VIDEO = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}

# Criterio de aceptación: elección del equipo, no es un estándar.
CRITERIO = {"criterio_mae_deg": 5.0, "min_cuadros": 10, "min_fraccion_valida": 0.5}
AVISO_OBJETIVO_DEG = 20.0  # lectura muy lejos del objetivo: posible error de convención o de fila
RANGO_GONIOMETRO = (-20.0, 180.0)


class ErrorValidacion(RuntimeError):
    pass


def interior_a_flexion(interior_deg: float) -> float:
    """Ángulo interior de `geometria` (180 = extendida) a flexión de goniómetro (0 = extendida)."""
    return 180.0 - interior_deg


# ---------------------------------------------------------------- plantilla

def ruta_criterio(hoja: Path) -> Path:
    return hoja.with_suffix(".criterio.json")


def filas_plantilla(articulaciones, lados, objetivos, repeticiones: int, semilla: int) -> list[dict]:
    """Una fila por medición. Se mantiene el bloque articulación-lado (para no mover la cámara en cada
    medición) y dentro de cada bloque se aleatoriza el orden de ángulos y repeticiones."""
    azar = random.Random(semilla)
    filas: list[dict] = []
    for art in sorted(articulaciones, key=ARTICULACIONES.index):
        for lado in lados:
            bloque = [(obj, rep) for obj in objetivos for rep in range(1, repeticiones + 1)]
            azar.shuffle(bloque)
            for obj, rep in bloque:
                fila = dict.fromkeys(COLUMNAS, "")
                fila.update(orden=len(filas) + 1, articulacion=art, lado=lado,
                            angulo_objetivo_flexion=obj, repeticion=rep)
                filas.append(fila)
    return filas


def crear_plantilla(hoja: Path, articulaciones=("rodilla",), lados=LADOS, objetivos=OBJETIVOS,
                    repeticiones: int = REPETICIONES, semilla: int | None = None,
                    criterio_mae: float = CRITERIO["criterio_mae_deg"], forzar: bool = False) -> Path:
    for nombre, valores, validos in (("articulación", articulaciones, ARTICULACIONES), ("lado", lados, LADOS)):
        malos = [v for v in valores if v not in validos]
        if malos or not valores:
            raise ErrorValidacion(f"{nombre} no admitida: {', '.join(malos) or '(vacío)'}. Usa: {', '.join(validos)}.")
    if repeticiones < 1 or not objetivos or not criterio_mae > 0:
        raise ErrorValidacion("Se necesita al menos 1 repetición, 1 ángulo objetivo y un criterio mayor que 0.")
    if not forzar:
        for r in (hoja, ruta_criterio(hoja)):
            if r.exists():
                raise ErrorValidacion(f"Ya existe {r}. No se sobrescribe (usa --hoja con otro nombre o --forzar).")
    semilla = random.SystemRandom().randrange(1_000_000) if semilla is None else semilla
    filas = filas_plantilla(articulaciones, lados, objetivos, repeticiones, semilla)
    hoja.parent.mkdir(parents=True, exist_ok=True)
    with open(hoja, "w", newline="", encoding="utf-8-sig") as f:  # BOM: Excel respeta los acentos
        w = csv.DictWriter(f, fieldnames=COLUMNAS)
        w.writeheader()
        w.writerows(filas)
    datos = {**CRITERIO, "criterio_mae_deg": criterio_mae, "semilla": semilla,
             "fijado_el": time.strftime("%Y-%m-%d %H:%M:%S"),
             "nota": "Criterio elegido por el equipo antes de medir. No es un estándar."}
    ruta_criterio(hoja).write_text(json.dumps(datos, indent=2, ensure_ascii=False), encoding="utf-8")
    return hoja


# ---------------------------------------------------------------- lectura

def _leer_csv(ruta: Path) -> list[dict]:
    """Lee CSV con coma o punto y coma (Excel en español), UTF-8 o cp1252."""
    crudo = ruta.read_bytes()
    try:
        texto = crudo.decode("utf-8-sig")
    except UnicodeDecodeError:
        texto = crudo.decode("cp1252")
    cabecera = texto.split("\n", 1)[0]
    sep = ";" if cabecera.count(";") > cabecera.count(",") else ","
    return list(csv.DictReader(io.StringIO(texto, newline=""), delimiter=sep))


def numero(txt: str | None, campo: str) -> float | None:
    """Número con punto o coma decimal; None si la celda está vacía."""
    t = (txt or "").strip()
    if not t:
        return None
    try:
        v = float(t.replace(",", "."))
    except ValueError:
        raise ErrorValidacion(f"{campo}: '{t}' no es un número") from None
    if not math.isfinite(v):
        raise ErrorValidacion(f"{campo}: '{t}' no es un número finito")
    return v


def segundos(txt: str | None, campo: str) -> float | None:
    """Segundos ('75', '75,5') o minutos:segundos ('1:15')."""
    t = (txt or "").strip()
    if ":" not in t:
        return numero(t, campo)
    partes = t.split(":")
    if len(partes) != 2:
        raise ErrorValidacion(f"{campo}: usa segundos o minutos:segundos, no '{t}'")
    return 60 * (numero(partes[0], campo) or 0.0) + (numero(partes[1], campo) or 0.0)


@dataclass
class Tramo:
    flexion: float | None  # mediana en flexión; None = abstención
    cuadros: int
    validos: int
    dispersion: float | None  # desviación estándar dentro del tramo

    @property
    def fraccion(self) -> float:
        return self.validos / self.cuadros if self.cuadros else 0.0


def extraer_tramo(filas: list[dict], columna: str, inicio: float | None, fin: float | None,
                  min_cuadros: int, min_fraccion: float) -> Tramo:
    """Mediana (en flexión) de la columna de un CSV de sesión entre inicio y fin (incluidos)."""
    if not filas:
        raise ErrorValidacion("el CSV de sesión no tiene cuadros")
    faltan = [c for c in ("t_s", columna) if c not in filas[0]]
    if faltan:
        raise ErrorValidacion(f"el CSV no es de sesión: faltan las columnas {', '.join(faltan)}")
    if inicio is not None and fin is not None and fin <= inicio:
        raise ErrorValidacion("fin_s debe ser mayor que inicio_s")
    sel = []
    for f in filas:
        t = numero(f["t_s"], "t_s")
        if t is None:
            raise ErrorValidacion("el CSV tiene cuadros sin t_s")
        if (inicio is None or t >= inicio) and (fin is None or t <= fin):
            sel.append(f)
    if not sel:
        raise ErrorValidacion("no hay cuadros en el tramo indicado (revisa inicio_s y fin_s)")
    vals = [v for v in (numero(f[columna], columna) for f in sel) if v is not None]
    n, v = len(sel), len(vals)
    if v < min_cuadros or v / n < min_fraccion:
        return Tramo(None, n, v, None)
    flex = np.array([interior_a_flexion(x) for x in vals])
    return Tramo(float(np.median(flex)), n, v, float(np.std(flex, ddof=1)) if v > 1 else None)


def resolver_archivo(nombre: str, carpeta_hoja: Path) -> Path:
    p = Path(nombre.strip().strip('"'))
    candidatos = [p] if p.is_absolute() else [b / p for b in (carpeta_hoja, RAIZ, RAIZ / "data" / "sesiones")]
    for c in candidatos:
        if c.is_file():
            return c
    raise ErrorValidacion(f"no encuentro el archivo '{nombre}'")


def procesar_video(video: Path, salida_csv: Path, modelo: str, umbral_vis: float, delegado: str) -> Path:
    """Genera el CSV de sesión de un video con el mismo procesador que usa la aplicación."""
    from .fuente import ErrorFuente, Reloj, abrir_fuente
    from .sesion import Procesador

    proc = Procesador(modelo=modelo, umbral_vis=umbral_vis, csv_ruta=salida_csv, delegado=delegado)
    fuente = None
    try:
        fuente = abrir_fuente(str(video))
        reloj, n = Reloj(), 0
        while True:
            ok, img, t_ms = fuente.leer()
            if not ok:
                break
            proc.paso(img, t_ms, reloj.tic())
            n += 1
            if n % 100 == 0:
                print(f"  {video.name}: {n} cuadros...", flush=True)
    except ErrorFuente as e:
        raise ErrorValidacion(str(e)) from e
    finally:
        proc.cerrar()
        if fuente is not None:
            fuente.cerrar()
    return salida_csv


# ---------------------------------------------------------------- evaluación

def evaluar(filas: list[dict], carpeta_hoja: Path, salida: Path, criterio: dict,
            modelo: str = "heavy", umbral_vis: float = 0.6, delegado: str = "auto") -> list[dict]:
    """Una entrada por fila de la hoja, con estado: ok, abstencion, pendiente o error."""
    sesiones: dict[Path, list[dict]] = {}
    res: list[dict] = []
    for i, f in enumerate(filas, start=2):  # fila 1 = cabecera
        f = {k: (v or "").strip() for k, v in f.items() if k}
        r = {**{c: f.get(c, "") for c in COLUMNAS}, "fila": i, "estado": "pendiente", "motivo": "",
             "aviso": "", "goniometro": None, "estimado": None, "error": None, "cuadros": 0,
             "validos": 0, "dispersion_tramo": None}
        res.append(r)
        if not r["goniometro_flexion"] or not r["archivo"]:
            r["motivo"] = "falta lectura del goniómetro o archivo"
            continue
        try:
            art, lado = r["articulacion"].lower(), r["lado"].lower()
            columna = f"{art}_{lado}"
            if art not in ARTICULACIONES or columna not in ANGULOS:
                raise ErrorValidacion(f"articulación o lado no admitidos: '{art}', '{lado}'")
            r["articulacion"], r["lado"] = art, lado
            gon = numero(r["goniometro_flexion"], "goniometro_flexion")
            if not RANGO_GONIOMETRO[0] <= gon <= RANGO_GONIOMETRO[1]:
                raise ErrorValidacion(f"lectura del goniómetro fuera de rango: {gon:g}")
            r["goniometro"] = gon
            objetivo = numero(r["angulo_objetivo_flexion"], "angulo_objetivo_flexion")
            if objetivo is not None and abs(gon - objetivo) > AVISO_OBJETIVO_DEG:
                r["aviso"] = (f"lectura {gon:g} lejos del objetivo {objetivo:g}: revisa que sea flexión "
                              "(0 = extendida) y que la fila sea la correcta")
            inicio, fin = segundos(r["inicio_s"], "inicio_s"), segundos(r["fin_s"], "fin_s")
            ruta = resolver_archivo(r["archivo"], carpeta_hoja)
            if ruta not in sesiones:
                if ruta.suffix.lower() == ".csv":
                    sesiones[ruta] = _leer_csv(ruta)
                elif ruta.suffix.lower() in EXT_VIDEO:
                    destino = salida / "sesiones" / f"{len(sesiones) + 1:02d}_{ruta.stem}.csv"
                    sesiones[ruta] = _leer_csv(procesar_video(ruta, destino, modelo, umbral_vis, delegado))
                else:
                    raise ErrorValidacion(f"tipo de archivo no admitido: {ruta.suffix}")
            t = extraer_tramo(sesiones[ruta], columna, inicio, fin,
                              int(criterio["min_cuadros"]), float(criterio["min_fraccion_valida"]))
        except ErrorValidacion as e:
            r["estado"], r["motivo"] = "error", str(e)
            continue
        r.update(cuadros=t.cuadros, validos=t.validos, dispersion_tramo=t.dispersion)
        if t.flexion is None:
            r["estado"] = "abstencion"
            r["motivo"] = f"solo {t.validos} de {t.cuadros} cuadros con ángulo"
        else:
            r.update(estado="ok", estimado=t.flexion, error=t.flexion - gon)
    return res


def metricas(errores) -> dict:
    """Error = estimado - goniómetro. Límites de acuerdo: sesgo ± 1,96 desviaciones estándar."""
    e = np.asarray(list(errores), dtype=float)
    m = {"n": int(e.size), "mae": None, "sesgo": None, "de": None, "loa_inf": None, "loa_sup": None}
    if e.size:
        m["mae"], m["sesgo"] = float(np.mean(np.abs(e))), float(np.mean(e))
    if e.size > 1:
        m["de"] = float(np.std(e, ddof=1))
        m["loa_inf"], m["loa_sup"] = m["sesgo"] - 1.96 * m["de"], m["sesgo"] + 1.96 * m["de"]
    return m


def repetibilidad(res: list[dict]) -> tuple[list[dict], float | None]:
    """Dispersión entre repeticiones por (articulación, lado, objetivo) y desviación agrupada del error."""
    grupos: dict[tuple, list[dict]] = {}
    for r in res:
        if r["estado"] == "ok":
            grupos.setdefault((r["articulacion"], r["lado"], r["angulo_objetivo_flexion"]), []).append(r)
    tabla, suma, gl = [], 0.0, 0
    for (art, lado, obj), g in grupos.items():
        de = lambda k: float(np.std([r[k] for r in g], ddof=1)) if len(g) > 1 else None  # noqa: E731
        fila = {"articulacion": art, "lado": lado, "objetivo": obj, "n": len(g), "de_goniometro": de("goniometro"),
                "de_estimado": de("estimado"), "de_error": de("error")}
        tabla.append(fila)
        if len(g) > 1:
            suma += fila["de_error"] ** 2 * (len(g) - 1)
            gl += len(g) - 1
    return tabla, math.sqrt(suma / gl) if gl else None


def veredicto(res: list[dict], articulacion: str, criterio_mae: float) -> str:
    filas = [r for r in res if r["articulacion"].lower() == articulacion]
    ok = [r["error"] for r in filas if r["estado"] == "ok"]
    if not ok:
        return "SIN DATOS"
    v = "CUMPLE" if metricas(ok)["mae"] <= criterio_mae else "NO CUMPLE"
    fuera = len(filas) - len(ok)
    return f"{v} (parcial: {fuera} de {len(filas)} mediciones sin estimación)" if fuera else v


# ---------------------------------------------------------------- gráficos

def graficar(res: list[dict], ruta: Path, titulo: str = "Validación contra goniómetro") -> str:
    """Dos paneles (comparación y Bland-Altman). Devuelve la librería usada."""
    ok = [r for r in res if r["estado"] == "ok"]
    if not ok:
        raise ErrorValidacion("no hay mediciones válidas para graficar")
    ref = np.array([r["goniometro"] for r in ok])
    est = np.array([r["estimado"] for r in ok])
    m = metricas(est - ref)
    lineas = [(m["sesgo"], "sesgo")]
    if m["de"] is not None:
        lineas += [(m["loa_inf"], "límite inferior"), (m["loa_sup"], "límite superior")]
    ruta.parent.mkdir(parents=True, exist_ok=True)
    try:
        from matplotlib.figure import Figure
    except ImportError:
        _graficar_cv2(ref, est, lineas, ruta, titulo)
        return "cv2"
    fig = Figure(figsize=(11, 4.8), dpi=120, layout="constrained")
    a, b = fig.subplots(1, 2)
    lim = (min(ref.min(), est.min()) - 5, max(ref.max(), est.max()) + 5)
    a.plot(lim, lim, "--", color="gray", linewidth=1, label="acuerdo perfecto")
    a.scatter(ref, est, color="#1f6feb")
    a.set(xlabel="Goniómetro, flexión (grados)", ylabel="pose-twin, flexión (grados)", xlim=lim, ylim=lim,
          title="Comparación")
    a.legend()
    b.scatter((ref + est) / 2, est - ref, color="#1f6feb")
    b.axhline(0, color="lightgray", linewidth=1)
    for y, nombre in lineas:
        b.axhline(y, color="#d1242f" if nombre == "sesgo" else "#9a6700", linestyle="--",
                  label=f"{nombre}: {y:+.1f}")
    b.set(xlabel="Media de ambos (grados)", ylabel="pose-twin - goniómetro (grados)", title="Bland-Altman")
    b.margins(y=0.25)
    b.legend(fontsize=8)
    fig.suptitle(f"{titulo} (n = {len(ok)})")
    fig.savefig(ruta)
    return "matplotlib"


def _graficar_cv2(ref, est, lineas, ruta: Path, titulo: str) -> None:
    import cv2

    img = np.full((600, 1200, 3), 255, np.uint8)

    def texto(s, x, y, escala=0.5, color=(30, 30, 30)):
        s = s.replace("ó", "o").replace("í", "i").replace("é", "e").replace("á", "a")  # Hershey no tiene acentos
        cv2.putText(img, s, (int(x), int(y)), cv2.FONT_HERSHEY_SIMPLEX, escala, color, 1, cv2.LINE_AA)

    def panel(x0, xs, ys, lim_x, lim_y, nombre, eje_x, eje_y):
        izq, der, arr, aba = x0 + 70, x0 + 570, 90, 530

        def px(x, y):
            return (int(izq + (x - lim_x[0]) / (lim_x[1] - lim_x[0]) * (der - izq)),
                    int(aba - (y - lim_y[0]) / (lim_y[1] - lim_y[0]) * (aba - arr)))

        cv2.rectangle(img, (izq, arr), (der, aba), (120, 120, 120), 1)
        for k in range(5):
            vx = lim_x[0] + k * (lim_x[1] - lim_x[0]) / 4
            vy = lim_y[0] + k * (lim_y[1] - lim_y[0]) / 4
            texto(f"{vx:.0f}", px(vx, lim_y[0])[0] - 10, aba + 18, 0.4)
            texto(f"{vy:.1f}", izq - 45, px(lim_x[0], vy)[1] + 4, 0.4)
        texto(nombre, izq, arr - 25, 0.6)
        texto(f"y: {eje_y}", izq, arr - 8, 0.4)
        texto(f"x: {eje_x}", izq, aba + 40, 0.4)
        for x, y in zip(xs, ys):
            cv2.circle(img, px(x, y), 5, (235, 111, 31), -1, cv2.LINE_AA)
        return px

    texto(f"{titulo} (n = {len(ref)})", 20, 30, 0.7)
    lim = (min(ref.min(), est.min()) - 5, max(ref.max(), est.max()) + 5)
    px = panel(0, ref, est, lim, lim, "Comparación", "goniómetro (grados)", "pose-twin (grados)")
    cv2.line(img, px(lim[0], lim[0]), px(lim[1], lim[1]), (150, 150, 150), 1, cv2.LINE_AA)
    medias, dif = (ref + est) / 2, est - ref
    todos = [*dif, 0.0, *(y for y, _ in lineas)]
    margen = max(1.0, 0.15 * (max(todos) - min(todos)))
    lx = (medias.min() - 5, medias.max() + 5)
    px = panel(600, medias, dif, lx, (min(todos) - margen, max(todos) + margen), "Bland-Altman",
               "media de ambos (grados)", "pose-twin - goniómetro (grados)")
    for y, nombre in lineas:
        color = (47, 36, 209) if nombre == "sesgo" else (0, 103, 154)
        p0, p1 = px(lx[0], y), px(lx[1], y)
        cv2.line(img, p0, p1, color, 1, cv2.LINE_AA)
        texto(f"{nombre}: {y:+.1f}", p0[0] + 5, p0[1] - 5, 0.4, color)
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise ErrorValidacion("cv2 no pudo generar la imagen")
    ruta.write_bytes(buf.tobytes())  # evita problemas de cv2.imwrite con rutas con acentos


# ---------------------------------------------------------------- informe

def _f(v, signo: bool = False) -> str:
    if v is None:
        return "-"
    return f"{v:+.1f}" if signo else f"{v:.1f}"


def _tabla(cabecera: list[str], filas: list[list]) -> list[str]:
    limpio = lambda c: str(c).replace("|", "/").replace("\n", " ")  # noqa: E731
    return ["| " + " | ".join(cabecera) + " |", "|" + "---|" * len(cabecera),
            *("| " + " | ".join(limpio(c) for c in f) + " |" for f in filas), ""]


def informe(res: list[dict], criterio: dict, notas_criterio: list[str], imagen: str | None,
            ajustes: str = "") -> str:
    umbral = float(criterio["criterio_mae_deg"])
    cuenta = {e: sum(r["estado"] == e for r in res) for e in ("ok", "abstencion", "pendiente", "error")}
    arts = list(dict.fromkeys(r["articulacion"].lower() for r in res))
    lin = ["# Validación de ángulos contra goniómetro", "",
           f"Generado: {time.strftime('%Y-%m-%d %H:%M')}. Todos los ángulos en flexión (0 = extendida). "
           "Error = pose-twin - goniómetro.", "", "## Criterio de aceptación", "",
           f"Error absoluto medio <= {umbral:g} grados por articulación. Es una elección del equipo, "
           "no un estándar.", ""]
    lin += [f"- {n}" for n in notas_criterio]
    lin += [f"- Abstención: tramo con menos de {criterio['min_cuadros']} cuadros con ángulo o con menos del "
            f"{100 * float(criterio['min_fraccion_valida']):.0f} % de sus cuadros.", ""]
    lin += _tabla(["Articulación", "Resultado"], [[a, veredicto(res, a, umbral)] for a in arts])
    intentadas = cuenta["ok"] + cuenta["abstencion"]
    lin += ["## Cobertura", "",
            f"- Filas: {len(res)}. Con estimación: {cuenta['ok']}. Abstenciones: {cuenta['abstencion']}"
            f"{f' ({100 * cuenta['abstencion'] / intentadas:.0f} % de las procesadas)' if intentadas else ''}. "
            f"Pendientes: {cuenta['pendiente']}. Con error: {cuenta['error']}.",
            "- Las métricas solo usan las filas con estimación; las abstenciones pueden ocultar los casos difíciles.",
            ""]
    lin += ["## Métricas (grados)", ""]
    grupos = [("todas", [r for r in res if r["estado"] == "ok"])]
    claves = list(dict.fromkeys((r["articulacion"], r["lado"]) for r in res if r["estado"] == "ok"))
    grupos += [(f"{a} {lado}", [r for r in res if r["estado"] == "ok" and (r["articulacion"], r["lado"]) == (a, lado)])
               for a, lado in claves]
    filas_m = []
    for nombre, g in grupos:
        m = metricas(r["error"] for r in g)
        filas_m.append([nombre, m["n"], _f(m["mae"]), _f(m["sesgo"], True), _f(m["de"]),
                        f"{_f(m['loa_inf'], True)} a {_f(m['loa_sup'], True)}"])
    lin += _tabla(["Grupo", "n", "Error absoluto medio", "Sesgo", "DE del error",
                   "Límites de acuerdo 95 % (Bland-Altman)"], filas_m)
    tabla, agrupada = repetibilidad(res)
    lin += ["## Dispersión entre repeticiones (desviación estándar, grados)", "",
            f"Desviación agrupada del error: {_f(agrupada)}.", ""]
    lin += _tabla(["Articulación", "Lado", "Objetivo", "n", "Goniómetro", "pose-twin", "Error"],
                  [[t["articulacion"], t["lado"], t["objetivo"], t["n"], _f(t["de_goniometro"]),
                    _f(t["de_estimado"]), _f(t["de_error"])] for t in tabla])
    if imagen:
        lin += ["## Gráficos", "", f"![Comparación y Bland-Altman]({imagen})", ""]
    lin += ["## Detalle", ""]
    lin += _tabla(["Fila", "Articulación", "Lado", "Objetivo", "Rep.", "Goniómetro", "pose-twin", "Error",
                   "Cuadros válidos", "Estado", "Motivo o aviso"],
                  [[r["fila"], r["articulacion"], r["lado"], r["angulo_objetivo_flexion"], r["repeticion"],
                    _f(r["goniometro"]), _f(r["estimado"]), _f(r["error"], True), f"{r['validos']}/{r['cuadros']}",
                    r["estado"], "; ".join(x for x in (r["motivo"], r["aviso"]) if x)] for r in res])
    lin += ["## Límites", "",
            "- Una sola persona y pocas muestras: no se puede generalizar a otras personas, ropa, cámaras ni luz.",
            "- Las medidas repetidas de la misma persona no son independientes: los límites de acuerdo son "
            "descriptivos y probablemente más estrechos que los reales. No se reportan intervalos de confianza.",
            "- El goniómetro también tiene error y depende de quien mide; no es la verdad absoluta.",
            "- La lectura del goniómetro y la grabación no son simultáneas: si la persona se mueve entre ambas, "
            "ese movimiento aparece como error.",
            "- Quien mide conoce el ángulo objetivo (no hay ciego).",
            "- Posturas estáticas, vista lateral, una cámara: no dice nada del movimiento ni de microgravedad.",
            "- Los ángulos salen de puntos 3D estimados y suavizados (filtro One-Euro).",
            "- No es un dispositivo médico ni diagnostica.", ""]
    if ajustes:
        lin += ["## Reproducción", "", ajustes, ""]
    return "\n".join(lin)


def calcular(hoja: Path, salida: Path | None = None, criterio_mae: float | None = None, modelo: str = "heavy",
             umbral_vis: float = 0.6, delegado: str = "auto") -> tuple[Path, list[dict]]:
    if not hoja.is_file():
        raise ErrorValidacion(f"No existe la hoja {hoja}. Créala con: python -m pose_twin.validacion plantilla")
    filas = _leer_csv(hoja)
    faltan = [c for c in COLUMNAS if c not in ("orden", "notas") and (not filas or c not in filas[0])]
    if faltan:
        raise ErrorValidacion(f"A la hoja le faltan filas o columnas: {', '.join(faltan)}")
    criterio, notas = dict(CRITERIO), []
    rc = ruta_criterio(hoja)
    if rc.is_file():
        criterio.update(json.loads(rc.read_text(encoding="utf-8")))
        notas.append(f"Criterio registrado al crear la hoja ({criterio.get('fijado_el', 'sin fecha')}); "
                     f"semilla del orden: {criterio.get('semilla', 'sin dato')}.")
    else:
        notas.append("AVISO: no hay archivo de criterio junto a la hoja; no consta que se fijara antes de medir.")
    if criterio_mae is not None and criterio_mae != criterio["criterio_mae_deg"]:
        notas.append(f"AVISO: el criterio se cambió al calcular, de {criterio['criterio_mae_deg']:g} a "
                     f"{criterio_mae:g} grados. Ya no es un criterio fijado antes de medir.")
        criterio["criterio_mae_deg"] = criterio_mae
    salida = salida or hoja.parent / f"resultados_{hoja.stem}"
    salida.mkdir(parents=True, exist_ok=True)
    res = evaluar(filas, hoja.parent, salida, criterio, modelo, umbral_vis, delegado)
    imagen = salida / "graficos.png"
    imagen.unlink(missing_ok=True)  # que no quede un gráfico de una corrida anterior
    if any(r["estado"] == "ok" for r in res):
        graficar(res, imagen)
    ajustes = (f"Hoja `{hoja.name}`. Para videos: modelo {modelo}, umbral de visibilidad {umbral_vis:g}. "
               "Los CSV de sesión ya grabados conservan el modelo y el umbral con que se crearon.")
    ruta_informe = salida / "informe.md"
    ruta_informe.write_text(informe(res, criterio, notas, imagen.name if imagen.exists() else None, ajustes),
                            encoding="utf-8")
    return ruta_informe, res


# ---------------------------------------------------------------- CLI

def construir_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="pose_twin.validacion", description="Validación de ángulos contra goniómetro.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    pl = sub.add_parser("plantilla", help="crea la hoja de medición con orden aleatorizado")
    pl.add_argument("--hoja", type=Path, default=HOJA)
    pl.add_argument("--articulaciones", default="rodilla", help="separadas por coma: rodilla,codo,cadera")
    pl.add_argument("--lados", default="izq,der", help="izq,der (lados de la persona)")
    pl.add_argument("--semilla", type=int, default=None, help="semilla del orden aleatorio")
    pl.add_argument("--criterio-mae", type=float, default=CRITERIO["criterio_mae_deg"],
                    help="error absoluto medio máximo aceptado, en grados (elección del equipo)")
    pl.add_argument("--forzar", action="store_true", help="sobrescribe una hoja existente (borra lo anotado)")
    ca = sub.add_parser("calcular", help="calcula errores a partir de la hoja llena")
    ca.add_argument("--hoja", type=Path, default=HOJA)
    ca.add_argument("--salida", type=Path, default=None)
    ca.add_argument("--criterio-mae", type=float, default=None,
                    help="cambia el criterio (el informe avisa que se cambió)")
    ca.add_argument("--modelo", choices=["lite", "full", "heavy"], default="heavy")
    ca.add_argument("--umbral-vis", type=float, default=0.6)
    ca.add_argument("--delegado", choices=["auto", "gpu", "cpu"], default="auto")
    return ap


def main(argv=None) -> int:
    os.environ.setdefault("GLOG_minloglevel", "2")
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    for flujo in (sys.stdout, sys.stderr):
        if hasattr(flujo, "reconfigure"):
            flujo.reconfigure(encoding="utf-8", errors="replace")
    args = construir_parser().parse_args(argv)
    from .motor import ErrorModelo

    lista = lambda s: [x.strip().lower() for x in s.split(",") if x.strip()]  # noqa: E731
    try:
        if args.cmd == "plantilla":
            ruta = crear_plantilla(args.hoja, lista(args.articulaciones), lista(args.lados), semilla=args.semilla,
                                   criterio_mae=args.criterio_mae, forzar=args.forzar)
            print(f"Hoja creada: {ruta}\nCriterio registrado: {ruta_criterio(ruta)} "
                  f"(error absoluto medio <= {args.criterio_mae:g} grados; elección del equipo, no un estándar)")
            return 0
        ruta, res = calcular(args.hoja, args.salida, args.criterio_mae, args.modelo, args.umbral_vis, args.delegado)
    except (ErrorValidacion, ErrorModelo) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2
    except PermissionError as e:
        print(f"Error: sin acceso a {e.filename} (¿está abierto en Excel?)", file=sys.stderr)
        return 2
    cuenta = {e: sum(r["estado"] == e for r in res) for e in ("ok", "abstencion", "pendiente", "error")}
    print(f"Con estimación {cuenta['ok']} | abstenciones {cuenta['abstencion']} | "
          f"pendientes {cuenta['pendiente']} | errores {cuenta['error']}")
    for r in res:
        if r["estado"] == "error" or r["aviso"]:
            print(f"  fila {r['fila']}: {r['motivo'] or r['aviso']}")
    print(f"Informe: {ruta}")
    return 2 if cuenta["error"] else 0


if __name__ == "__main__":
    sys.exit(main())
