"""Spike: MediaPipe Face Landmarker (478 puntos, incluye iris) con webcam.

Modos:
  --live   ventana con landmarks, FPS y latencia. 'q' sale. No guarda cuadros.
  --check  captura N cuadros y escribe un resumen de texto en docs/spike-resultados.md.
  --smoke  inferencia sobre un cuadro negro sintetico (sin camara) y pruebas en memoria
           de la ruta redimensionado+JPEG, las metricas y el HUD (y de la v2: rotacion,
           degradaciones, condiciones y metricas de estabilidad).

Modos v2 (ver spike_v2.py, spike_metrics.py, spike_degrade.py):
  --check --sweep       captura N cuadros una vez en RAM y aplica todas las condiciones
                        (resolucion, JPEG, luz, ruido, desenfoque, roll crudo y compensado)
                        en modos IMAGE y VIDEO; anexa tablas a docs/spike-resultados.md.
  --noise-floor         protocolo guiado (3 bloques de 20 s); exige --session-id.
  --noise-floor-report  agrega >= 3 sesiones: sigma_w, sigma_b y MDC95 (Tabla 2).

Opciones de la ruta real del escaner AR (fotos JPEG de 512 px):
  --width N         reduce el cuadro a ancho N (INTER_AREA) y lo pasa por JPEG antes de inferir.
  --jpeg-quality Q  calidad JPEG (default 80; SUPUESTO, la calidad real no se conoce).
  --compare         con --live: dos paneles, resolucion completa vs simulacion (default 512 px).
                    Teclas: q salir, m espejo, c siguiente camara, s vista simple/compare.
  --check --width N: tabla lado a lado completa vs N px, anexada a docs/spike-resultados.md.
No se guardan ni transmiten cuadros.
"""
from __future__ import annotations

import argparse
import math
import platform
import statistics
import sys
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT / "models" / "face_landmarker.task"
RESULTS_PATH = ROOT / "docs" / "spike-resultados.md"
IRIS_IDX = range(468, 478)
EXPECTED_LANDMARKS = 478
DEFAULT_JPEG_QUALITY = 80  # SUPUESTO: la calidad JPEG real del escaner AR no se conoce
DEFAULT_COMPARE_WIDTH = 512
WINDOW = 30  # cuadros para jitter y latencia mediana movil
PANEL_H = 480  # alto de cada panel en pantalla
# Diametro del iris: MediaPipe da por ojo 1 centro + 4 puntos de borde. Los 4 puntos
# forman una cruz (izq/der/arriba/abajo), asi que los pares OPUESTOS son los diametros:
#   ojo A: centro 468, borde 469-471 y 470-472
#   ojo B: centro 473, borde 474-476 y 475-477
# Se promedian las 4 distancias; usar pares opuestos (no centro-borde) evita depender
# de que el centro este bien ubicado.
IRIS_CENTERS = (468, 473)
IRIS_DIAMETER_PAIRS = ((469, 471), (470, 472), (474, 476), (475, 477))


def build_landmarker(model_path: Path) -> vision.FaceLandmarker:
    if not model_path.exists():
        sys.exit(f"Modelo no encontrado: {model_path}")
    options = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path)),  # delegate CPU por defecto
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1,
    )
    return vision.FaceLandmarker.create_from_options(options)


def try_open_camera(index: int) -> cv2.VideoCapture | None:
    backends = [("default", cv2.CAP_ANY)]
    if sys.platform == "win32":
        backends.append(("DirectShow", cv2.CAP_DSHOW))
    for name, backend in backends:
        cap = cv2.VideoCapture(index, backend)
        if cap.isOpened():
            ok, _ = cap.read()
            if ok:
                print(f"Camara {index} abierta con backend {name}")
                return cap
        cap.release()
    return None


def open_camera(index: int) -> cv2.VideoCapture:
    cap = try_open_camera(index)
    if cap is None:
        sys.exit(
            f"No se pudo abrir la camara {index}. Cierra otras apps que la usen, "
            "revisa permisos de camara en Windows o prueba otro indice con --cam 1."
        )
    return cap


def prepare(frame: np.ndarray, width: int | None, quality: int) -> np.ndarray:
    """Simula la ruta real: reducir (INTER_AREA) y codificar/decodificar JPEG.

    Con width=None devuelve el cuadro tal cual (resolucion completa, sin JPEG).
    """
    if width is None:
        return frame
    h, w = frame.shape[:2]
    if width < w:
        frame = cv2.resize(frame, (width, max(1, round(h * width / w))),
                           interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("cv2.imencode fallo al codificar JPEG")
    decoded = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if decoded is None:
        raise RuntimeError("cv2.imdecode fallo al decodificar JPEG")
    return decoded


def infer(landmarker: vision.FaceLandmarker, frame_bgr: np.ndarray, ts_ms: int):
    """Devuelve (resultado, latencia_ms). La latencia es solo la inferencia."""
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    t0 = time.perf_counter()
    result = landmarker.detect_for_video(image, ts_ms)
    return result, (time.perf_counter() - t0) * 1000.0


@dataclass
class Metrics:
    face: bool = False
    n_landmarks: int = 0
    iris_ok: bool = False
    iris_diameter: float | None = None  # px
    iris_distance: float | None = None  # px entre centros 468 y 473
    centers: tuple[float, float, float, float] | None = None  # x,y de ambos centros (px)


def compute_metrics(landmarks: Sequence[Any] | None, w: int, h: int) -> Metrics:
    """Metricas de un cuadro de w x h px. Seguro si no hay cara o faltan indices."""
    if not landmarks:
        return Metrics()
    n = len(landmarks)
    m = Metrics(face=True, n_landmarks=n)
    if n <= max(IRIS_IDX):
        return m
    m.iris_ok = all(0.0 <= landmarks[i].x <= 1.0 and 0.0 <= landmarks[i].y <= 1.0
                    for i in IRIS_IDX)
    if not m.iris_ok:
        return m

    def px(i: int) -> tuple[float, float]:
        return landmarks[i].x * w, landmarks[i].y * h

    m.iris_diameter = float(np.mean([math.dist(px(a), px(b)) for a, b in IRIS_DIAMETER_PAIRS]))
    (ax, ay), (bx, by) = px(IRIS_CENTERS[0]), px(IRIS_CENTERS[1])
    m.iris_distance = math.dist((ax, ay), (bx, by))
    m.centers = (ax, ay, bx, by)
    return m


class PanelStats:
    """Acumula metricas de un panel: ventana movil de 30 cuadros y totales."""

    def __init__(self) -> None:
        self.centers: deque[tuple[float, float, float, float]] = deque(maxlen=WINDOW)
        self.lats: deque[float] = deque(maxlen=WINDOW)
        self.frames = 0
        self.detections = 0
        self.iris_frames = 0
        self.diameters: list[float] = []
        self.jitters: list[float] = []
        self.all_lats: list[float] = []

    def update(self, m: Metrics, lat: float) -> None:
        self.frames += 1
        self.detections += int(m.face)
        self.lats.append(lat)
        self.all_lats.append(lat)
        if m.centers is not None and m.iris_diameter is not None:
            self.iris_frames += 1
            self.centers.append(m.centers)
            self.diameters.append(m.iris_diameter)
            j = self.jitter
            if j is not None:
                self.jitters.append(j)

    @property
    def jitter(self) -> float | None:
        """Desv. estandar de la posicion del centro del iris (px) en los ultimos 30
        cuadros: sqrt(var_x + var_y), promediado entre ambos ojos."""
        if len(self.centers) < 2:
            return None
        arr = np.asarray(self.centers, dtype=np.float64)
        eyes = [math.sqrt(arr[:, k].var() + arr[:, k + 1].var()) for k in (0, 2)]
        return float(np.mean(eyes))

    @property
    def median_latency(self) -> float | None:
        return statistics.median(self.lats) if self.lats else None

    @property
    def detection_rate(self) -> float:
        return 100.0 * self.detections / self.frames if self.frames else 0.0


def draw_landmarks(frame: np.ndarray, landmarks: Sequence[Any]) -> None:
    h, w = frame.shape[:2]
    for i, lm in enumerate(landmarks):
        x, y = int(lm.x * w), int(lm.y * h)
        if i in IRIS_IDX:
            if i in IRIS_CENTERS:
                cv2.circle(frame, (x, y), 4, (0, 0, 255), -1)
            else:
                cv2.circle(frame, (x, y), 3, (0, 255, 255), -1)
        else:
            cv2.circle(frame, (x, y), 1, (0, 200, 0), -1)


def draw_hud(img: np.ndarray, lines: list[tuple[str, tuple[int, int, int]]],
             origin: tuple[int, int] = (8, 8), scale: float = 0.5) -> None:
    """Texto con fondo negro semitransparente. Solo ASCII (fuentes Hershey)."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    line_h = int(26 * scale / 0.5)
    sizes = [cv2.getTextSize(t, font, scale, 1)[0][0] for t, _ in lines]
    box_w = (max(sizes) if sizes else 0) + 16
    box_h = line_h * len(lines) + 10
    x0, y0 = origin
    x1, y1 = min(img.shape[1], x0 + box_w), min(img.shape[0], y0 + box_h)
    roi = img[y0:y1, x0:x1]
    if roi.size:
        roi[:] = cv2.addWeighted(roi, 0.4, np.zeros_like(roi), 0.6, 0)
    for k, (text, color) in enumerate(lines):
        cv2.putText(img, text, (x0 + 8, y0 + line_h * (k + 1) - 2), font, scale, color, 1,
                    cv2.LINE_AA)


WHITE, GREEN, RED, AMBER = (255, 255, 255), (80, 220, 80), (80, 80, 255), (0, 200, 255)


def hud_lines(title: str, m: Metrics, st: PanelStats, size: tuple[int, int],
              fps: float) -> list[tuple[str, tuple[int, int, int]]]:
    def f(v: float | None, unit: str) -> str:
        return "--" if v is None else f"{v:.1f} {unit}"

    lat = st.median_latency
    return [
        (f"{title} ({size[0]}x{size[1]})", WHITE),
        (f"Cara detectada: {'SI' if m.face else 'NO'}   Landmarks: {m.n_landmarks}",
         GREEN if m.face else RED),
        (f"Iris OK (10 puntos): {'SI' if m.iris_ok else 'NO'}", GREEN if m.iris_ok else RED),
        (f"Diametro iris: {f(m.iris_diameter, 'px')}", WHITE),
        (f"Dist. centros iris: {f(m.iris_distance, 'px')}", WHITE),
        (f"Jitter iris ({WINDOW} cuadros): {f(st.jitter, 'px')}", WHITE),
        (f"Latencia mediana: {f(lat, 'ms')}   FPS: {fps:.1f}", WHITE),
        (f"Deteccion acumulada: {st.detection_rate:.1f}% ({st.detections}/{st.frames})", AMBER),
    ]


def render_panel(img: np.ndarray, result: Any, m: Metrics, st: PanelStats, title: str,
                 fps: float, disp_h: int = PANEL_H) -> np.ndarray:
    """Panel de pantalla con landmarks e HUD. Las metricas ya usan el tamano real."""
    h, w = img.shape[:2]
    disp = cv2.resize(img, (max(1, round(w * disp_h / h)), disp_h),
                      interpolation=cv2.INTER_LINEAR)
    if result is not None and result.face_landmarks:
        draw_landmarks(disp, result.face_landmarks[0])
    draw_hud(disp, hud_lines(title, m, st, (w, h), fps))
    return disp


def process(landmarker: vision.FaceLandmarker, frame: np.ndarray, width: int | None,
            quality: int, ts_ms: int, st: PanelStats):
    """Prepara, infiere y actualiza estadisticas. Devuelve (img, result, metrics)."""
    img = prepare(frame, width, quality)
    result, lat = infer(landmarker, img, ts_ms)
    h, w = img.shape[:2]
    m = compute_metrics(result.face_landmarks[0] if result.face_landmarks else None, w, h)
    st.update(m, lat)
    return img, result, m


def panel_titles(width: int | None, quality: int) -> tuple[str, str]:
    return "Resolucion completa", f"Simulacion {width} px, JPEG q{quality}"


def run_live(cam: int, width: int | None, quality: int, compare: bool) -> None:
    sim_width = width or DEFAULT_COMPARE_WIDTH
    # Un landmarker por panel: en modo VIDEO el seguimiento depende del tamano del cuadro.
    lm_full = build_landmarker(MODEL_PATH)
    lm_sim = build_landmarker(MODEL_PATH)
    cap = open_camera(cam)
    cam_idx = cam
    st_full, st_sim = PanelStats(), PanelStats()
    mirror = False
    start = time.perf_counter()
    last = start
    fps = 0.0
    win = "NOVA Face Landmarker (q salir, m espejo, c camara, s vista)"
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("Fallo al leer cuadro de la camara.")
                break
            if mirror:
                frame = cv2.flip(frame, 1)
            ts_ms = int((time.perf_counter() - start) * 1000)
            now = time.perf_counter()
            inst = 1.0 / max(now - last, 1e-6)
            fps = 0.9 * fps + 0.1 * inst if fps else inst
            last = now
            if compare:
                t_full, t_sim = panel_titles(sim_width, quality)
                img, res, m = process(lm_full, frame, None, quality, ts_ms, st_full)
                left = render_panel(img, res, m, st_full, t_full, fps)
                img, res, m = process(lm_sim, frame, sim_width, quality, ts_ms, st_sim)
                right = render_panel(img, res, m, st_sim, t_sim, fps)
                view = cv2.hconcat([left, right])
            elif width:
                _, t_sim = panel_titles(sim_width, quality)
                img, res, m = process(lm_sim, frame, width, quality, ts_ms, st_sim)
                view = render_panel(img, res, m, st_sim, t_sim, fps)
            else:
                img, res, m = process(lm_full, frame, None, quality, ts_ms, st_full)
                view = render_panel(img, res, m, st_full, panel_titles(0, quality)[0], fps)
            cv2.putText(view, "q salir | m espejo | c camara | s vista simple/compare",
                        (8, view.shape[0] - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, WHITE, 1,
                        cv2.LINE_AA)
            cv2.imshow(win, view)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("m"):
                mirror = not mirror
            elif key == ord("s"):
                compare = not compare
            elif key == ord("c"):
                new_idx = cam_idx + 1
                new = try_open_camera(new_idx)
                if new is None:
                    new_idx = 0
                    new = try_open_camera(0)
                if new is None:
                    print("No se pudo abrir otra camara; se mantiene la actual.")
                else:
                    cap.release()
                    cap = new
                    cam_idx = new_idx
    finally:
        cap.release()
        cv2.destroyAllWindows()
        lm_full.close()
        lm_sim.close()


def summarize(latencies: list[float], n_frames: int, detections: int,
              counts: list[int], iris_ok: bool) -> dict[str, str]:
    lat_sorted = sorted(latencies)
    p95 = lat_sorted[min(len(lat_sorted) - 1, int(round(0.95 * (len(lat_sorted) - 1))))]
    return {
        "Cuadros capturados": str(n_frames),
        "Tasa de deteccion de cara": f"{100.0 * detections / n_frames:.1f}% ({detections}/{n_frames})",
        "Landmarks por cara": (f"{sorted(set(counts))} (esperado {EXPECTED_LANDMARKS})"
                               if counts else "n/a (sin detecciones)"),
        "Indices de iris 468-477 presentes": ("si" if iris_ok else "no / sin datos"),
        "Latencia mediana": f"{statistics.median(lat_sorted):.2f} ms",
        "Latencia p95": f"{p95:.2f} ms",
        "Dispositivo": "CPU (delegate CPU de MediaPipe Tasks)",
    }


def env_line() -> str:
    return (f"- Plataforma: {platform.platform()}, Python {platform.python_version()}, "
            f"mediapipe {mp.__version__}, opencv {cv2.__version__}")


def append_results(lines: list[str]) -> None:
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not RESULTS_PATH.exists():
        RESULTS_PATH.write_text("# Resultados spike Face Landmarker\n", encoding="utf-8")
    with RESULTS_PATH.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def write_results(summary: dict[str, str], title: str) -> None:
    lines = [f"\n## {title} ({datetime.now():%Y-%m-%d %H:%M})\n", env_line()]
    lines += [f"- {k}: {v}" for k, v in summary.items()]
    append_results(lines)


def p95_of(values: list[float]) -> float | None:
    if not values:
        return None
    s = sorted(values)
    return s[min(len(s) - 1, int(round(0.95 * (len(s) - 1))))]


def compare_table(width: int, quality: int, full: PanelStats, sim: PanelStats) -> list[str]:
    def med(v: list[float], unit: str, nd: int = 2) -> str:
        return f"{statistics.median(v):.{nd}f} {unit}" if v else "n/a"

    def rate(st: PanelStats) -> str:
        return f"{st.detection_rate:.1f}% ({st.detections}/{st.frames})"

    def iris(st: PanelStats) -> str:
        return f"{st.iris_frames}/{st.frames}"

    def p95(st: PanelStats) -> str:
        v = p95_of(st.all_lats)
        return "n/a" if v is None else f"{v:.2f} ms"

    rows = [
        ("Tasa de deteccion de cara", rate(full), rate(sim)),
        ("Cuadros con iris OK (10 puntos)", iris(full), iris(sim)),
        ("Diametro del iris, mediana", med(full.diameters, "px", 1), med(sim.diameters, "px", 1)),
        ("Jitter del centro del iris, mediana", med(full.jitters, "px"), med(sim.jitters, "px")),
        ("Latencia de inferencia, mediana", med(full.all_lats, "ms"), med(sim.all_lats, "ms")),
        ("Latencia de inferencia, p95", p95(full), p95(sim)),
    ]
    lines = [
        f"\n## Check comparativo: ancho {width} px, JPEG calidad {quality} "
        f"({datetime.now():%Y-%m-%d %H:%M})\n",
        env_line(),
        f"- Calidad JPEG {quality}: SUPUESTO (la real del escaner AR no se conoce). "
        "Ruta simulada: reducir con INTER_AREA, imencode/imdecode JPEG, inferir.",
        "- Diametro del iris: promedio de pares opuestos 469-471, 470-472, 474-476, 475-477. "
        "Jitter: desv. estandar del centro (468/473) en ventana de 30 cuadros, px, promedio de ambos ojos.",
        "",
        f"| Metrica | Completa | {width} px |",
        "|---|---|---|",
    ]
    lines += [f"| {a} | {b} | {c} |" for a, b, c in rows]
    return lines


def run_check(cam: int, n: int, width: int | None, quality: int) -> None:
    if width is not None:
        run_check_compare(cam, n, width, quality)
        return
    landmarker = build_landmarker(MODEL_PATH)
    cap = open_camera(cam)
    latencies: list[float] = []
    counts: list[int] = []
    detections = 0
    iris_ok = False
    start = time.perf_counter()
    try:
        for _ in range(n):
            ok, frame = cap.read()
            if not ok:
                print("Fallo al leer cuadro; se detiene la captura.")
                break
            ts_ms = int((time.perf_counter() - start) * 1000)
            result, lat = infer(landmarker, frame, ts_ms)
            latencies.append(lat)
            if result.face_landmarks:
                detections += 1
                lms = result.face_landmarks[0]
                counts.append(len(lms))
                if len(lms) > max(IRIS_IDX):
                    iris_ok = all(0.0 <= lms[i].x <= 1.0 and 0.0 <= lms[i].y <= 1.0 for i in IRIS_IDX)
    finally:
        cap.release()
        landmarker.close()
    if not latencies:
        sys.exit("No se capturo ningun cuadro.")
    summary = summarize(latencies, len(latencies), detections, counts, iris_ok)
    print("\n=== Resumen --check ===")
    for k, v in summary.items():
        print(f"{k}: {v}")
    write_results(summary, "Check con webcam")
    print(f"\nEscrito en {RESULTS_PATH}")


def run_check_compare(cam: int, n: int, width: int, quality: int) -> None:
    lm_full = build_landmarker(MODEL_PATH)
    lm_sim = build_landmarker(MODEL_PATH)
    cap = open_camera(cam)
    st_full, st_sim = PanelStats(), PanelStats()
    start = time.perf_counter()
    try:
        for _ in range(n):
            ok, frame = cap.read()
            if not ok:
                print("Fallo al leer cuadro; se detiene la captura.")
                break
            ts_ms = int((time.perf_counter() - start) * 1000)
            process(lm_full, frame, None, quality, ts_ms, st_full)
            process(lm_sim, frame, width, quality, ts_ms, st_sim)
    finally:
        cap.release()
        lm_full.close()
        lm_sim.close()
    if not st_full.frames:
        sys.exit("No se capturo ningun cuadro.")
    lines = compare_table(width, quality, st_full, st_sim)
    print("\n=== Resumen --check comparativo ===")
    print("\n".join(lines))
    append_results(lines)
    print(f"\nEscrito en {RESULTS_PATH}")


class _FakeLm:
    def __init__(self, x: float, y: float) -> None:
        self.x, self.y = x, y


def run_smoke() -> None:
    landmarker = build_landmarker(MODEL_PATH)
    black = np.zeros((480, 640, 3), dtype=np.uint8)
    lats = []
    for i in range(30):
        result, lat = infer(landmarker, black, i * 33)
        lats.append(lat)
    landmarker.close()
    print(f"Smoke OK. Caras en cuadro negro: {len(result.face_landmarks)} (esperado 0)")
    print(f"Latencia mediana {statistics.median(lats):.2f} ms, max {max(lats):.2f} ms (30 cuadros)")

    # Ruta redimensionado + JPEG sobre cuadro sintetico (ruido, 1280x720).
    rng = np.random.default_rng(0)
    synth = rng.integers(0, 255, (720, 1280, 3), dtype=np.uint8)
    small = prepare(synth, 512, DEFAULT_JPEG_QUALITY)
    assert small.shape == (288, 512, 3), small.shape
    assert prepare(synth, None, 80) is synth
    print(f"Smoke prepare OK: {synth.shape[:2]} -> {small.shape[:2]} con JPEG q{DEFAULT_JPEG_QUALITY}")

    # Sin cara: metricas y HUD sin errores de indices.
    st = PanelStats()
    for lms in (None, [], [_FakeLm(0.5, 0.5)] * 5):  # sin cara, vacio, landmarks incompletos
        m = compute_metrics(lms, 512, 288)
        st.update(m, 5.0)
    panel = render_panel(small, None, Metrics(), st, "Prueba", 30.0)
    assert panel.shape[0] == PANEL_H
    # Con cara falsa de 478 puntos: iris en cruz de radio 10 px sobre 512x288.
    lms = [_FakeLm(0.5, 0.5) for _ in range(EXPECTED_LANDMARKS)]
    for c, cx in ((468, 0.4), (473, 0.6)):
        lms[c] = _FakeLm(cx, 0.5)
        for k, (dx, dy) in enumerate(((-10, 0), (0, -10), (10, 0), (0, 10))):
            lms[c + 1 + k] = _FakeLm(cx + dx / 512, 0.5 + dy / 288)
    m = compute_metrics(lms, 512, 288)
    assert m.iris_ok and m.iris_diameter is not None and abs(m.iris_diameter - 20.0) < 1e-6
    assert m.iris_distance is not None and abs(m.iris_distance - 0.2 * 512) < 1e-6
    for _ in range(3):
        st.update(m, 5.0)
    class _Res:
        face_landmarks = [lms]
    panel = render_panel(small, _Res(), m, st, "Prueba", 30.0)
    both = cv2.hconcat([panel, panel])
    print(f"Smoke HUD OK: panel {panel.shape[:2]}, compare {both.shape[:2]}, "
          f"diametro {m.iris_diameter:.1f} px, jitter {st.jitter}")
    import spike_v2
    spike_v2.smoke_v2()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--live", action="store_true")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--smoke", action="store_true")
    mode.add_argument("--noise-floor", action="store_true", dest="noise_floor")
    mode.add_argument("--noise-floor-report", action="store_true", dest="noise_floor_report")
    mode.add_argument("--gate-diagnose", action="store_true", dest="gate_diagnose",
                      help="captura --frames (150) cuadros quieto y diagnostica cada criterio del gate")
    p.add_argument("--cam", type=int, default=0, help="indice de camara (default 0)")
    p.add_argument("--frames", type=int, default=None,
                   help="cuadros para --check (default 90; con --sweep 240)")
    p.add_argument("--width", type=int, default=None,
                   help="reducir a este ancho (INTER_AREA) y pasar por JPEG antes de inferir")
    p.add_argument("--jpeg-quality", type=int, default=DEFAULT_JPEG_QUALITY,
                   help=f"calidad JPEG 1-100 (default {DEFAULT_JPEG_QUALITY}, supuesto)")
    p.add_argument("--compare", action="store_true",
                   help="con --live: paneles completa vs simulacion lado a lado")
    v2 = p.add_argument_group("v2 (barrido, suelo de ruido)")
    v2.add_argument("--sweep", action="store_true", help="con --check: barrido de condiciones")
    v2.add_argument("--facing", choices=("front", "back", "unknown"), default="unknown")
    v2.add_argument("--notes", default="", help="luz, lentes, distancia, etc.")
    v2.add_argument("--subject", default="", help="seudonimo del sujeto")
    v2.add_argument("--mirror", action="store_true", help="voltea horizontalmente cada cuadro")
    v2.add_argument("--req-width", type=int, default=None, help="CAP_PROP_FRAME_WIDTH pedido")
    v2.add_argument("--req-height", type=int, default=None, help="CAP_PROP_FRAME_HEIGHT pedido")
    v2.add_argument("--json", action="store_true", help="JSON de metricas en data/vision/")
    v2.add_argument("--save-landmarks", action="store_true",
                    help="guarda landmarks crudos (dato biometrico) en data/vision/; imagenes nunca")
    v2.add_argument("--session-id", type=int, default=None, help="id de sesion de --noise-floor")
    v2.add_argument("--blocks", type=int, default=3)
    v2.add_argument("--block-seconds", type=float, default=20.0)
    v2.add_argument("--countdown", type=int, default=5)
    v2.add_argument("--start-delay", type=int, default=15, dest="start_delay",
                    help="segundos de espera antes del primer bloque cuando no hay teclado interactivo (!)")
    v2.add_argument("--gate-window", type=float, default=1.0, help="ventana del gate, s")
    v2.add_argument("--gate-speed", type=float, default=0.5, help="%% de IOD por cuadro")
    v2.add_argument("--gate-roll", type=float, default=2.0, help="rango de roll, grados")
    v2.add_argument("--gate-iod", type=float, default=2.0, help="rango de IOD, %%")
    v2.add_argument("--gate-angle", type=float, default=3.0, help="rango de yaw/pitch, grados")
    vw = p.add_argument_group("vista en vivo (--check --sweep, --noise-floor, --gate-diagnose)")
    vw.add_argument("--view", action=argparse.BooleanOptionalAction, default=True,
                    help="ventana en vivo con landmarks, quietud y progreso (default: si; "
                         "--no-view o sin entorno grafico: solo texto)")
    vw.add_argument("--view-scale", type=float, default=1.0, help="escala de la ventana (default 1.0)")
    vw.add_argument("--view-hold", type=float, default=0.0,
                    help="segundos que queda el panel final (0 = hasta presionar una tecla)")
    vw.add_argument("--wait-still", action=argparse.BooleanOptionalAction, default=True,
                    help="con vista: la captura empieza cuando el gate lleva >= 1,5 s en verde")
    vw.add_argument("--wait-still-timeout", type=float, default=30.0,
                    help="maximo de espera de quietud, s (default 30; si vence, graba igual)")
    vw.add_argument("--min-quiet", type=float, default=80.0,
                    help="con vista: %% minimo de ventanas de 1 s en verde DURANTE la captura (default 80); "
                         "si es menor, avisa con 3 pitidos y repite la captura")
    vw.add_argument("--max-retries", type=int, default=2,
                    help="con vista: reintentos de captura por poca quietud (default 2; 0 = no reintenta). "
                         "No aplica a --gate-diagnose. Sin vista (--no-view) ambos flags no actuan")
    a = p.parse_args()
    if not 0 <= a.min_quiet <= 100 or a.max_retries < 0:
        p.error("--min-quiet debe estar entre 0 y 100 y --max-retries >= 0")
    if a.view_scale <= 0 or a.view_hold < 0 or a.wait_still_timeout <= 0:
        p.error("--view-scale y --wait-still-timeout deben ser > 0 y --view-hold >= 0")
    if a.sweep and not a.check:
        p.error("--sweep solo se usa con --check")
    if a.width is not None and a.width < 16:
        p.error("--width debe ser >= 16")
    if not 1 <= a.jpeg_quality <= 100:
        p.error("--jpeg-quality debe estar entre 1 y 100")
    if a.compare and not a.live:
        p.error("--compare solo se usa con --live")
    if a.noise_floor or a.noise_floor_report or a.sweep or a.gate_diagnose:
        import spike_metrics
        import spike_v2
        gp = spike_metrics.GateParams(window_s=a.gate_window, speed_pct=a.gate_speed,
                                      roll_deg=a.gate_roll, iod_pct=a.gate_iod,
                                      angle_deg=a.gate_angle)
        if a.sweep:
            a.frames = a.frames or 240
            spike_v2.run_sweep(a, gp)
        elif a.gate_diagnose:
            spike_v2.run_gate_diagnose(a, gp)
        elif a.noise_floor:
            spike_v2.run_noise_floor(a, gp)
        else:
            spike_v2.run_noise_floor_report(a)
    elif a.live:
        run_live(a.cam, a.width, a.jpeg_quality, a.compare)
    elif a.check:
        run_check(a.cam, a.frames or 90, a.width, a.jpeg_quality)
    else:
        run_smoke()


if __name__ == "__main__":
    main()
