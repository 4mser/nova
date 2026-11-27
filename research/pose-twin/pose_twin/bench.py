"""Bench de robustez a la rotación: MediaPipe full/heavy y RTMPose-m (rtmlib), con y sin enderezado.

Mide CONSISTENCIA, no exactitud: compara lo que predice cada modelo sobre la entrada girada
(devuelta a coordenadas originales) con lo que predice el mismo modelo a 0 grados. No hay
verdad de referencia anotada.
"""
from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .geometria import aplicar_afin, rotacion_lienzo
from .motor import BUSQUEDA, Motor

# COCO-17 en índices BlazePose (nariz, ojos, orejas, hombros, codos, muñecas, caderas, rodillas, tobillos)
MP_A_COCO = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
# Ángulos 2D en índices COCO-17
ANG_COCO = {
    "codo_izq": (5, 7, 9), "codo_der": (6, 8, 10), "hombro_izq": (7, 5, 11), "hombro_der": (8, 6, 12),
    "cadera_izq": (5, 11, 13), "cadera_der": (6, 12, 14), "rodilla_izq": (11, 13, 15), "rodilla_der": (12, 14, 16),
}
UMBRAL_ENDEREZAR = 15.0


def torso_coco(k: np.ndarray) -> float:
    h = (k[5] + k[6]) / 2
    c = (k[11] + k[12]) / 2
    return math.degrees(math.atan2(h[0] - c[0], -(h[1] - c[1])))


def largo_torso(k: np.ndarray) -> float:
    return float(np.linalg.norm((k[5] + k[6]) / 2 - (k[11] + k[12]) / 2))


def ang2d(k, a, v, b) -> float:
    u, w = k[a] - k[v], k[b] - k[v]
    n = np.linalg.norm(u) * np.linalg.norm(w)
    return float("nan") if n < 1e-9 else math.degrees(math.acos(np.clip(np.dot(u, w) / n, -1, 1)))


@dataclass
class Salida:
    kps: np.ndarray | None  # (17, 2) en coordenadas de la imagen que se le pasó
    scores: np.ndarray | None  # (17,)


class EstMediaPipe:
    umbral = 0.5

    def __init__(self, modelo: str, modo: str):
        self.nombre = f"MediaPipe {modelo}"
        self.modelo, self.modo = modelo, modo
        self.motor = Motor(modelo=modelo, modo=modo, num_poses=1)
        self.delegado = self.motor.delegado

    def reiniciar(self):
        self.motor.cerrar()
        self.motor = Motor(modelo=self.modelo, modo=self.modo, num_poses=1)

    def __call__(self, img, t_ms, rot: float | None) -> Salida:
        r = self.motor.procesar(img, t_ms, rot_forzada=rot)
        if r.pose is None:
            return Salida(None, None)
        return Salida(r.pose.puntos2d[MP_A_COCO], r.pose.visibilidad[MP_A_COCO])

    def cerrar(self):
        self.motor.cerrar()


class EstRTMPose:
    """YOLOX-m (detector de personas) + RTMPose-m (body7, 256x192), vía rtmlib/onnxruntime en CPU."""

    umbral = 0.3
    delegado = "CPU (onnxruntime)"

    def __init__(self):
        from rtmlib import Body

        self.nombre = "RTMPose-m (rtmlib)"
        self.body = Body(mode="balanced", backend="onnxruntime", device="cpu")

    def reiniciar(self):
        pass

    def __call__(self, img, t_ms, rot: float | None) -> Salida:
        h, w = img.shape[:2]
        R = None
        if rot:
            R = rotacion_lienzo(w, h, rot)
            img = cv2.warpAffine(img, R.M, (R.ancho, R.alto))
        kps, sc = self.body(img)
        if kps is None or len(kps) == 0:
            return Salida(None, None)
        i = int(np.argmax(sc.mean(axis=1)))
        k, s = kps[i].astype(float), sc[i].astype(float)
        if s.mean() < 0.2:
            return Salida(None, None)
        if R is not None:
            k = aplicar_afin(R.Minv, k)
        return Salida(k, s)

    def cerrar(self):
        pass


class Enderezador:
    """Lógica del modo en vivo: gira según el torso del cuadro anterior; si se pierde, busca 0/90/180/-90."""

    def __init__(self, est):
        self.est = est
        self.prev: float | None = None
        self.busq = 0
        self.perdidos = 0

    def __call__(self, img, t_ms) -> Salida:
        if self.prev is not None:
            rot = self.prev if abs(self.prev) >= UMBRAL_ENDEREZAR else 0.0
        else:
            rot = BUSQUEDA[self.busq % len(BUSQUEDA)]
            self.busq += 1
        s = self.est(img, t_ms, rot)
        if s.kps is not None:
            self.prev, self.busq, self.perdidos = torso_coco(s.kps), 0, 0
        else:
            self.perdidos += 1
            if self.perdidos > 5:
                self.prev = None
        return s


def enderezado_estatico(est, img) -> Salida:
    """Para imagen suelta: pasada de búsqueda + pasada enderezada (lo que en vivo hace el cuadro anterior)."""
    primera = Salida(None, None)
    for a in BUSQUEDA:
        primera = est(img, None, a)
        if primera.kps is not None:
            break
    if primera.kps is None:
        return primera
    t = torso_coco(primera.kps)
    if abs(t) < UMBRAL_ENDEREZAR:
        return primera
    segunda = est(img, None, t)
    return segunda if segunda.kps is not None else primera


def comparar(ref: Salida, s: Salida, umbral: float) -> tuple[float, float] | None:
    """(error de puntos normalizado por el torso de referencia, error medio de ángulos 2D en grados)."""
    if ref.kps is None or s.kps is None:
        return None
    m = (ref.scores >= umbral) & (s.scores >= umbral)
    if m.sum() < 4:
        return None
    lt = max(largo_torso(ref.kps), 1.0)
    nme = float(np.mean(np.linalg.norm(ref.kps[m] - s.kps[m], axis=1))) / lt
    errs = []
    for a, v, b in ANG_COCO.values():
        if m[a] and m[v] and m[b]:
            x, y = ang2d(ref.kps, a, v, b), ang2d(s.kps, a, v, b)
            if not (math.isnan(x) or math.isnan(y)):
                errs.append(abs(x - y))
    return nme, (float(np.mean(errs)) if errs else float("nan"))


def girar(img, grados):
    h, w = img.shape[:2]
    R = rotacion_lienzo(w, h, grados)
    return cv2.warpAffine(img, R.M, (R.ancho, R.alto)), R


def _volver(s: Salida, R) -> Salida:
    return s if s.kps is None else Salida(aplicar_afin(R.Minv, s.kps), s.scores)


def _resumen(filas):
    det = [f["detectado"] for f in filas]
    nme = [f["nme"] for f in filas if f["nme"] is not None]
    ang = [f["ang"] for f in filas if f["ang"] is not None and not math.isnan(f["ang"])]
    ms = [f["ms"] for f in filas]
    return {
        "deteccion": float(np.mean(det)) if det else 0.0,
        "nme_mediana": float(np.median(nme)) if nme else None,
        "ang_mediana": float(np.median(ang)) if ang else None,
        "ms_media": float(np.mean(ms)) if ms else None,
        "n": len(filas),
    }


def bench_imagen(est, img, angulos) -> dict:
    """Cada ángulo es una imagen independiente (MediaPipe en modo imagen)."""
    ref = est(img, None, None)
    res = {"sin": {}, "con": {}}
    for a in angulos:
        g, R = girar(img, a)
        for modo in ("sin", "con"):
            t0 = time.perf_counter()
            s = est(g, None, None) if modo == "sin" else enderezado_estatico(est, g)
            ms = (time.perf_counter() - t0) * 1000
            s = _volver(s, R)
            c = comparar(ref, s, est.umbral)
            res[modo][a] = {"detectado": s.kps is not None, "nme": c[0] if c else None,
                            "ang": c[1] if c else None, "ms": ms}
    return res


def bench_video(est, cuadros, fps_eff, angulos) -> dict:
    """Secuencia girada un ángulo fijo; MediaPipe en modo video (seguimiento), como en vivo."""
    refs = []
    est.reiniciar()
    for i, c in enumerate(cuadros):
        refs.append(est(c, int(i * 1000 / fps_eff), None))
    res = {"sin": {}, "con": {}}
    for a in angulos:
        girados = [girar(c, a) for c in cuadros]
        for modo in ("sin", "con"):
            est.reiniciar()
            end = Enderezador(est)
            filas = []
            for i, (g, R) in enumerate(girados):
                t_ms = int(i * 1000 / fps_eff)
                t0 = time.perf_counter()
                s = est(g, t_ms, None) if modo == "sin" else end(g, t_ms)
                ms = (time.perf_counter() - t0) * 1000
                s = _volver(s, R)
                cmp = comparar(refs[i], s, est.umbral)
                filas.append({"detectado": s.kps is not None, "nme": cmp[0] if cmp else None,
                              "ang": cmp[1] if cmp else None, "ms": ms})
            res[modo][a] = _resumen(filas)
    res["referencia_deteccion"] = float(np.mean([r.kps is not None for r in refs]))
    return res


def leer_cuadros(ruta: Path, paso: int, max_cuadros: int, ancho: int) -> tuple[list, float]:
    cap = cv2.VideoCapture(str(ruta))
    if not cap.isOpened():
        raise RuntimeError(f"No se pudo abrir {ruta}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cuadros, i = [], 0
    while len(cuadros) < max_cuadros:
        ok, c = cap.read()
        if not ok:
            break
        if i % paso == 0:
            if c.shape[1] > ancho:
                c = cv2.resize(c, (ancho, int(c.shape[0] * ancho / c.shape[1])), interpolation=cv2.INTER_AREA)
            cuadros.append(c)
        i += 1
    cap.release()
    return cuadros, fps / paso


def _tabla_resumen(nombre_fuente, resultados, clave_resumen) -> list[str]:
    lin = [f"| Modelo | Enderezado | Detección | Error puntos (mediana, % torso) | Error ángulos 2D (mediana, °) | ms/cuadro | Delegado |",
           "|---|---|---|---|---|---|---|"]
    for nombre, (res, delegado) in resultados.items():
        for modo in ("sin", "con"):
            r = clave_resumen(res[modo])
            nme = "n/d" if r["nme_mediana"] is None else f"{100 * r['nme_mediana']:.1f}"
            ang = "n/d" if r["ang_mediana"] is None else f"{r['ang_mediana']:.1f}"
            lin.append(f"| {nombre} | {modo} | {100 * r['deteccion']:.0f}% | {nme} | {ang} | {r['ms_media']:.1f} | {delegado} |")
    return lin


def _tabla_por_angulo(resultados, angulos, campo_det) -> list[str]:
    cab = "| Modelo | Enderezado | " + " | ".join(f"{a}°" for a in angulos) + " |"
    lin = [cab, "|---|---|" + "---|" * len(angulos)]
    for nombre, (res, _) in resultados.items():
        for modo in ("sin", "con"):
            celdas = [campo_det(res[modo][a]) for a in angulos]
            lin.append(f"| {nombre} | {modo} | " + " | ".join(celdas) + " |")
    return lin


def _grafico(ruta: Path, angulos, res_video, res_img):
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return None
    fig, ejes = plt.subplots(1, 2, figsize=(11, 4), sharey=False)
    colores = ["#2563eb", "#16a34a", "#dc2626", "#9333ea"]
    for j, (nombre, (res, _)) in enumerate(res_video.items()):
        for modo, estilo in (("sin", "--"), ("con", "-")):
            ejes[0].plot(angulos, [100 * res[modo][a]["deteccion"] for a in angulos], estilo, color=colores[j],
                         marker="o", ms=3, label=f"{nombre} ({modo} enderezado)")
            ejes[1].plot(angulos, [np.nan if res[modo][a]["nme_mediana"] is None else 100 * res[modo][a]["nme_mediana"]
                                   for a in angulos], estilo, color=colores[j], marker="o", ms=3)
    ejes[0].set(title="Video girado: tasa de detección", xlabel="rotación (°)", ylabel="% cuadros con persona", ylim=(-5, 105))
    ejes[1].set(title="Video girado: error de consistencia vs 0°", xlabel="rotación (°)", ylabel="mediana, % del torso")
    for e in ejes:
        e.grid(alpha=.3)
        e.set_xticks(angulos)
    ejes[0].legend(fontsize=7, loc="lower left")
    fig.suptitle("Consistencia frente a la rotación (no es exactitud: sin verdad de referencia)", fontsize=10)
    fig.tight_layout()
    fig.savefig(ruta, dpi=130)
    plt.close(fig)
    return ruta


def ejecutar_bench(args) -> int:
    raiz = Path(__file__).resolve().parents[1]
    docs = raiz / "docs"
    docs.mkdir(exist_ok=True)
    angulos_img = list(range(0, 360, args.paso_img))
    angulos_vid = list(range(0, 360, args.paso_video))
    img = cv2.imread(str(args.imagen)) if args.imagen else None
    if args.imagen and img is None:
        print(f"No se pudo leer la imagen {args.imagen}")
        return 1
    cuadros, fps_eff = ([], 0.0)
    if args.video:
        cuadros, fps_eff = leer_cuadros(Path(args.video), args.cada, args.max_cuadros, args.ancho)
        print(f"Video: {len(cuadros)} cuadros (1 de cada {args.cada}), {fps_eff:.1f} cps efectivos")

    modelos = [m.strip() for m in args.modelos.split(",") if m.strip()]
    res_img, res_vid, notas = {}, {}, []
    for m in modelos:
        try:
            if m in ("full", "heavy"):
                est_i = EstMediaPipe(m, "imagen")
                est_v = EstMediaPipe(m, "video")
            elif m == "rtmpose":
                est_i = est_v = EstRTMPose()
            else:
                notas.append(f"Modelo desconocido: {m}")
                continue
        except Exception as e:  # p. ej. rtmlib sin instalar o sin red para bajar pesos
            notas.append(f"{m}: no se pudo cargar ({type(e).__name__}: {e})")
            print(notas[-1])
            continue
        print(f"== {est_i.nombre} ({est_i.delegado})", flush=True)
        if img is not None:
            t0 = time.time()
            res_img[est_i.nombre] = (bench_imagen(est_i, img, angulos_img), est_i.delegado)
            print(f"   imagen: {time.time() - t0:.0f} s", flush=True)
        if cuadros:
            t0 = time.time()
            res_vid[est_v.nombre] = (bench_video(est_v, cuadros, fps_eff, angulos_vid), est_v.delegado)
            print(f"   video: {time.time() - t0:.0f} s", flush=True)
        est_i.cerrar()
        if est_v is not est_i:
            est_v.cerrar()

    salida_json = docs / "linea-base.json"
    salida_json.write_text(json.dumps({"imagen": {k: v[0] for k, v in res_img.items()},
                                       "video": {k: v[0] for k, v in res_vid.items()}},
                                      indent=1, default=str), encoding="utf-8")
    grafico = _grafico(docs / "linea-base.png", angulos_vid, res_vid, res_img) if res_vid else None
    escribir_informe(docs / "linea-base.md", args, res_img, res_vid, angulos_img, angulos_vid, len(cuadros),
                     fps_eff, notas, grafico)
    print(f"Informe: {docs / 'linea-base.md'}")
    return 0


def escribir_informe(ruta, args, res_img, res_vid, angulos_img, angulos_vid, n_cuadros, fps_eff, notas, grafico):
    import platform

    import mediapipe
    L = ["# Línea base: robustez a la rotación", "",
         f"Generado por `python -m pose_twin bench` el {time.strftime('%Y-%m-%d %H:%M')}. "
         f"Equipo: {platform.processor() or platform.machine()}, Python {platform.python_version()}, "
         f"mediapipe {mediapipe.__version__}, OpenCV {cv2.__version__}.", "",
         "**Qué mide.** Consistencia, no exactitud. Cada modelo se compara consigo mismo a 0°: la entrada se gira, "
         "los puntos predichos se devuelven a coordenadas originales y se mide la distancia a lo que el mismo modelo "
         "predijo sin girar. No hay verdad de referencia anotada, así que un modelo puede ser consistente y aun así "
         "equivocarse igual en todos los ángulos.", "",
         "- *Detección*: % de entradas con una persona encontrada.",
         "- *Error puntos*: mediana de la distancia media de los 17 puntos COCO (con confianza en ambos) dividida por el largo del torso de referencia.",
         "- *Error ángulos 2D*: mediana del error absoluto medio de los 8 ángulos (codos, hombros, caderas, rodillas) en la imagen.",
         "- *ms/cuadro*: tiempo de pared de la inferencia, incluido el giro y, con enderezado, las pasadas extra.",
         "- *Enderezado*: gira la entrada según el torso del cuadro anterior (video) o de una primera pasada (imagen); si no hay persona prueba 0/90/180/-90°.",
         ""]
    if res_vid:
        L += [f"## Video girado (seguimiento cuadro a cuadro)", "",
              f"Fuente: `{Path(args.video).name}`, {n_cuadros} cuadros (1 de cada {args.cada}, ancho {args.ancho} px, {fps_eff:.1f} cps efectivos), "
              f"rotaciones {angulos_vid[0]}–{angulos_vid[-1]}° cada {args.paso_video}°. MediaPipe en modo video (usa el seguimiento por recorte, como en vivo).", ""]
        L += _tabla_resumen("video", res_vid, lambda d: {
            "deteccion": np.mean([v["deteccion"] for v in d.values()]),
            "nme_mediana": _med([v["nme_mediana"] for v in d.values()]),
            "ang_mediana": _med([v["ang_mediana"] for v in d.values()]),
            "ms_media": np.mean([v["ms_media"] for v in d.values()]),
        })
        L += ["", "Promedio sobre todas las rotaciones (detección y ms) y mediana de las medianas por rotación (errores).", "",
              "Detección por rotación:", ""]
        L += _tabla_por_angulo(res_vid, angulos_vid, lambda r: f"{100 * r['deteccion']:.0f}%")
        L += ["", "Error de puntos por rotación (mediana, % del torso):", ""]
        L += _tabla_por_angulo(res_vid, angulos_vid,
                               lambda r: "n/d" if r["nme_mediana"] is None else f"{100 * r['nme_mediana']:.1f}")
        if grafico:
            L += ["", f"![Detección y error por rotación]({Path(grafico).name})"]
        L += ["", "**Lectura automática (video).** Efecto del enderezado por modelo, sobre las rotaciones distintas de 0°:", ""]
        for nombre, (res, _) in res_vid.items():
            def agg(modo):
                vals = [res[modo][a] for a in angulos_vid if a != 0]
                return (np.mean([v["deteccion"] for v in vals]), _med([v["nme_mediana"] for v in vals]),
                        max((v["nme_mediana"] or 0) for v in vals))
            ds, es, ms_ = agg("sin")
            dc, ec, mc = agg("con")
            if es is None or ec is None:
                continue
            efecto = "mejora" if ec < es * 0.9 else ("empeora" if ec > es * 1.1 else "no cambia mucho")
            L.append(f"- {nombre}: error mediano {100 * es:.1f}% → {100 * ec:.1f}% del torso (peor rotación "
                     f"{100 * ms_:.1f}% → {100 * mc:.1f}%), detección {100 * ds:.0f}% → {100 * dc:.0f}%: el enderezado {efecto}.")
        L += ["", "Con enderezado el error a 0° no es cero: la imagen se pone en un lienzo cuadrado (lado = diagonal), "
              "la persona queda más pequeña para el detector y la red ve una entrada distinta. MediaPipe ya corrige la "
              "inclinación dentro de su recorte (alinea caderas-hombros), por eso gana poco o nada; RTMPose recorta "
              "sin alinear y es el que más se beneficia.", ""]
    if res_img:
        L += ["## Imagen girada (cada ángulo independiente)", "",
              f"Fuente: `{Path(args.imagen).name}`, rotaciones cada {args.paso_img}°. MediaPipe en modo imagen.", ""]
        L += _tabla_resumen("imagen", res_img, lambda d: {
            "deteccion": np.mean([v["detectado"] for v in d.values()]),
            "nme_mediana": _med([v["nme"] for v in d.values()]),
            "ang_mediana": _med([v["ang"] for v in d.values()]),
            "ms_media": np.mean([v["ms"] for v in d.values()]),
        })
        L += ["", "Detección por rotación (✓ = persona encontrada):", ""]
        L += _tabla_por_angulo(res_img, angulos_img, lambda r: "✓" if r["detectado"] else "·")
        L += [""]
    L += ["## Modelos y licencias", "",
          "- MediaPipe Pose Landmarker full/heavy (BlazePose GHUM 3D), Apache-2.0, archivos `.task` de `nave/vision/modelos/` (Google).",
          "- RTMPose-m (body7, 256×192) + detector YOLOX-m (HumanArt), vía `rtmlib` (Apache-2.0). Pesos ONNX descargados por rtmlib "
          "desde `download.openmmlab.com` (proyecto OpenMMLab MMPose, Apache-2.0). Solo 2D: no da puntos 3D.",
          "- Todo se ejecutó en CPU (ver columna Delegado); el delegado GPU de MediaPipe no está disponible en Windows con esta versión, "
          "y onnxruntime instalado es la variante CPU.", "",
          "## Límites", "",
          "- Una sola persona por muestra, un video corto y una imagen: las cifras orientan, no generalizan.",
          "- Las esquinas negras del giro y el reescalado cambian la entrada; parte del error viene de ahí, no del modelo.",
          "- Los tiempos incluyen la primera inferencia (calentamiento) y dependen de la carga del equipo.", ""]
    if notas:
        L += ["## Notas", ""] + [f"- {n}" for n in notas] + [""]
    ruta.write_text("\n".join(L), encoding="utf-8")


def _med(xs):
    xs = [x for x in xs if x is not None and not (isinstance(x, float) and math.isnan(x))]
    return float(np.median(xs)) if xs else None
