"""Paridad entre escaner/angulos.mjs y el código Python: Python genera casos y resultados, node los compara.

Datos sintéticos: solo comprueban que ambas implementaciones calculan lo mismo, no miden precisión.
"""
import csv
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from pose_twin import perfil as P
from pose_twin import sentadilla as Q
from pose_twin.filtros import FiltroAngulos
from pose_twin.geometria import ANGULOS, CUERPO, angulos_articulares, longitudes_segmentos
from tests.sinteticos import doblar_rodillas, pose_base, pose_falsa, procesador_falso, senal

RAIZ = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


def _secuencia(rng, tmp: Path, monkeypatch, nombre: str, buena: bool, paso_ms: int = 33,
               mover: bool = False) -> dict:
    """Corre el Procesador real (con motor, reloj y dibujo sustituidos) y anota cada resultado."""
    # mismos parámetros que `pose_twin live` (vivo.py)
    proc, reloj, salida = procesador_falso(monkeypatch, tmp, nombre_perfil=None, segundos_preparacion=6.0,
                                           segundos_calibracion=6.0)
    proc.nombre_perfil = nombre
    proc.decir = lambda *a, **k: None
    img = np.zeros((4, 4, 3), dtype=np.uint8)
    base = pose_base()
    cuadros = []
    segunda = 480 * 33 // paso_ms
    for n in range(1, segunda + 400 * 33 // paso_ms):
        t_ms = n * paso_ms + int(rng.integers(0, 8))
        reloj.t = t_ms / 1000.0
        calibrar = None
        if n in (30, segunda):  # dos calibraciones por secuencia
            proc.iniciar_calibracion()
            calibrar = reloj.t
        flexion = 90.0 * (n % 60) / 60 if mover and n > segunda else 0.0
        mundo = doblar_rodillas(base, flexion) + rng.normal(0, .012, base.shape)
        vis = rng.uniform(.82, 1.0, 33) if buena else rng.uniform(.3, .75, 33)
        if n % 41 < 4:
            vis[[25, 27]] = rng.uniform(.05, .55, 2)  # abstención de rodilla y cadera
        if not buena and segunda < n:
            vis = rng.uniform(.82, 1.0, 33) if n % 25 == 0 else vis  # muy pocas muestras buenas
        sin_persona = n % 97 < 3 or segunda - 20 < n < segunda - 10
        salida.pose = None if sin_persona else pose_falsa(mundo, vis)
        _, e = proc.paso(img, t_ms, 30.0)
        texto = e["resultado_calibracion"]
        cuadros.append({
            "t": t_ms / 1000.0, "calibrar": calibrar,
            "pose": None if sin_persona else {"puntos": mundo.tolist(), "visibilidad": vis.tolist(), "mundo": True},
            "esperado": {"angulos": e["angulos"], "calidad": e["calidad"], "vis_media": e["vis_media"],
                         "calibrando": e["calibrando"], "preparando": e["preparando"],
                         "diferencias": e["diferencias"], "ok": None if not texto else not texto.startswith("No se pudo"),
                         "pocos_fps": None if not texto else "cuadros/s" in texto,
                         "movimiento": proc.calibrador.activo is False and "te moviste" in texto},
        })
    return {"nombre": nombre, "cuadros": cuadros, "perfil": proc.perfil}


def _sentadillas(tmp: Path) -> list[dict]:
    """Series sintéticas (ruido, huecos, repetición incompleta, un solo lado) corridas con la versión Python."""
    rng = np.random.default_rng(11)
    tramos = [("rep", 1, 90), ("pie", 3), ("rep", 2, 85), ("pie", .5), ("rep", 2.5, 95), ("pie", .3),
              ("rep", 2, 145), ("pie", .5), ("rep", 4, 80), ("pie", 1), ("rep", .4, 60), ("pie", 1),
              ("rep", 2, 100), ("pie", 9.5), ("rep", 2, 100), ("pie", 1), ("media", 2, 90)]
    series = []
    for i, (fps, ruido, lados, desfase, prep, fin, huecos) in enumerate((
            (30, 0.0, "ambos", 0.0, 2.0, 8.0, 0.0), (30, 2.5, "ambos", 6.0, 0.0, None, 0.08),
            (12, 3.0, "izq", 0.0, 1.0, None, 0.15), (24, 1.5, "ambos", -4.0, 0.0, None, 0.3))):
        cuadros = senal(tramos, fps=fps, ruido=ruido, semilla=i, lados=lados, desfase=desfase)
        s = Q.SerieSentadilla(segundos_preparacion=prep, segundos_fin=fin)
        salida = []
        for j, c in enumerate(cuadros):
            ang = {k: (None if v is None or rng.random() < huecos else v) for k, v in c["angulos"].items()}
            if i and 400 < j < 400 + 2 * fps and i % 2:
                ang = {k: None for k in ang}  # hueco largo
            vis = None if i == 0 else {"izq": float(rng.uniform(.6, 1)), "der": float(rng.uniform(.6, 1))}
            t = c["t"] + float(rng.uniform(0, .3 / fps)) - (0.5 if j % 211 == 100 else 0.0)  # tiempo que retrocede
            s.paso(ang, t, vis)
            salida.append({"t": t, "angulos": ang, "vis": vis, "esperado": s.estado(t)})
        # copia: las repeticiones se siguen agregando a la misma lista
        s.terminar()
        resultado = {**s.resultado(), "creado": ""}
        ruta = tmp / f"serie{i}.csv"
        Q.a_csv(resultado, ruta)
        with ruta.open(encoding="utf-8", newline="") as f:
            filas = list(csv.reader(f))
        series.append({"preparacion": prep, "fin": fin, "cuadros": salida, "resultado": resultado, "csv": filas})
    return series


def _casos(tmp: Path, monkeypatch) -> dict:
    rng = np.random.default_rng(7)
    casos = {"angulos": [], "calidad": [], "segmentos": [], "redondeo": [], "estadistica": [], "filtro": [],
             "sesiones": []}
    for i in range(60):
        pts = rng.normal(0, .5, (33, 3))
        vis = rng.uniform(.35, 1.0, 33)
        if i % 5 == 0:
            vis[:] = .9
            vis[13] = [.6, .5999999, .6000001, 0.0][(i // 5) % 4]  # justo en el umbral
        if i % 11 == 0:
            pts[15] = pts[13]  # lado de largo cero: NaN en Python, abstención
        umbral = .6 if i % 7 else .8
        casos["angulos"].append({"puntos": pts.tolist(), "vis": vis.tolist(), "umbral": umbral,
                                 "esperado": angulos_articulares(pts, vis, umbral)})
        casos["segmentos"].append({"mundo": pts.tolist(), "esperado": longitudes_segmentos(pts)})
    for bajos in range(13):
        for alto, bajo in ((.95, .1), (.8, .55), (.7, .5), (.62, .59)):
            vis = np.full(33, alto)
            vis[CUERPO[:bajos]] = bajo
            casos["calidad"].append({"vis": vis.tolist(), "umbral": .6,
                                     "esperado": list(P.calidad(vis, CUERPO, .6))})
    valores = [0.125, 0.375, 2.675, 1.005, -0.125, 0.5, 1.5, 2.5, 0.00005, 170.125, 0.28125, 100.0, 0.0]
    valores += rng.uniform(0, 180, 300).tolist() + [round(v, 3) for v in rng.uniform(0, 2, 200)]
    casos["redondeo"] = [[float(v), d, round(float(v), d)] for v in valores for d in (0, 2, 4)]
    for n in (1, 2, 3, 4, 15, 16, 101):
        x = rng.uniform(0, 180, n)
        casos["estadistica"].append({"x": x.tolist(), "mediana": float(np.median(x)),
                                     "p5": float(np.percentile(x, 5)), "p95": float(np.percentile(x, 95))})
    for entrada in ("niko", "  Niko R. ", "ñandú", "a/b\\c", "___", "", "x" * 60, "perfil-1", "../..", "uno dos  tres"):
        try:
            esperado = P.nombre_seguro(entrada)
        except ValueError:
            esperado = None
        casos["nombres"] = casos.get("nombres", []) + [[entrada, esperado]]
    for _ in range(3):
        f, t, sec = FiltroAngulos(min_corte=1.0, beta=.02), 0.0, []
        for j in range(120):
            t += float(rng.uniform(.01, .09))
            if j % 31 == 17:
                t -= .2  # tiempo que retrocede: el filtro se reinicia
            ang = {k: (None if rng.random() < .12 else float(rng.uniform(0, 180))) for k in ANGULOS}
            sec.append({"t": t, "entrada": ang, "esperado": f(ang, t)})
        casos["filtro"].append(sec)
    casos["sentadillas"] = _sentadillas(tmp)
    casos["movimiento"] = []
    for _ in range(300):
        angulos = {}
        for k in ANGULOS:
            p5 = float(rng.uniform(40, 170))
            angulos[k] = None if rng.random() < .1 else {
                "mediana": 100.0, "mad": round(float(rng.uniform(0, 18)), 2), "p5": round(p5, 2),
                "p95": round(p5 + float(rng.choice([rng.uniform(0, 40), 20.0, 20.5])), 2),
                "n": int(rng.integers(5, 70))}
        casos["movimiento"].append({"perfil": {"angulos": angulos}, "esperado": P.movimiento({"angulos": angulos})})
    casos["sesiones"] = [
        _secuencia(rng, tmp, monkeypatch, "mala", buena=False),
        _secuencia(rng, tmp, monkeypatch, "paridad", buena=True),
        _secuencia(rng, tmp, monkeypatch, "movida", buena=True, mover=True),
        _secuencia(rng, tmp, monkeypatch, "lenta", buena=True, paso_ms=100),
    ]
    return casos


@pytest.mark.skipif(NODE is None, reason="falta node")
def test_paridad_javascript_python(tmp_path, monkeypatch):
    casos = _casos(tmp_path, monkeypatch)
    # que los casos cubran de verdad abstención, calibración correcta y calibración fallida
    mala, bien, movida, lenta = casos["sesiones"]
    assert any(c["esperado"]["movimiento"] for c in movida["cuadros"]) and movida["perfil"]
    assert any(c["esperado"]["pocos_fps"] for c in lenta["cuadros"]) and lenta["perfil"]
    assert any(c["esperado"]["pocos_fps"] is False for c in bien["cuadros"])
    assert {e["esperado"] is None for e in casos["movimiento"]} == {True, False}
    series = casos["sentadillas"]
    assert all(s["resultado"]["repeticiones"] for s in series[:2])
    assert any(s["resultado"]["descartadas"] for s in series)
    assert any(c["esperado"]["ok"] is False for c in mala["cuadros"]) and mala["perfil"] is None
    assert any(c["esperado"]["ok"] for c in bien["cuadros"]) and bien["perfil"]["muestras"] >= 15
    assert any(c["esperado"]["angulos"]["rodilla_izq"] is None for c in bien["cuadros"])
    ruta, ruta_js = tmp_path / "casos.json", tmp_path / "perfil_js.json"
    ruta.write_text(json.dumps(casos, allow_nan=False), encoding="utf-8")
    r = subprocess.run([NODE, str(RAIZ / "escaner" / "pruebas" / "paridad.mjs"), str(ruta), str(ruta_js)],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr
    print(r.stdout)

    # el JSON que descarga la página sirve tal cual en data/perfiles
    shutil.copy(ruta_js, tmp_path / "desde_js.json")
    perfil = P.cargar("desde_js", tmp_path)
    assert list(perfil) == list(bien["perfil"])
    mundo = pose_base()
    angulos = angulos_articulares(mundo, np.ones(33))
    dif_js, dif_py = P.diferencias(perfil, angulos, mundo), P.diferencias(bien["perfil"], angulos, mundo)
    assert dif_js == dif_py
