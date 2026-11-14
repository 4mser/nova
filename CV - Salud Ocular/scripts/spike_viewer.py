"""Interfaz en tiempo real (ventana OpenCV) del spike v2.

Funciones puras de dibujo y de logica (testeables sin ventana ni camara) mas la clase LiveView,
que es la unica que toca cv2.imshow. Todo el texto es ASCII (Hershey no dibuja tildes).
Los cuadros que se capturan NUNCA se modifican aqui: se dibuja sobre una copia. Nada se guarda.
"""
from __future__ import annotations

import math
import time
import unicodedata
from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Sequence

import cv2
import numpy as np

import spike_metrics as sm

WINDOW = "NOVA spike - vista en vivo"
FONT = cv2.FONT_HERSHEY_SIMPLEX
VIDEO_W = 640          # el video se normaliza a este ancho
PANEL_W = 360
SPARK_H = 150          # franja bajo el video (minigrafico de EAR)
MIN_H = 620
PROC_W, PROC_H = 980, 640
SLOW_INFER_MS = 25.0   # inferencia de visualizacion mas lenta: no se dibuja ese cuadro
STILL_HOLD_S = 1.5
SPARK_WINDOW_S = 5.0

BG = (24, 24, 24)
WHITE = (240, 240, 240)
GRAY = (140, 140, 140)
DIM = (85, 85, 85)
GREEN = (60, 200, 60)
RED = (50, 50, 230)
YELLOW = (0, 255, 255)
ORANGE = (0, 165, 255)
CYAN = (255, 220, 0)
Color = tuple[int, int, int]

RIGHT_EYE = (33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246)
LEFT_EYE = (362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398)
FACE_OVAL = (10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
             152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109)


class ViewAbort(Exception):
    """El usuario cerro la vista (q, ESC o cerrar la ventana): abortar sin escribir resultados."""


# ---------------------------------------------------------------- formato y colores (puro)
def ascii_text(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")


def fmt_num(v: float | None, nd: int = 2, unit: str = "") -> str:
    return "n/a" if v is None or not math.isfinite(v) else f"{v:.{nd}f}{unit}"


def fmt_clock(seconds: float) -> str:
    s = max(0, int(seconds))
    return f"{s // 60:02d}:{s % 60:02d}"


def fmt_remaining(seconds: float | None) -> str:
    return "n/a" if seconds is None or not math.isfinite(seconds) else f"{max(0.0, seconds):.1f} s"


def status_color(ok: bool | None) -> Color:
    """Verde si cumple, rojo si no, gris si no aplica / sin dato."""
    return GRAY if ok is None else (GREEN if ok else RED)


def phase_color(phase: str) -> Color:
    if phase.startswith("CUENTA"):
        return YELLOW
    if phase.startswith("GRAB"):
        return RED
    if phase.startswith("ESPERANDO"):
        return ORANGE
    if phase.startswith("TE MOVISTE"):
        return RED
    if phase.startswith("PROCES"):
        return CYAN
    if phase.startswith("NEUTRAL"):
        return GREEN
    if phase.startswith(("CEJAS", "CENO")):
        return RED
    if phase.startswith("RELAJA"):
        return YELLOW
    if phase.startswith("REVISION"):
        return CYAN
    return WHITE


def line_color(text: str) -> Color:
    if "NO CUMPLE" in text or "MOVIMIENTO" in text:
        return RED
    if "CUMPLE" in text:
        return GREEN
    if text.startswith("!"):
        return ORANGE
    return WHITE


def key_action(code: int) -> str | None:
    """Tecla de cv2.waitKey -> accion: quit (q/ESC), mirror (m), pause (p), numbers (n)."""
    if code < 0:
        return None
    c = code & 0xFF
    if c == 27 or c in (ord("q"), ord("Q")):
        return "quit"
    if c in (ord("m"), ord("M")):
        return "mirror"
    if c in (ord("p"), ord("P")):
        return "pause"
    if c in (ord("n"), ord("N")):
        return "numbers"
    return None


def put(img: np.ndarray, text: str, org: tuple[int, int], color: Color = WHITE, scale: float = 0.5,
        thick: int = 1) -> None:
    cv2.putText(img, ascii_text(text), org, FONT, scale, color, thick, cv2.LINE_AA)


def bar(img: np.ndarray, x: int, y: int, w: int, h: int, frac: float | None, color: Color) -> None:
    cv2.rectangle(img, (x, y), (x + w, y + h), GRAY, 1)
    if frac is not None and math.isfinite(frac):
        fw = int(round((w - 2) * min(1.0, max(0.0, frac))))
        if fw > 0:
            cv2.rectangle(img, (x + 1, y + 1), (x + 1 + fw, y + h - 1), color, -1)


# ---------------------------------------------------------------- quietud en vivo
@dataclass(frozen=True)
class Indicator:
    key: str
    label: str
    value: float | None
    thr: float
    ok: bool | None   # None = criterio omitido (p. ej. yaw/pitch sin matriz)
    unit: str


@dataclass(frozen=True)
class GateStatus:
    indicators: tuple[Indicator, ...]
    quiet: bool
    face_loss_pct: float
    failed: tuple[str, ...] = ()   # claves de sm.CRITERIA que NO pasan en la ventana actual


GATE_ROWS = (("speed", "Velocidad", "%IOD/cuad"), ("roll", "Roll", "gr"), ("iod", "IOD", "%"),
             ("yaw", "Yaw", "gr"), ("pitch", "Pitch", "gr"))


def indicator_text(ind: Indicator) -> str:
    if ind.value is None:
        return "omitido (sin dato)" if ind.ok is None else f"sin dato / < {ind.thr:g}"
    return f"{ind.value:.2f} / < {ind.thr:g} {ind.unit}"


class LiveGate:
    """Gate de quietud incremental: guarda por cuadro lo ya derivado (posicion y escala del gate,
    roll, yaw, pitch, EAR) y evalua solo la ventana de ~gp.window_s s mas reciente (~30 cuadros).
    Reutiliza sm.gate_inputs / gate_window_values / window_pass, asi que coincide con el gate
    offline. El parpadeo se detecta con el EAR del buffer (mismas reglas que sm.gate_blink_mask)."""

    def __init__(self, gp: sm.GateParams, maxlen: int = 120) -> None:
        self.gp = gp
        self.buf: deque[tuple[np.ndarray, float, float, float, float, float, bool, float]] =             deque(maxlen=maxlen)

    def push(self, p: np.ndarray | None, mat: np.ndarray | None, t: float) -> None:
        nan = float("nan")
        if p is None or not np.isfinite(p).all():
            self.buf.append((np.full(2, nan), nan, nan, nan, nan, nan, False, t))
            return
        pos, scale, roll = sm.gate_inputs(p[None], self.gp.legacy)
        ear = float(sm.ear_frames(p[None])[0])
        yaw, pitch = sm.euler_yxz(mat)[:2] if mat is not None else (nan, nan)
        self.buf.append((pos[0], float(scale[0]), float(roll[0]), yaw, pitch, ear, True, t))

    def status(self) -> GateStatus | None:
        """None mientras no haya una ventana completa (calentando)."""
        n = len(self.buf)
        if n < 5:
            return None
        span = self.buf[-1][7] - self.buf[0][7]
        if span <= 0:
            return None
        fs = (n - 1) / span
        w = max(3, int(round(self.gp.window_s * fs)))
        if n < w:
            return None
        rows = list(self.buf)
        col = lambda i: np.array([r[i] for r in rows], dtype=float)  # noqa: E731
        blink = None if self.gp.legacy else sm.gate_blink_mask(col(5))[-w:]
        rows = rows[-w:]
        col = lambda i: np.array([r[i] for r in rows], dtype=float)  # noqa: E731
        vals = sm.gate_window_values(np.stack([r[0] for r in rows]), col(1), col(2), col(3), col(4),
                                     np.array([r[6] for r in rows]), fs, self.gp, blink)
        passes = sm.window_pass(vals, self.gp)
        thr = {"speed": self.gp.speed_pct, "roll": self.gp.roll_deg, "iod": self.gp.iod_pct,
               "yaw": self.gp.angle_deg, "pitch": self.gp.angle_deg}
        inds = []
        for key, label, unit in GATE_ROWS:
            v, ok = float(vals[key][0]), bool(passes[key][0])
            if not math.isfinite(v):
                inds.append(Indicator(key, label, None, thr[key], None if ok else False, unit))
            else:
                inds.append(Indicator(key, label, v, thr[key], ok, unit))
        failed = tuple(k for k in sm.CRITERIA if not bool(passes[k][0]))
        return GateStatus(tuple(inds), not failed, float(vals["face_loss"][0]), failed)


class FailTally:
    """Cuenta, por muestra del gate, que criterios fallaron (solo claves, nunca imagenes)."""

    def __init__(self) -> None:
        self.n = 0
        self.counts: dict[str, int] = {k: 0 for k in sm.CRITERIA}

    def add(self, failed: Sequence[str]) -> None:
        self.n += 1
        for k in failed:
            self.counts[k] = self.counts.get(k, 0) + 1

    def pct(self) -> dict[str, float]:
        return {k: (100.0 * c / self.n if self.n else 0.0) for k, c in self.counts.items()}

    def summary(self, prefix: str = "criterios que fallaron") -> str:
        return sm.fail_summary(self.pct(), prefix)


@dataclass
class StillWaiter:
    """Espera de quietud: listo cuando el gate lleva >= hold_s seguidos en verde; vence a timeout_s."""
    hold_s: float = STILL_HOLD_S
    timeout_s: float = 30.0
    start: float | None = None
    green_since: float | None = None

    def update(self, quiet: bool | None, t: float) -> str:
        """'waiting', 'ready' o 'timeout'."""
        if self.start is None:
            self.start = t
        if quiet:
            if self.green_since is None:
                self.green_since = t
            if t - self.green_since >= self.hold_s:
                return "ready"
        else:
            self.green_since = None
        return "timeout" if t - self.start >= self.timeout_s else "waiting"

    def green_s(self, t: float) -> float:
        return 0.0 if self.green_since is None else t - self.green_since

    def elapsed(self, t: float) -> float:
        return 0.0 if self.start is None else t - self.start


def quiet_pct(samples: Sequence[bool]) -> float | None:
    """% de muestras del gate en verde; None sin muestras (puro)."""
    return None if len(samples) == 0 else 100.0 * sum(bool(x) for x in samples) / len(samples)


# ---------------------------------------------------------------- metricas en vivo
@dataclass(frozen=True)
class LiveMetrics:
    ear_r: float
    ear_l: float
    a_r: float
    a_l: float
    mrd2n_r: float
    mrd2n_l: float
    iod_px: float
    iris_px: float


def live_metrics(p: np.ndarray | None) -> LiveMetrics | None:
    """Metricas de un cuadro (mismas formulas que sm.analyze_recording). A y MRD2n se normalizan
    con el diametro del iris DEL CUADRO (en el offline se usa S_t = IOD x mediana(D)/mediana(IOD))."""
    if p is None or p.shape[0] < sm.N_LANDMARKS or not np.isfinite(p).all():
        return None
    P = p[None]
    try:
        assign = sm.assign_iris(P)
    except ValueError:
        return None
    d = float(sm.iris_diameter(P)[0])
    if d <= 0:
        return None
    out: dict[str, float] = {}
    mids = {}
    for k, eye in sm.EYES.items():
        g = sm.eye_geometry(P, eye, assign[k])
        mids[k] = g["m"][0]
        num = sum(float(np.linalg.norm(p[a] - p[b])) for a, b in eye.ear_pairs)
        out[f"ear_{k}"] = num / (2 * float(g["w"][0]))
        out[f"a_{k}"] = float((p[eye.mid_lower] - p[eye.mid_upper]) @ g["ey"][0]) / d
        out[f"mrd_{k}"] = float((p[eye.mid_lower] - g["c"][0]) @ g["ey"][0]) / d
    return LiveMetrics(out["ear_R"], out["ear_L"], out["a_R"], out["a_L"], out["mrd_R"], out["mrd_L"],
                       float(np.linalg.norm(mids["R"] - mids["L"])), d)


@dataclass(frozen=True)
class BrowLive:
    """PTB en vivo (diametros de iris del CUADRO), pitch y puntaje de ceja de un cuadro."""
    ptb_inf_r: float
    ptb_inf_l: float
    ptb_sup_r: float
    ptb_sup_l: float
    th_r: float
    th_l: float
    pitch: float
    blend_max: float | None = None
    active: bool | None = None


def live_brow(p: np.ndarray | None, mat: np.ndarray | None, blend: np.ndarray | None = None,
              bp: sm.BrowParams = sm.BrowParams()) -> BrowLive | None:
    """Mismas formulas que sm.brow_series con el diametro del iris del cuadro como escala.
    None si no hay cara, el iris no se asigna o las cejas quedan cruzadas. blend (5,) opcional."""
    if p is None or p.shape[0] < sm.N_LANDMARKS or not np.isfinite(p).all():
        return None
    P = p[None]
    try:
        assign = sm.assign_iris(P)
        sm.check_brow_assignment(P)
    except ValueError:
        return None
    d = float(sm.iris_diameter(P)[0])
    if d <= 0:
        return None
    s_t = np.array([d])
    v: dict[str, dict[str, float]] = {}
    for k, eye in sm.EYES.items():
        g = sm.eye_geometry(P, eye, assign[k])
        v[k] = {n: float(a[0]) for n, a in sm.brow_series(P, k, g, s_t).items()}
    pitch = sm.euler_yxz(mat)[1] if mat is not None else math.nan
    bmax = act = None
    if blend is not None and np.isfinite(blend).any():
        bmax = float(np.nanmax(blend))
        act = bool(bmax > bp.abs_thr)  # en vivo solo el umbral absoluto (no hay mediana de sesion)
    return BrowLive(v["R"]["ptb_inf"], v["L"]["ptb_inf"], v["R"]["ptb_sup"], v["L"]["ptb_sup"],
                    v["R"]["brow_th"], v["L"]["brow_th"], pitch, bmax, act)


def draw_brows(img: np.ndarray, P: np.ndarray | None, numbers: bool = False) -> None:
    """Polilinea de ceja superior (verde) e inferior (roja) de ambas cejas; con numbers, el
    indice de landmark junto a cada punto (para confirmar a ojo los indices de ceja)."""
    if P is None or P.shape[0] < sm.N_LANDMARKS or not np.isfinite(P).all():
        return
    pts = np.rint(P).astype(np.int32)
    for brow in sm.BROWS.values():
        for idxs, col in ((brow.upper, GREEN), (brow.lower, RED)):
            cv2.polylines(img, [pts[list(idxs)]], False, col, 2, cv2.LINE_AA)
            for i in idxs:
                cv2.circle(img, (int(pts[i][0]), int(pts[i][1])), 3, col, -1, cv2.LINE_AA)
                if numbers:
                    put(img, str(i), (int(pts[i][0]) + 4, int(pts[i][1]) - 5), col, 0.38)


class EarTrace:
    """EAR medio de los ultimos 5 s y deteccion de parpadeo en vivo (misma regla que sm.detect_blinks:
    EAR < 0,6 x mediana abierta durante >= 2 cuadros)."""

    def __init__(self, window_s: float = SPARK_WINDOW_S) -> None:
        self.window_s = window_s
        self.samples: deque[tuple[float, float]] = deque()
        self.below = 0
        self.blinks = 0
        self.baseline = float("nan")
        self.flash_until = -math.inf

    def push(self, t: float, ear: float | None) -> None:
        self.samples.append((t, float("nan") if ear is None else ear))
        while self.samples and t - self.samples[0][0] > self.window_s:
            self.samples.popleft()
        vals = np.array([v for _, v in self.samples])
        vals = vals[np.isfinite(vals)]
        if vals.size >= 10:
            self.baseline = sm.open_baseline(vals)
        if ear is None or not math.isfinite(self.baseline) or ear >= sm.BLINK_FRAC * self.baseline:
            self.below = 0
            return
        self.below += 1
        if self.below == sm.BLINK_MIN_FRAMES:
            self.blinks += 1
            self.flash_until = t + 0.5

    def flashing(self, now: float) -> bool:
        return now < self.flash_until

    @property
    def threshold(self) -> float | None:
        return sm.BLINK_FRAC * self.baseline if math.isfinite(self.baseline) else None


Segment = list[tuple[int, int]]


def sparkline_segments(samples: Sequence[tuple[float, float]], now: float, window_s: float,
                       rect: tuple[int, int, int, int]
                       ) -> tuple[list[Segment], tuple[float, float]]:
    """Polilineas en pixeles de rect (x, y, w, h) para las muestras (t, valor) de los ultimos
    window_s s; se parten en los NaN. Devuelve (segmentos, (vmin, vmax) de la escala)."""
    x0, y0, w, h = rect
    keep = [(t, v) for t, v in samples if now - t <= window_s]
    good = [v for _, v in keep if math.isfinite(v)]
    if not good:
        return [], (0.0, 1.0)
    center = (min(good) + max(good)) / 2
    span = max(max(good) - min(good), 0.1) * 1.3
    vmin, vmax = center - span / 2, center + span / 2
    segs: list[Segment] = []
    cur: Segment = []
    for t, v in keep:
        if not math.isfinite(v):
            if cur:
                segs.append(cur)
                cur = []
            continue
        x = x0 + (t - (now - window_s)) / window_s * (w - 1)
        y = y0 + (1.0 - (v - vmin) / (vmax - vmin)) * (h - 1)
        cur.append((int(round(min(x0 + w - 1, max(x0, x)))), int(round(min(y0 + h - 1, max(y0, y))))))
    if cur:
        segs.append(cur)
    return segs, (vmin, vmax)


# ---------------------------------------------------------------- dibujo de landmarks
def draw_landmarks(img: np.ndarray, P: np.ndarray | None) -> None:
    """Dibuja sobre img (in place): oval de cara tenue, contorno de ojos, iris amarillo con centro rojo."""
    if P is None or P.shape[0] < sm.N_LANDMARKS or not np.isfinite(P).all():
        return
    pts = np.rint(P).astype(np.int32)
    cv2.polylines(img, [pts[list(FACE_OVAL)]], True, DIM, 1, cv2.LINE_AA)
    for eye in (RIGHT_EYE, LEFT_EYE):
        cv2.polylines(img, [pts[list(eye)]], True, CYAN, 1, cv2.LINE_AA)
    for c in (468, 473):
        r = int(round(float(np.linalg.norm(P[c + 1:c + 5] - P[c], axis=1).mean())))
        cx, cy = int(pts[c][0]), int(pts[c][1])
        cv2.circle(img, (cx, cy), max(r, 1), YELLOW, 1, cv2.LINE_AA)
        for q in pts[c + 1:c + 5]:
            cv2.circle(img, (int(q[0]), int(q[1])), 1, YELLOW, -1, cv2.LINE_AA)
        cv2.circle(img, (cx, cy), 2, RED, -1, cv2.LINE_AA)


# ---------------------------------------------------------------- fase de captura
@dataclass
class CaptureHud:
    mode: str = ""
    phase: str = ""
    progress: float | None = None
    remaining_s: float | None = None
    size: tuple[int, int] = (0, 0)
    fps: float = 0.0
    block: tuple[int, int] | None = None
    gate: GateStatus | None = None
    metrics: LiveMetrics | None = None
    ear_samples: list[tuple[float, float]] = field(default_factory=list)
    ear_thr: float | None = None
    now: float = 0.0
    blink_flash: bool = False
    blinks: int = 0
    note: str = ""
    infer_ms: float = 0.0
    slow: bool = False
    paused: bool = False
    brow_view: bool = False          # dibuja cejas y muestra el bloque CEJA (--brow-check, control, ruido)
    brow: BrowLive | None = None
    brow_numbers: bool = False


def fit_video(frame: np.ndarray, P: np.ndarray | None) -> tuple[np.ndarray, np.ndarray | None]:
    """Copia del cuadro a ancho VIDEO_W y landmarks escalados (el original no se toca)."""
    h, w = frame.shape[:2]
    s = VIDEO_W / w
    if abs(s - 1.0) > 1e-9:
        v = cv2.resize(frame, (VIDEO_W, max(1, round(h * s))),
                       interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
    else:
        v = frame.copy()
    return v, (None if P is None else np.asarray(P, dtype=float) * s)


def _draw_sparkline(canvas: np.ndarray, hud: CaptureHud, rect: tuple[int, int, int, int]) -> None:
    x, y, w, h = rect
    cv2.rectangle(canvas, (x, y), (x + w, y + h), DIM, 1)
    segs, (vmin, vmax) = sparkline_segments(hud.ear_samples, hud.now, SPARK_WINDOW_S, rect)
    if hud.ear_thr is not None and vmin <= hud.ear_thr <= vmax:
        ty = int(round(y + (1 - (hud.ear_thr - vmin) / (vmax - vmin)) * (h - 1)))
        cv2.line(canvas, (x, ty), (x + w, ty), ORANGE, 1)
    for seg in segs:
        if len(seg) > 1:
            cv2.polylines(canvas, [np.array(seg, np.int32)], False, CYAN, 2, cv2.LINE_AA)
    put(canvas, f"EAR medio, ultimos {SPARK_WINDOW_S:g} s (naranja: umbral de parpadeo)", (x, y - 6), GRAY, 0.42)
    put(canvas, f"{vmax:.2f}", (x + w - 40, y + 12), GRAY, 0.38)
    put(canvas, f"{vmin:.2f}", (x + w - 40, y + h - 4), GRAY, 0.38)


def _draw_capture_panel(canvas: np.ndarray, hud: CaptureHud) -> None:
    x = VIDEO_W + 12
    put(canvas, hud.mode, (x, 24), WHITE, 0.55, 1)
    put(canvas, hud.phase, (x, 52), phase_color(hud.phase), 0.62, 2)
    bar(canvas, x, 62, PANEL_W - 24, 14, hud.progress, phase_color(hud.phase))
    pct = "" if hud.progress is None else f"  ({100 * hud.progress:.0f} %)"
    put(canvas, f"Restante: {fmt_remaining(hud.remaining_s)}{pct}", (x, 96), WHITE, 0.5)
    put(canvas, f"Resolucion {hud.size[0]}x{hud.size[1]}   FPS {hud.fps:.1f}", (x, 118), WHITE, 0.5)
    if hud.block is not None:
        put(canvas, f"Bloque {hud.block[0]}/{hud.block[1]}", (x, 140), YELLOW, 0.55)
    for i, line in enumerate(hud.note.split("\n")[:2] if hud.note else []):
        put(canvas, line, (x, 158 + 14 * i), ORANGE, 0.42 if i == 0 else 0.4)
    # quietud
    put(canvas, "QUIETUD EN VIVO (ventana 1 s)", (x, 188), WHITE, 0.5)
    g = hud.gate
    if g is None:
        light, label, lc = GRAY, "CALENTANDO", GRAY
    else:
        light = status_color(g.quiet)
        label, lc = ("QUIETO" if g.quiet else "NO QUIETO"), light
    cv2.circle(canvas, (x + 14, 214), 12, light, -1, cv2.LINE_AA)
    put(canvas, label, (x + 36, 221), lc, 0.7, 2)
    for i, (key, name, _) in enumerate(GATE_ROWS):
        yy = 250 + 24 * i
        ind = next((q for q in g.indicators if q.key == key), None) if g else None
        col = status_color(ind.ok) if ind else GRAY
        cv2.rectangle(canvas, (x, yy - 11), (x + 10, yy - 1), col, -1)
        put(canvas, name, (x + 18, yy), WHITE, 0.45)
        put(canvas, indicator_text(ind) if ind else "...", (x + 100, yy), col, 0.45)
    if g is not None and g.failed:
        names = [sm.CRITERION_LABELS[k] for k in g.failed]
        put(canvas, "EN ROJO: " + ", ".join(names), (x, 250 + 24 * 5 - 4), RED, 0.42)
    if g is not None and g.face_loss_pct > 0:
        put(canvas, f"Cara perdida en {g.face_loss_pct:.0f} % de la ventana", (x, 250 + 24 * 5 + 12), RED, 0.4)
    # metricas
    put(canvas, "METRICAS EN VIVO", (x, 400), WHITE, 0.5)
    m = hud.metrics
    rows = [("EAR  R / L", f"{fmt_num(m and m.ear_r)} / {fmt_num(m and m.ear_l)}"),
            ("Apertura A R / L", f"{fmt_num(m and m.a_r)} / {fmt_num(m and m.a_l)}"),
            ("MRD2n R / L", f"{fmt_num(m and m.mrd2n_r)} / {fmt_num(m and m.mrd2n_l)}"),
            ("Dist. entre ojos", fmt_num(m and m.iod_px, 1, " px")),
            ("Diametro iris", fmt_num(m and m.iris_px, 1, " px"))]
    for i, (k, v) in enumerate(rows):
        put(canvas, k, (x, 426 + 22 * i), GRAY, 0.45)
        put(canvas, v, (x + 150, 426 + 22 * i), WHITE, 0.45)
    put(canvas, f"Parpadeos: {hud.blinks}   inferencia vista: {hud.infer_ms:.0f} ms", (x, 426 + 22 * 5 + 8),
        GRAY, 0.42)
    if hud.brow_view:
        _draw_brow_panel(canvas, hud, x)
    put(canvas, "q/ESC aborta   m espejo   p pausa de vista" + ("   n numeros" if hud.brow_view else ""),
        (x, canvas.shape[0] - 10), GRAY, 0.42)


def _draw_brow_panel(canvas: np.ndarray, hud: CaptureHud, x: int) -> None:
    b = hud.brow
    put(canvas, "CEJA (PTB, diam. iris del cuadro)", (x, 578), WHITE, 0.5)
    rows = [("PTB_inf R / L", f"{fmt_num(b and b.ptb_inf_r)} / {fmt_num(b and b.ptb_inf_l)}"),
            ("PTB_sup R / L", f"{fmt_num(b and b.ptb_sup_r)} / {fmt_num(b and b.ptb_sup_l)}"),
            ("brow_th R / L", f"{fmt_num(b and b.th_r)} / {fmt_num(b and b.th_l)}"),
            ("Pitch (grados)", fmt_num(b and b.pitch, 1)),
            ("Puntaje ceja max", fmt_num(b and b.blend_max))]
    for i, (k, v) in enumerate(rows):
        put(canvas, k, (x, 602 + 22 * i), GRAY, 0.45)
        put(canvas, v, (x + 150, 602 + 22 * i), WHITE, 0.45)
    if b is not None and b.active is not None:
        put(canvas, "CEJA ACTIVA" if b.active else "ceja en reposo", (x, 602 + 22 * 5 + 6),
            ORANGE if b.active else GREEN, 0.5, 2)



def instruction_for(phase: str, mode: str) -> tuple[list[str], Color]:
    """Cartel de instrucciones segun fase y modo (ASCII, la fuente Hershey no dibuja tildes)."""
    ph = phase.upper()
    if ph.startswith("CUENTA"):
        return ["ACOMODATE", "1) Sube esta ventana al borde superior, pegada a la camara",
                "2) Cabeza apoyada, a 50 cm. 3) Mira el PUNTO ROJO de arriba"], YELLOW
    if ph.startswith("ESPERANDO"):
        return ["QUEDATE QUIETO", "Mira el PUNTO ROJO de arriba, sin moverte ni hablar",
                "Empieza solo cuando los indicadores esten en verde"], ORANGE
    if ph.startswith("TE MOVISTE"):
        return ["TE MOVISTE - SE REPITE", "Cabeza apoyada y quieta", "Mira el PUNTO ROJO de arriba"], RED
    if ph.startswith("GRABANDO"):
        return ["GRABANDO: QUIETO", "Mira el PUNTO ROJO de arriba todo el tiempo. Sin hablar",
                "PARPADEA NORMAL (no te aguantes). Sin mover la cabeza"], GREEN
    if ph.startswith("PROCESANDO"):
        return ["PROCESANDO", "Ya puedes relajarte"], WHITE
    if ph.startswith("NEUTRAL"):
        return ["LINEA NEUTRAL: CARA RELAJADA", "Mira el PUNTO ROJO de arriba, sin gesto ni hablar",
                "Cejas en reposo, cabeza quieta"], GREEN
    if ph.startswith("CEJAS ALZADAS"):
        return ["ALZA LAS CEJAS Y MANTEN", "Como sorpresa moderada, sostenida los 10 s",
                "Mira el PUNTO ROJO, cabeza quieta"], ORANGE
    if ph.startswith("CENO FRUNCIDO"):
        return ["FRUNCE EL CENO Y MANTEN", "Cejas hacia abajo y juntas, sostenido los 10 s",
                "Mira el PUNTO ROJO, cabeza quieta"], ORANGE
    if ph.startswith("RELAJA"):
        return ["RELAJA LA CARA", "La siguiente fase empieza en breve"], YELLOW
    if ph.startswith("REVISION"):
        return ["REVISION DE CEJAS (no se graba nada)", "Verde = borde superior, rojo = inferior",
                "n numera los puntos, q/ESC sale"], CYAN
    return [], WHITE


FIXATION_PHASES = ("CUENTA", "ESPERANDO", "TE MOVISTE", "GRABANDO", "NEUTRAL", "CEJAS", "CENO", "RELAJA")


def draw_fixation(img: np.ndarray, phase: str) -> None:
    """Punto rojo de fijacion arriba al centro del video (cerca de la camara) en las fases de captura."""
    if not phase.upper().startswith(FIXATION_PHASES):
        return
    cx, cy = img.shape[1] // 2, 34
    cv2.circle(img, (cx, cy), 16, (255, 255, 255), 2)
    cv2.circle(img, (cx, cy), 10, RED, -1)
    cv2.circle(img, (cx, cy), 2, (255, 255, 255), -1)


def render_capture(frame: np.ndarray, P: np.ndarray | None, hud: CaptureHud, mirror: bool = False,
                   draw_lm: bool = True) -> np.ndarray:
    """Imagen completa de la fase de captura: video con landmarks + panel HUD + minigrafico."""
    v, Ps = fit_video(frame, P)
    if mirror:
        v = cv2.flip(v, 1)
        if Ps is not None:
            Ps = Ps.copy()
            Ps[:, 0] = VIDEO_W - 1 - Ps[:, 0]
    vh = v.shape[0]
    if draw_lm:
        draw_landmarks(v, Ps)
        if hud.brow_view:
            draw_brows(v, Ps, hud.brow_numbers)
        if Ps is None:
            put(v, "SIN CARA", (12, 28), RED, 0.8, 2)
    elif hud.slow:
        put(v, f"SIN DIBUJO: inferencia lenta ({hud.infer_ms:.0f} ms > {SLOW_INFER_MS:.0f})", (12, vh - 12),
            ORANGE, 0.5)
    draw_fixation(v, hud.phase)
    lines, col = instruction_for(hud.phase, hud.mode)
    if lines:
        bh = 26 * len(lines) + 14
        y0 = vh - bh
        ov = v.copy()
        cv2.rectangle(ov, (0, y0), (VIDEO_W - 1, vh - 1), (0, 0, 0), -1)
        cv2.addWeighted(ov, 0.6, v, 0.4, 0, v)
        for i, s in enumerate(lines):
            put(v, s, (14, y0 + 26 * (i + 1) - 4), col if i == 0 else WHITE, 0.75 if i == 0 else 0.55, 2 if i == 0 else 1)
    if hud.blink_flash:
        cv2.rectangle(v, (0, 0), (VIDEO_W - 1, vh - 1), RED, 8)
        put(v, "PARPADEO", (VIDEO_W // 2 - 70, 34), RED, 0.9, 2)
    h = max(vh + SPARK_H, MIN_H + (150 if hud.brow_view else 0))
    canvas = np.full((h, VIDEO_W + PANEL_W, 3), BG, np.uint8)
    canvas[:vh, :VIDEO_W] = v
    _draw_sparkline(canvas, hud, (10, vh + 30, VIDEO_W - 20, SPARK_H - 45))
    _draw_capture_panel(canvas, hud)
    return canvas


# ---------------------------------------------------------------- fase de procesamiento
@dataclass(frozen=True)
class RowStat:
    name: str
    det_pct: float
    iris_pct: float
    lat_ms: float


@dataclass
class ProcState:
    title: str
    label: str
    unit: int
    n_units: int
    progress: float
    preview: np.ndarray | None = None
    P: np.ndarray | None = None
    rows: list[RowStat] = field(default_factory=list)
    elapsed_s: float = 0.0
    detail: str = ""


def fit_box(img: np.ndarray, bw: int, bh: int) -> tuple[np.ndarray, float]:
    """Escala img para caber en bw x bh (NEAREST al ampliar: se ve lo que recibe el modelo)."""
    h, w = img.shape[:2]
    s = min(bw / w, bh / h)
    out = cv2.resize(img, (max(1, round(w * s)), max(1, round(h * s))),
                     interpolation=cv2.INTER_NEAREST if s > 1 else cv2.INTER_AREA)
    return out, s


def render_processing(st: ProcState) -> np.ndarray:
    canvas = np.full((PROC_H, PROC_W, 3), BG, np.uint8)
    put(canvas, f"{st.title}  -  condicion {st.unit}/{st.n_units}: {st.label}", (12, 28), CYAN, 0.65, 2)
    bar(canvas, 12, 42, PROC_W - 24, 16, st.progress, CYAN)
    put(canvas, f"Progreso global {100 * st.progress:.0f} %    Transcurrido {fmt_clock(st.elapsed_s)}    "
        f"{st.detail}", (12, 80), WHITE, 0.5)
    bx, by, bw, bh = 12, 100, 470, 352
    cv2.rectangle(canvas, (bx - 1, by - 1), (bx + bw, by + bh), DIM, 1)
    if st.preview is not None:
        small, s = fit_box(st.preview, bw, bh)
        draw_landmarks(small, None if st.P is None else np.asarray(st.P, dtype=float) * s)
        if st.P is None:
            put(small, "SIN CARA", (10, 26), RED, 0.7, 2)
        canvas[by:by + small.shape[0], bx:bx + small.shape[1]] = small
        ih, iw = st.preview.shape[:2]
        put(canvas, f"Cuadro que recibe el modelo: {iw}x{ih} px (ya degradado / rotado / con JPEG)",
            (bx, by + bh + 22), GRAY, 0.45)
    else:
        put(canvas, "esperando el primer cuadro...", (bx + 20, by + 40), GRAY, 0.5)
    tx = 500
    put(canvas, "Ultimas condiciones (modo VIDEO)", (tx, 108), WHITE, 0.5)
    cols = (tx, tx + 215, tx + 300, tx + 385)
    for c, name in zip(cols, ("Condicion", "Det %", "Iris OK %", "Lat med ms")):
        put(canvas, name, (c, 134), GRAY, 0.45)
    for i, r in enumerate(st.rows[-12:]):
        yy = 160 + 24 * i
        col = status_color(r.det_pct >= 95 and r.iris_pct >= 95)
        put(canvas, r.name[:22], (cols[0], yy), WHITE, 0.45)
        put(canvas, f"{r.det_pct:.1f}", (cols[1], yy), col, 0.45)
        put(canvas, f"{r.iris_pct:.1f}", (cols[2], yy), col, 0.45)
        put(canvas, f"{r.lat_ms:.1f}", (cols[3], yy), WHITE, 0.45)
    put(canvas, "Verde: deteccion e iris >= 95 %.   q/ESC aborta (no se escribe nada)   p pausa de vista",
        (12, PROC_H - 12), GRAY, 0.42)
    return canvas


# ---------------------------------------------------------------- panel final
def render_final(title: str, lines: Sequence[str], footer: str) -> np.ndarray:
    canvas = np.full((PROC_H, PROC_W, 3), BG, np.uint8)
    put(canvas, title, (16, 36), CYAN, 0.8, 2)
    cv2.line(canvas, (16, 48), (PROC_W - 16, 48), DIM, 1)
    for i, text in enumerate(lines[:19]):
        put(canvas, text, (20, 82 + 28 * i), line_color(text), 0.55)
    put(canvas, footer, (16, PROC_H - 14), YELLOW, 0.55)
    return canvas


def scale_canvas(canvas: np.ndarray, scale: float) -> np.ndarray:
    if abs(scale - 1.0) < 1e-9:
        return canvas
    return cv2.resize(canvas, None, fx=scale, fy=scale,
                      interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)


# ---------------------------------------------------------------- ventana
class LiveView:
    """Unica pieza que toca cv2.imshow. Si la GUI falla (sin entorno grafico) degrada a texto."""

    def __init__(self, scale: float = 1.0, hold_s: float = 0.0) -> None:
        self.scale = scale
        self.hold_s = hold_s
        self.mirror = False
        self.numbers = False
        self.paused = False
        self.dead = False
        self._last: np.ndarray | None = None
        self._frozen: np.ndarray | None = None

    @classmethod
    def open(cls, scale: float = 1.0, hold_s: float = 0.0) -> LiveView | None:
        try:
            cv2.namedWindow(WINDOW, cv2.WINDOW_AUTOSIZE)
            splash = np.full((120, 480, 3), BG, np.uint8)
            put(splash, "Iniciando vista en vivo...", (20, 66), WHITE, 0.7)
            cv2.imshow(WINDOW, splash)
            cv2.waitKey(1)
        except cv2.error as e:
            print(f"AVISO: sin entorno grafico para la ventana ({str(e).strip().splitlines()[0][:90]}). "
                  "Se continua sin vista (equivale a --no-view).")
            return None
        return cls(scale, hold_s)

    def _die(self, why: str) -> None:
        if not self.dead:
            print(f"AVISO: la ventana fallo ({why[:90]}). Se continua sin vista.")
        self.dead = True

    def _imshow(self, canvas: np.ndarray) -> None:
        try:
            cv2.imshow(WINDOW, scale_canvas(canvas, self.scale))
        except cv2.error as e:
            self._die(str(e).strip().splitlines()[0])

    def show(self, canvas: np.ndarray) -> None:
        if self.dead:
            return
        self._last = canvas
        if not self.paused:
            self._imshow(canvas)
        self.pump()

    def refresh(self) -> None:
        """Con la vista en pausa: repinta el cuadro congelado y atiende teclas."""
        if self.dead:
            return
        if self._frozen is not None:
            self._imshow(self._frozen)
        self.pump(15)

    def pump(self, wait_ms: int = 1) -> None:
        """Atiende teclas. Lanza ViewAbort con q/ESC o al cerrar la ventana."""
        if self.dead:
            return
        try:
            code = cv2.waitKey(wait_ms)
        except cv2.error as e:
            self._die(str(e).strip().splitlines()[0])
            return
        try:
            closed = cv2.getWindowProperty(WINDOW, cv2.WND_PROP_VISIBLE) < 0
        except cv2.error:
            closed = True
        act = key_action(code)
        if act == "quit":
            raise ViewAbort("tecla q/ESC")
        if act == "mirror":
            self.mirror = not self.mirror
        elif act == "numbers":
            self.numbers = not self.numbers
        elif act == "pause":
            self.paused = not self.paused
            if self.paused and self._last is not None:
                self._frozen = self._last.copy()
                put(self._frozen, "VISTA EN PAUSA (la captura sigue)  -  p para reanudar",
                    (12, self._frozen.shape[0] - 30), ORANGE, 0.6, 2)
        if closed:
            raise ViewAbort("ventana cerrada")

    def show_final(self, title: str, lines: Sequence[str]) -> None:
        """Panel de resumen: queda hasta una tecla o hold_s segundos (0 = solo tecla)."""
        if self.dead:
            return
        end = time.perf_counter() + self.hold_s if self.hold_s > 0 else None
        while True:
            left = None if end is None else end - time.perf_counter()
            footer = ("Presiona una tecla para cerrar" if left is None
                      else f"Se cierra en {max(0, math.ceil(left))} s (o presiona una tecla)")
            self._imshow(render_final(title, lines, footer))
            if self.dead:
                return
            try:
                code = cv2.waitKey(100)
                gone = cv2.getWindowProperty(WINDOW, cv2.WND_PROP_VISIBLE) < 0
            except cv2.error:
                return
            if code != -1 or gone or (left is not None and left <= 0):
                return

    def close(self) -> None:
        try:
            cv2.destroyWindow(WINDOW)
            cv2.waitKey(1)
        except cv2.error:
            pass


# ---------------------------------------------------------------- monitor de captura
# (P, matriz) o (P, matriz, puntajes de ceja (5,) | None)
InferFn = Callable[[np.ndarray, int], "tuple[object, ...]"]


class LiveMonitor:
    """Landmarker de VISUALIZACION (separado del de captura) + gate + metricas + HUD.
    Se llama DESPUES de guardar el cuadro; nunca lo modifica. Si la inferencia tarda mas de
    slow_ms no se dibujan landmarks en ese cuadro (la captura sigue)."""

    def __init__(self, view: LiveView | None, infer: InferFn, gp: sm.GateParams, mode: str,
                 capture_mirror: bool = False, slow_ms: float = SLOW_INFER_MS,
                 close_fn: Callable[[], None] | None = None, brow_view: bool = False,
                 brow_numbers: bool = False, bp: sm.BrowParams = sm.BrowParams()) -> None:
        self.brow_view, self.brow_numbers, self.bp = brow_view, brow_numbers, bp
        self.brow: BrowLive | None = None
        self.view, self.infer, self.mode = view, infer, mode
        self.capture_mirror, self.slow_ms, self.close_fn = capture_mirror, slow_ms, close_fn
        self.gate = LiveGate(gp)
        self.trace = EarTrace()
        self.block: tuple[int, int] | None = None
        self.times: deque[float] = deque(maxlen=30)
        self.t0 = time.perf_counter()
        self._last_ts = -1
        self.status: GateStatus | None = None
        self.metrics: LiveMetrics | None = None
        self.infer_ms = 0.0
        self.last_hud = CaptureHud()
        self._rec: list[bool] | None = None
        self._tally: FailTally | None = None
        self.last_fail = FailTally()

    def start_recording(self) -> None:
        """Empieza a contar el gate en verde/rojo por cuadro (ventanas de 1 s deslizantes)."""
        self._rec = []
        self._tally = FailTally()

    def stop_recording(self) -> float | None:
        """% de muestras del gate en verde desde start_recording; None si no hubo ventanas
        completas (calentando). Descarta la lista (solo booleanos, nunca imagenes)."""
        rec, self._rec = self._rec, None
        if self._tally is not None:
            self.last_fail = self._tally
        self._tally = None
        return quiet_pct(rec or [])

    def set_block(self, k: int, n: int) -> None:
        self.block = (k, n)

    def quiet(self) -> bool | None:
        return None if self.status is None else self.status.quiet

    def fps(self) -> float:
        if len(self.times) < 2 or self.times[-1] <= self.times[0]:
            return 0.0
        return (len(self.times) - 1) / (self.times[-1] - self.times[0])

    def eta(self, frames_left: int) -> float | None:
        f = self.fps()
        return frames_left / f if f > 0 else None

    def feed(self, frame: np.ndarray, phase: str, progress: float | None = None,
             remaining_s: float | None = None, raw: bool = False, note: str = "",
             now: float | None = None) -> np.ndarray | None:
        """Procesa un cuadro ya capturado y actualiza la ventana. raw=True: cuadro tal como lo
        entrega la camara (se aplica el espejo de captura para que coincida con lo guardado)."""
        if self.view is not None and self.view.paused:
            self.view.refresh()
            return None
        now = time.perf_counter() if now is None else now
        self.times.append(now)
        if raw and self.capture_mirror:
            frame = cv2.flip(frame, 1)
        ts_ms = max(self._last_ts + 1, int((now - self.t0) * 1000))
        self._last_ts = ts_ms
        t1 = time.perf_counter()
        res = self.infer(frame, ts_ms)
        P, mat = res[0], res[1]
        blend = res[2] if len(res) > 2 else None   # (5,) puntajes de ceja o None
        self.infer_ms = (time.perf_counter() - t1) * 1000.0
        slow = self.infer_ms > self.slow_ms
        self.gate.push(P, mat, now)
        self.status = self.gate.status()
        if self._rec is not None and self.status is not None:
            self._rec.append(self.status.quiet)
            if self._tally is not None:
                self._tally.add(self.status.failed)
        self.metrics = live_metrics(P)
        m = self.metrics
        self.trace.push(now, None if m is None else (m.ear_r + m.ear_l) / 2)
        self.brow = live_brow(P, mat, blend, self.bp) if self.brow_view else None
        numbers = self.brow_numbers or (self.view.numbers if self.view else False)
        hud = CaptureHud(self.mode, phase, progress, remaining_s, (frame.shape[1], frame.shape[0]),
                         self.fps(), self.block, self.status, m, list(self.trace.samples),
                         self.trace.threshold, now, self.trace.flashing(now), self.trace.blinks, note,
                         self.infer_ms, slow, False, self.brow_view, self.brow, numbers)
        self.last_hud = hud
        canvas = render_capture(frame, P, hud, self.view.mirror if self.view else False, not slow)
        if self.view is not None:
            self.view.show(canvas)
        return canvas

    def close(self) -> None:
        if self.close_fn is not None:
            self.close_fn()
            self.close_fn = None


class ProcessPanel:
    """Ventana de la fase offline: condicion actual, vista previa con landmarks, tabla y tiempo."""

    def __init__(self, view: LiveView | None, title: str, n_units: int, max_hz: float = 8.0) -> None:
        self.view, self.title, self.n_units = view, title, n_units
        self.rows: deque[RowStat] = deque(maxlen=12)
        self.t0 = time.perf_counter()
        self._last = 0.0
        self._min_dt = 1.0 / max_hz

    def update(self, unit: int, label: str, frac: float, img: np.ndarray | None = None,
               P: np.ndarray | None = None, detail: str = "", force: bool = False) -> None:
        if self.view is None or self.view.dead:
            return
        now = time.perf_counter()
        if not force and now - self._last < self._min_dt:
            self.view.pump()  # teclas siempre atendidas
            return
        self._last = now
        st = ProcState(self.title, label, unit, self.n_units, min(1.0, (unit - 1 + frac) / self.n_units),
                       img, P, list(self.rows), now - self.t0, detail)
        self.view.show(render_processing(st))

    def add_row(self, name: str, det_pct: float, iris_pct: float, lat_ms: float) -> None:
        self.rows.append(RowStat(name, det_pct, iris_pct, lat_ms))

    def frame_cb(self, unit: int, label: str) -> Callable[[int, int, np.ndarray, np.ndarray | None], None]:
        def cb(i: int, n: int, img: np.ndarray, p: np.ndarray | None) -> None:
            self.update(unit, label, (i + 1) / n, img, p, detail=f"cuadro {i + 1}/{n}")
        return cb


# ---------------------------------------------------------------- smoke (sin ventana)
def smoke_viewer() -> None:
    """Renderiza cada panel a imagen en memoria, con y sin cara. No abre ventana."""
    rng = np.random.default_rng(0)
    frame = rng.integers(0, 255, (480, 640, 3), dtype=np.uint8)
    before = frame.copy()
    P = sm.make_synthetic_landmarks(1, noise_px=0.0)[0]
    face_infer: InferFn = lambda f, ts: (P + 0.0, np.eye(4))  # noqa: E731
    none_infer: InferFn = lambda f, ts: (None, None)  # noqa: E731
    out: dict[str, np.ndarray] = {}
    for label, infer in (("con cara", face_infer), ("sin cara", none_infer)):
        mon = LiveMonitor(None, infer, sm.GateParams(), "SMOKE")
        c: np.ndarray | None = None
        for i in range(45):
            c = mon.feed(frame, "GRABANDO", i / 45, 1.5, now=i / 30.0)
        assert c is not None and c.ndim == 3 and c.dtype == np.uint8
        assert mon.quiet() is (label == "con cara"), (label, mon.status)
        out[f"captura {label}"] = c
        out[f"captura {label} espejo"] = render_capture(frame, P if label == "con cara" else None,
                                                        mon.last_hud, mirror=True)
        out[f"proceso {label}"] = render_processing(ProcState(
            "SMOKE", "REF", 3, 40, 0.1, frame, P if label == "con cara" else None,
            [RowStat(f"cond{i}", 99.0, 98.0, 12.3) for i in range(14)], 75.0, "cuadro 5/240"))
    mon_r = LiveMonitor(None, face_infer, sm.GateParams(), "SMOKE")
    for i in range(40):  # calienta el gate
        mon_r.feed(frame, "ESPERANDO QUIETUD", now=i / 30.0)
    mon_r.start_recording()
    for i in range(40, 70):
        mon_r.feed(frame, "GRABANDO", now=i / 30.0)
    assert mon_r.stop_recording() == 100.0 and mon_r.stop_recording() is None
    assert quiet_pct([True, False, True, True]) == 75.0 and quiet_pct([]) is None
    out["final"] = render_final("RESUMEN", ["REF VIDEO: CUMPLE", "REF IMAGE: NO CUMPLE", "! aviso"], "tecla")
    # revision de cejas: polilineas, numeracion y bloque CEJA (infer con 3 elementos: P, matriz, puntajes)
    brow_infer: InferFn = lambda f, ts: (P + 0.0, np.eye(4), np.array([0.0, 0.0, 0.6, 0.0, 0.0]))  # noqa: E731
    mon_b = LiveMonitor(None, brow_infer, sm.GateParams(), "SMOKE", brow_view=True, brow_numbers=True)
    cb = mon_b.feed(frame, "REVISION CEJA", now=0.0)
    assert cb is not None and cb.shape[0] > out["captura con cara"].shape[0] and mon_b.brow is not None
    assert mon_b.brow.active and abs(mon_b.brow.ptb_inf_r - 40.0 / 22.0) < 1e-6, mon_b.brow
    out["revision de cejas"] = cb
    assert np.array_equal(frame, before), "la vista modifico el cuadro de captura"
    assert not np.array_equal(out["captura con cara"], out["captura sin cara"])
    print("Smoke vista OK: " + ", ".join(f"{k} {v.shape[1]}x{v.shape[0]}" for k, v in out.items()))
