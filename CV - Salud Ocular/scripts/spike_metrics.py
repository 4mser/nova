"""Metricas puras (solo numpy) del spike de Face Landmarker v2.

Convenciones:
- P es un arreglo (T, 478, 2) con landmarks en PIXELES del cuadro que entra al modelo.
  Los cuadros sin cara o sin iris valido son filas NaN.
- Ojo R: comisuras 33/133. Ojo L: comisuras 362/263. e_x va de la primera a la segunda
  comisura (en una cara vertical apunta a +x de la imagen), e_y = e_x rotado 90 grados
  (en imagen con y hacia abajo apunta hacia abajo: un parpado inferior da valores positivos).
- Todo esto es PROPUESTA de metodo, no validacion clinica.
"""
from __future__ import annotations

import math
import warnings
from dataclasses import dataclass
from typing import Mapping, Sequence

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

N_LANDMARKS = 478
IRIS_IDX = tuple(range(468, 478))
IRIS_CENTER_CANDIDATES = (468, 473)
IRIS_DIAMETER_PAIRS = ((469, 471), (470, 472), (474, 476), (475, 477))
RIGID_IDX = (33, 133, 362, 263, 168, 6, 197, 195, 5, 4, 1, 10, 151, 9, 8)
# --- puntos RIGIDOS del gate de quietud (MediaPipe Face Mesh, malla canonica de 468 + 10 de iris).
# Ninguno pertenece a parpados ni comisuras: el parpadeo no los mueve. Solo la geometria.
#  1, 4, 5   punta y base de la nariz (cartilago/tejido sobre hueso, casi sin expresion)
#  6, 168    puente nasal alto, entre los ojos (hueso nasal)
#  197, 195  puente nasal bajo (hueso/cartilago)
#  10, 151   frente alta y media (hueso frontal)
#  9, 8      entrecejo (sube un poco con las cejas: peso 2 de 11, supuesto aceptable)
# 234, 454 son los extremos de las mejillas (borde del ovalo facial, ver FACE_OVAL en el visor):
# dan el ANCHO de cara (escala) y la linea para el roll. Todos < 468: existen en la malla de
# 478 puntos como puntos de cara, no de iris (se verifica al importar, abajo).
FACE_MIDLINE_IDX = (1, 4, 5, 6, 168, 197, 195, 10, 151, 9, 8)
FACE_CHEEK_IDX = (234, 454)
# [SUPUESTO] distancia entre los puntos medios de las comisuras (IOD) ~ 0,4 x ancho de cara
# (234-454). Se usa para que los umbrales del gate (hoy en % de IOD) conserven su significado:
# escala_gate = 0,4 x ancho(234-454), expresada en "IOD equivalente". Sin medir en esta camara.
IOD_PER_FACE_WIDTH = 0.4
GATE_BLINK_FRAC = 0.75   # parpadeo para el gate: EAR < 0,75 x mediana abierta
GATE_BLINK_PAD = 3       # +- cuadros alrededor
GATE_BLINK_MAX_GAP = 8   # cuadros sin cara pegados a un parpadeo que tampoco cuentan como perdida
assert max(FACE_MIDLINE_IDX + FACE_CHEEK_IDX) < N_LANDMARKS - len(IRIS_IDX)
assert len(set(FACE_MIDLINE_IDX + FACE_CHEEK_IDX)) == len(FACE_MIDLINE_IDX) + 2
IRIS_DIAMETER_MM = 11.7  # [INF] valor del blog de Google, sin paper de origen
MAD_TO_SIGMA = 1.4826
# sigma(x - mediana_movil_7) / sigma(x) para ruido blanco gaussiano (simulacion, 4e5 muestras)
K_MED7 = 0.822
BLINK_FRAC = 0.6        # parpadeo: EAR < BLINK_FRAC x mediana abierta
BLINK_MIN_FRAMES = 2    # durante al menos estos cuadros


@dataclass(frozen=True)
class Eye:
    corner_a: int
    corner_b: int
    upper: tuple[int, int, int]
    lower: tuple[int, int, int]
    mid_upper: int
    mid_lower: int
    ear_pairs: tuple[tuple[int, int], tuple[int, int]]


EYES: dict[str, Eye] = {
    "R": Eye(33, 133, (160, 159, 158), (144, 145, 153), 159, 145, ((160, 144), (158, 153))),
    "L": Eye(362, 263, (385, 386, 387), (380, 374, 373), 386, 374, ((385, 380), (387, 373))),
}
LID_IDX = tuple(sorted({i for e in EYES.values() for i in (*e.upper, *e.lower)}))
MESH_IDX = tuple(i for i in range(N_LANDMARKS) if i not in IRIS_IDX and i not in LID_IDX)
SERIES_EYE = ("ear", "A", "mrd2n", "mrd1n", "u", "v")  # una serie por ojo (sufijo _R/_L)
SERIES_SINGLE = ("d_iod",)


# ---------------------------------------------------------------- geometria basica
def finite_mask(P: np.ndarray) -> np.ndarray:
    return np.isfinite(P).all(axis=(1, 2))


def assign_iris(P: np.ndarray) -> dict[str, int]:
    """Asigna 468/473 a cada ojo por cercania al punto medio de sus comisuras (mediana
    de la sesion). Falla si ambos ojos eligen el mismo centro."""
    ok = finite_mask(P)
    if ok.sum() == 0:
        raise ValueError("sin cuadros validos para asignar el iris")
    dist: dict[str, list[float]] = {}
    for name, eye in EYES.items():
        m = (P[ok, eye.corner_a] + P[ok, eye.corner_b]) / 2
        dist[name] = [float(np.median(np.linalg.norm(P[ok, c] - m, axis=1)))
                      for c in IRIS_CENTER_CANDIDATES]
    pick = {n: IRIS_CENTER_CANDIDATES[int(np.argmin(d))] for n, d in dist.items()}
    if pick["R"] == pick["L"]:
        raise ValueError(f"asignacion de iris ambigua: distancias {dist}")
    return pick


def eye_geometry(P: np.ndarray, eye: Eye, iris_idx: int) -> dict[str, np.ndarray]:
    """m (T,2), w (T), ex (T,2), ey (T,2), c (T,2) centro del iris."""
    a, b = P[:, eye.corner_a], P[:, eye.corner_b]
    m = (a + b) / 2
    vec = b - a
    w = np.linalg.norm(vec, axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        ex = vec / w[:, None]
    ey = np.stack([-ex[:, 1], ex[:, 0]], axis=1)
    return {"m": m, "w": w, "ex": ex, "ey": ey, "c": P[:, iris_idx]}


def iris_diameter(P: np.ndarray) -> np.ndarray:
    return np.mean([np.linalg.norm(P[:, a] - P[:, b], axis=1) for a, b in IRIS_DIAMETER_PAIRS],
                   axis=0)


def roll_deg(m_r: np.ndarray, m_l: np.ndarray) -> np.ndarray:
    """Inclinacion de la linea de los ojos, atan2(m_L - m_R) en (-90, 90] grados.
    Imagen con y hacia abajo: positivo = la linea baja hacia la derecha (horario en pantalla)."""
    d = m_l - m_r
    ang = np.degrees(np.arctan2(d[:, 1], d[:, 0]))
    return ((ang + 90.0) % 180.0) - 90.0


def wrap180(a: np.ndarray) -> np.ndarray:
    return ((a + 90.0) % 180.0) - 90.0


# ---------------------------------------------------------------- Procrustes
def similarity_fit(src: np.ndarray, dst: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Similitud 2D (rotacion+escala+traslacion) z' = a z + b por minimos cuadrados.
    src (T,k,2), dst (k,2) o (T,k,2). Devuelve a (T,), b (T,) complejos."""
    zs = src[..., 0] + 1j * src[..., 1]
    zd = dst[..., 0] + 1j * dst[..., 1]
    zd = np.broadcast_to(zd, zs.shape)
    ms, md = zs.mean(axis=1, keepdims=True), zd.mean(axis=1, keepdims=True)
    zsc, zdc = zs - ms, zd - md
    a = (np.conj(zsc) * zdc).sum(axis=1) / (np.abs(zsc) ** 2).sum(axis=1)
    b = md[:, 0] - a * ms[:, 0]
    return a, b


def apply_similarity(P: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    z = P[..., 0] + 1j * P[..., 1]
    z2 = a[:, None] * z + b[:, None]
    return np.stack([z2.real, z2.imag], axis=-1)


def procrustes_residuals(P: np.ndarray, iterations: int = 4) -> dict[str, np.ndarray | float]:
    """Alinea cada cuadro por similitud usando los puntos rigidos contra la media de la
    sesion (Procrustes generalizado), aplica la transformacion a los 478 puntos y mide el
    residuo contra la media. Devuelve RMS por punto y por cuadro en % de IOD.

    P: (T,478,2) solo con cuadros validos (sin NaN)."""
    if len(P) < 3:
        raise ValueError("Procrustes requiere al menos 3 cuadros validos")
    rigid = list(RIGID_IDX)
    ref = P[0, rigid]
    mean_all = P[0]
    aligned = P
    for _ in range(iterations):
        a, b = similarity_fit(P[:, rigid], ref)
        aligned = apply_similarity(P, a, b)
        mean_all = aligned.mean(axis=0)
        ref = mean_all[rigid]
    res = aligned - mean_all[None]                       # (T,478,2)
    iod = float(np.linalg.norm((mean_all[33] + mean_all[133]) / 2
                               - (mean_all[362] + mean_all[263]) / 2))
    sq = (res ** 2).sum(axis=2)                          # (T,478)
    rms_point = 100.0 * np.sqrt(sq.mean(axis=0)) / iod
    groups = {"iris": IRIS_IDX, "lids": LID_IDX, "mesh": MESH_IDX}
    out: dict[str, np.ndarray | float] = {"rms_point": rms_point, "iod_ref": iod}
    for g, idx in groups.items():
        out[f"rms_{g}"] = float(np.sqrt((rms_point[list(idx)] ** 2).mean()))
        out[f"frame_{g}"] = 100.0 * np.sqrt(sq[:, list(idx)].mean(axis=1)) / iod
    return out


# ---------------------------------------------------------------- ruido
def mad(x: np.ndarray) -> float:
    x = x[np.isfinite(x)]
    if x.size == 0:
        return float("nan")
    return float(np.median(np.abs(x - np.median(x))))


def sigma_robust(x: np.ndarray) -> float:
    return MAD_TO_SIGMA * mad(x)


def sigma_hf(x: np.ndarray) -> float:
    """Ruido de alta frecuencia: 1,4826 * MAD(diferencias entre cuadros consecutivos) / sqrt(2)."""
    return MAD_TO_SIGMA * mad(np.diff(x)) / math.sqrt(2.0)


def rolling_median(x: np.ndarray, k: int = 7) -> np.ndarray:
    """Mediana movil centrada; NaN si la ventana tiene algun NaN o cae fuera de la serie."""
    half = k // 2
    pad = np.concatenate([np.full(half, np.nan), x, np.full(half, np.nan)])
    win = sliding_window_view(pad, k)
    out = np.full(len(x), np.nan)
    good = np.isfinite(win).all(axis=1)
    out[good] = np.median(win[good], axis=1)
    return out


def sigma_med7(x: np.ndarray) -> float:
    """Validacion independiente de sigma_hf: residuo tras mediana movil de 7 cuadros,
    corregido por K_MED7 (ruido blanco)."""
    return sigma_robust(x - rolling_median(x, 7)) / K_MED7


def block_means(x: np.ndarray, usable: np.ndarray, width: int, min_frac: float = 0.5) -> np.ndarray:
    """Medias de bloques consecutivos de `width` cuadros usando solo cuadros utilizables.
    Se descarta el bloque con menos de min_frac*width cuadros utilizables."""
    out = []
    for s in range(0, len(x) - width + 1, width):
        seg, ok = x[s:s + width], usable[s:s + width] & np.isfinite(x[s:s + width])
        if ok.sum() >= max(1, math.ceil(min_frac * width)):
            out.append(float(seg[ok].mean()))
    return np.asarray(out)


def mdc95(sigma: float) -> float:
    return 1.96 * math.sqrt(2.0) * sigma


def paired_bias(x: np.ndarray, ref: np.ndarray) -> tuple[float, int]:
    """Mediana de la diferencia x - ref en cuadros donde ambos son finitos."""
    ok = np.isfinite(x) & np.isfinite(ref)
    if not ok.any():
        return float("nan"), 0
    return float(np.median(x[ok] - ref[ok])), int(ok.sum())


# ---------------------------------------------------------------- parpadeo y PERCLOS
def open_baseline(x: np.ndarray, frac: float = 0.75) -> float:
    """Mediana de la serie sobre cuadros 'abiertos' (>= frac * mediana global)."""
    g = np.nanmedian(x)
    return float(np.nanmedian(x[x >= frac * g]))


def runs_below(mask: np.ndarray, min_len: int) -> np.ndarray:
    """Marca los tramos consecutivos True de longitud >= min_len."""
    out = np.zeros(len(mask), dtype=bool)
    i = 0
    while i < len(mask):
        if mask[i]:
            j = i
            while j < len(mask) and mask[j]:
                j += 1
            if j - i >= min_len:
                out[i:j] = True
            i = j
        else:
            i += 1
    return out


def detect_blinks(ear: np.ndarray, frac: float = BLINK_FRAC, min_frames: int = BLINK_MIN_FRAMES) -> tuple[np.ndarray, int, float]:
    """Parpadeo: EAR < frac * mediana(EAR abierto) durante >= min_frames cuadros.
    Devuelve (mascara, n_parpadeos, linea base)."""
    base = open_baseline(ear)
    below = np.isfinite(ear) & (ear < frac * base)
    mask = runs_below(below, min_frames)
    n = int(np.sum(np.diff(np.concatenate([[False], mask]).astype(int)) == 1))
    return mask, n, base


def blink_exclusion(ear: np.ndarray, frac: float = 0.75, pad: int = 3) -> np.ndarray:
    """Cuadros a excluir del suelo de ruido: EAR < frac*mediana y +-pad cuadros."""
    base = open_baseline(ear)
    low = np.isfinite(ear) & (ear < frac * base)
    k = 2 * pad + 1
    return np.convolve(low.astype(float), np.ones(k), mode="same") > 0


def perclos(a: np.ndarray, fs: float, a_open: float, frac: float = 0.2,
            window_s: float = 60.0) -> tuple[float, list[float]]:
    """PERCLOS P80: fraccion de cuadros validos con A < frac*A_abierto. Devuelve
    (global, lista por ventanas completas de window_s segundos sin traslape)."""
    closed = a < frac * a_open
    ok = np.isfinite(a)
    overall = float(closed[ok].mean()) if ok.any() else float("nan")
    w = int(round(window_s * fs))
    wins = []
    if w > 0:
        for s in range(0, len(a) - w + 1, w):
            o = ok[s:s + w]
            wins.append(float(closed[s:s + w][o].mean()) if o.any() else float("nan"))
    return overall, wins


# ---------------------------------------------------------------- orientacion (matriz)
def euler_yxz(M: np.ndarray) -> tuple[float, float, float]:
    """(yaw, pitch, roll) en grados de la matriz 4x4 facial_transformation_matrix.

    Convencion: R = Ry(yaw) Rx(pitch) Rz(roll) (Euler intrinseco Y-X-Z), con R = bloque 3x3
    normalizado por columnas (se quita la escala). Matriz canonica->camara de MediaPipe:
    x a la derecha, y arriba, z hacia el observador. El gate solo usa RANGOS, asi que el
    signo no importa. Yaw y roll pueden saltar +-180 grados (atan2): los rangos se calculan
    con wrap360 (ver circular_ptp). Devuelve NaN si M no es una matriz >= 3x3 finita."""
    A = np.asarray(M, dtype=np.float64)
    if A.ndim != 2 or A.shape[0] < 3 or A.shape[1] < 3 or not np.isfinite(A[:3, :3]).all():
        return math.nan, math.nan, math.nan
    R = A[:3, :3]
    norms = np.linalg.norm(R, axis=0, keepdims=True)
    if (norms < 1e-9).any():
        return math.nan, math.nan, math.nan
    R = R / norms
    pitch = math.asin(max(-1.0, min(1.0, -R[1, 2])))
    yaw = math.atan2(R[0, 2], R[2, 2])
    roll = math.atan2(R[1, 0], R[1, 1])
    return math.degrees(yaw), math.degrees(pitch), math.degrees(roll)


def wrap360(a: np.ndarray) -> np.ndarray:
    """Envuelve angulos a [-180, 180)."""
    return ((a + 180.0) % 360.0) - 180.0


def circular_ptp(w: np.ndarray) -> np.ndarray:
    """Rango (max - min) por fila de angulos en grados con periodo 360, relativo al primer
    valor de la ventana: un cruce de +-180 no infla el rango."""
    return np.ptp(wrap360(w - w[:, :1]), axis=1)


# ---------------------------------------------------------------- gate de quietud
@dataclass(frozen=True)
class GateParams:
    """Umbrales PROPUESTOS (configurables por flags). legacy=True usa los criterios antiguos
    (puntos medios de las comisuras, IOD de comisuras, sin mascara de parpadeo)."""
    window_s: float = 1.0
    speed_pct: float = 0.5      # % de IOD(-equivalente) por cuadro, sobre |delta| de la posicion
    speed_quantile: float = 0.5  # estadistico de la ventana (mediana: robusta al jitter del modelo)
    roll_deg: float = 2.0
    iod_pct: float = 2.0
    angle_deg: float = 3.0      # yaw y pitch
    legacy: bool = False


CRITERIA = ("speed", "roll", "iod", "yaw", "pitch", "face_loss")
CRITERION_LABELS = {"speed": "velocidad", "roll": "roll", "iod": "IOD", "yaw": "yaw",
                    "pitch": "pitch", "face_loss": "perdida de cara"}


def fail_summary(fail_pct: Mapping[str, float], prefix: str = "criterios que fallaron",
                 min_pct: float = 0.5) -> str:
    """'criterios que fallaron: IOD 70 %, roll 35 %' (mayor primero). Vacio si ninguno falla."""
    items = sorted(((k, v) for k, v in fail_pct.items() if k in CRITERION_LABELS
                    and v is not None and math.isfinite(v) and v >= min_pct),
                   key=lambda kv: -kv[1])
    if not items:
        return ""
    return f"{prefix}: " + ", ".join(f"{CRITERION_LABELS[k]} {v:.0f} %" for k, v in items)


def ear_frames(P: np.ndarray) -> np.ndarray:
    """EAR medio de los dos ojos por cuadro, (T,478,2) -> (T,). NaN si el cuadro no es finito."""
    out = []
    for eye in EYES.values():
        w = np.linalg.norm(P[:, eye.corner_b] - P[:, eye.corner_a], axis=1)
        num = sum(np.linalg.norm(P[:, a] - P[:, b], axis=1) for a, b in eye.ear_pairs)
        with np.errstate(invalid="ignore", divide="ignore"):
            out.append(num / (2 * w))
    return (out[0] + out[1]) / 2


def gate_inputs(P: np.ndarray, legacy: bool = False) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(posicion (T,2), escala (T,), roll (T,) en grados) que consume el gate, de P (T,478,2).
    Nuevo: posicion = media de los puntos rigidos de la linea media, escala = 0,4 x ancho
    234-454 (IOD equivalente), roll = angulo de la linea 234->454. legacy: punto medio entre los
    puntos medios de las comisuras, IOD de comisuras y roll de la linea de los ojos."""
    if legacy:
        m_r = (P[:, 33] + P[:, 133]) / 2
        m_l = (P[:, 362] + P[:, 263]) / 2
        return (m_r + m_l) / 2, np.linalg.norm(m_r - m_l, axis=1), roll_deg(m_r, m_l)
    d = P[:, FACE_CHEEK_IDX[1]] - P[:, FACE_CHEEK_IDX[0]]
    ang = wrap180(np.degrees(np.arctan2(d[:, 1], d[:, 0])))
    return P[:, list(FACE_MIDLINE_IDX)].mean(axis=1), IOD_PER_FACE_WIDTH * np.linalg.norm(d, axis=1), ang


def gate_blink_mask(ear: np.ndarray, frac: float = GATE_BLINK_FRAC, pad: int = GATE_BLINK_PAD,
                    max_gap: int = GATE_BLINK_MAX_GAP) -> np.ndarray:
    """Cuadros de parpadeo para el gate: EAR < frac x mediana de abiertos, +- pad cuadros. Los
    tramos cortos (<= max_gap) sin EAR (ojo cerrado: iris no valido) pegados a un cuadro bajo
    tambien cuentan como parpadeo, para no confundirlos con perdida de cara."""
    n = len(ear)
    fin = np.isfinite(ear)
    if fin.sum() < MIN_BLINK_BASE:
        return np.zeros(n, dtype=bool)
    base = open_baseline(ear)
    low = fin & (ear < frac * base)
    core = low.copy()
    i = 0
    while i < n:
        if fin[i]:
            i += 1
            continue
        j = i
        while j < n and not fin[j]:
            j += 1
        if j - i <= max_gap and ((i > 0 and low[i - 1]) or (j < n and low[j])):
            core[i:j] = True
        i = j
    return np.convolve(core.astype(float), np.ones(2 * pad + 1), mode="same") > 0


MIN_BLINK_BASE = 10


def _first_finite(x: np.ndarray) -> np.ndarray:
    return x[np.arange(len(x)), np.argmax(np.isfinite(x), axis=1)]


def _nan_ptp(x: np.ndarray) -> np.ndarray:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmax(x, axis=1) - np.nanmin(x, axis=1)


def _angle_ptp(win_angles: np.ndarray, period: float) -> np.ndarray:
    """Rango por fila de angulos con periodo `period`, relativo al primer valor finito de la fila."""
    rel = ((win_angles - _first_finite(win_angles)[:, None] + period / 2) % period) - period / 2
    return _nan_ptp(rel)


def gate_window_values(pos: np.ndarray, scale: np.ndarray, roll: np.ndarray,
                       yaw: np.ndarray | None, pitch: np.ndarray | None, valid: np.ndarray,
                       fs: float, gp: GateParams, blink: np.ndarray | None = None
                       ) -> dict[str, np.ndarray]:
    """Valor de cada criterio en cada ventana deslizante (una por cuadro de inicio):
    speed (% de la escala por cuadro, cuantil gp.speed_quantile de la ventana; velocidad de pos),
    roll/yaw/pitch (rango, grados), iod (rango de la escala, % de la media),
    face_loss (% de cuadros de la ventana sin cara/iris valido).

    blink (bool por cuadro): cuadros de parpadeo. Se EXCLUYEN de velocidad y rangos y no cuentan
    como perdida de cara. Una ventana con menos de 1/3 de cuadros utilizables da NaN (falla).
    yaw/pitch = NaN sin matriz. Arreglo vacio si hay menos cuadros que la ventana."""
    t = len(valid)
    w = max(3, int(round(gp.window_s * fs)))
    n_win = max(0, t - w + 1)
    out = {k: np.full(n_win, np.nan) for k in CRITERIA}
    if n_win == 0:
        return out
    blink = np.zeros(t, dtype=bool) if blink is None else np.asarray(blink, dtype=bool)
    lost = ~valid & ~blink          # perdida de cara real
    keep = valid & ~blink           # cuadros que alimentan velocidad y rangos
    win = lambda x: sliding_window_view(x, w)  # noqa: E731
    enough = win(keep).sum(axis=1) >= max(3, w // 3)
    with np.errstate(invalid="ignore", divide="ignore"):
        step = np.full(t, np.nan)
        step[1:] = 100.0 * np.linalg.norm(np.diff(pos, axis=0), axis=1) / scale[1:]
        pair_lost = lost[1:] | lost[:-1]
        pair_skip = (blink[1:] | blink[:-1]) & ~pair_lost
        speed = np.full(t, np.nan)
        speed[1:] = np.where(pair_lost, 1e9, np.where(pair_skip, np.nan, step[1:]))
        speed[1:] = np.where(np.isnan(speed[1:]) & ~pair_skip, 1e9, speed[1:])
        sw = win(speed)[:, 1:]  # w-1 diferencias dentro de la ventana
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            out["speed"] = np.nanquantile(sw, gp.speed_quantile, axis=1)
        out["roll"] = _angle_ptp(win(np.where(keep, roll, np.nan)), 180.0)
        sc = win(np.where(keep, scale, np.nan))
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            out["iod"] = 100.0 * _nan_ptp(sc) / np.nanmean(sc, axis=1)
        for name, ang in (("yaw", yaw), ("pitch", pitch)):
            if ang is not None:
                res = _angle_ptp(win(np.where(keep, ang, np.nan)), 360.0)
                res[win(keep & ~np.isfinite(ang)).any(axis=1)] = np.nan  # matriz parcial: falla
                out[name] = res
        out["face_loss"] = 100.0 * win(lost.astype(float)).mean(axis=1)
    for k in ("speed", "roll", "iod", "yaw", "pitch"):
        out[k] = np.where(enough, out[k], np.nan)
    return out


def window_pass(vals: dict[str, np.ndarray], gp: GateParams) -> dict[str, np.ndarray]:
    """Booleano por criterio y ventana. Sin matriz (yaw/pitch todo NaN) esos criterios se
    omiten (pasan); con matriz parcial, una ventana con NaN falla."""
    thr = {"speed": gp.speed_pct, "roll": gp.roll_deg, "iod": gp.iod_pct,
           "yaw": gp.angle_deg, "pitch": gp.angle_deg}
    res: dict[str, np.ndarray] = {}
    for k in CRITERIA:
        v = vals[k]
        if k == "face_loss":
            res[k] = v == 0.0
        elif k in ("yaw", "pitch") and not np.isfinite(v).any():
            res[k] = np.ones(len(v), dtype=bool)
        else:
            with np.errstate(invalid="ignore"):
                res[k] = v < thr[k]
    return res


def quiet_gate(pos: np.ndarray, scale: np.ndarray, roll: np.ndarray,
               yaw: np.ndarray | None, pitch: np.ndarray | None, valid: np.ndarray,
               fs: float, gp: GateParams, blink: np.ndarray | None = None) -> np.ndarray:
    """Un cuadro pasa si pertenece a alguna ventana de ~1 s que cumple todo: sin perdida de
    cara, velocidad de la posicion (cuantil gp.speed_quantile de la ventana) < speed_pct de la
    escala por cuadro, rango de roll < roll_deg, rango de escala < iod_pct, rango de yaw/pitch
    < angle_deg. Sin matriz (yaw/pitch None) esas dos condiciones se omiten. Los cuadros en
    `blink` no cuentan (ver gate_window_values)."""
    t = len(valid)
    w = max(3, int(round(gp.window_s * fs)))
    gate = np.zeros(t, dtype=bool)
    if t < w:
        return gate
    vals = gate_window_values(pos, scale, roll, yaw, pitch, valid, fs, gp, blink)
    passed = np.logical_and.reduce(list(window_pass(vals, gp).values()))
    cover = np.zeros(t + 1)
    starts = np.flatnonzero(passed)
    np.add.at(cover, starts, 1)
    np.add.at(cover, starts + w, -1)
    gate[:] = np.cumsum(cover)[:t] > 0
    return gate


def diagnose_windows(vals: dict[str, np.ndarray], gp: GateParams, mat_pct: float
                     ) -> dict[str, object]:
    """Resumen del gate por criterio: distribucion (mediana, p80, p95, max) sobre las
    ventanas con valor finito, % de ventanas aprobadas con el umbral actual, % que pasan
    TODOS, % que pasarian si se quitara solo ese criterio, propuesta de umbral = p80 y cuello
    de botella (criterio con menos ventanas aprobadas; empate: el que mas sube el % total
    al quitarlo)."""
    passes = window_pass(vals, gp)
    n_win = len(vals["speed"])
    thr = {"speed": gp.speed_pct, "roll": gp.roll_deg, "iod": gp.iod_pct,
           "yaw": gp.angle_deg, "pitch": gp.angle_deg, "face_loss": 0.0}
    all_ok = np.logical_and.reduce(list(passes.values())) if n_win else np.zeros(0, bool)
    crit: dict[str, dict[str, float]] = {}
    for k in CRITERIA:
        v = vals[k][np.isfinite(vals[k])]
        others = [passes[o] for o in CRITERIA if o != k]
        without = np.logical_and.reduce(others) if n_win else np.zeros(0, bool)
        crit[k] = {
            "n_finite": float(len(v)),
            "median": float(np.median(v)) if len(v) else math.nan,
            "p80": float(np.quantile(v, 0.8)) if len(v) else math.nan,
            "p95": float(np.quantile(v, 0.95)) if len(v) else math.nan,
            "max": float(v.max()) if len(v) else math.nan,
            "threshold": thr[k],
            "pass_pct": 100.0 * float(passes[k].mean()) if n_win else math.nan,
            "pass_without_pct": 100.0 * float(without.mean()) if n_win else math.nan,
        }
    bottleneck = None
    if n_win:
        bottleneck = min(CRITERIA, key=lambda k: (crit[k]["pass_pct"], -crit[k]["pass_without_pct"]))
    return {"n_windows": n_win, "mat_pct": mat_pct, "criteria": crit,
            "all_pct": 100.0 * float(all_ok.mean()) if n_win else math.nan,
            "bottleneck": bottleneck}


# ---------------------------------------------------------------- analisis completo
@dataclass
class Analysis:
    n: int
    fs: float
    valid: np.ndarray
    face_pct: float
    iris_ok_pct: float
    iris_assign: dict[str, int] | None
    iod_px: float
    d_px: float
    scale_ratio: float
    series: dict[str, np.ndarray]
    roll: np.ndarray
    gate: np.ndarray
    proc: dict[str, float]
    n_blinks: int
    ear_open: float
    gate_vals: dict[str, np.ndarray] | None = None
    mat_pct: float = math.nan

    @property
    def usable(self) -> bool:
        return self.iris_assign is not None

    @property
    def gate_pct(self) -> float:
        return 100.0 * float(self.gate.mean()) if self.n else 0.0


MIN_VALID = 10


def analyze_recording(P: np.ndarray, face: np.ndarray, iris_ok: np.ndarray,
                      mats: Sequence[np.ndarray | None] | None, fs: float,
                      gp: GateParams = GateParams()) -> Analysis:
    """Calcula todas las series por cuadro. P (T,478,2) con NaN donde no hay iris valido."""
    n = len(P)
    valid = finite_mask(P) & iris_ok
    nan_t = np.full(n, np.nan)
    empty = Analysis(n, fs, valid, 100.0 * float(np.mean(face)) if n else 0.0,
                     100.0 * float(np.mean(iris_ok)) if n else 0.0, None, math.nan, math.nan,
                     math.nan, {}, nan_t, np.zeros(n, dtype=bool), {}, 0, math.nan)
    if valid.sum() < MIN_VALID:
        return empty
    Pv = np.where(valid[:, None, None], P, np.nan)
    assign = assign_iris(Pv)
    geo = {k: eye_geometry(Pv, EYES[k], assign[k]) for k in EYES}
    iod = np.linalg.norm(geo["R"]["m"] - geo["L"]["m"], axis=1)
    d = iris_diameter(Pv)
    ratio = float(np.nanmedian(d) / np.nanmedian(iod))
    s_t = iod * ratio
    series: dict[str, np.ndarray] = {}
    for k, eye in EYES.items():
        g = geo[k]
        pu, pl = Pv[:, eye.mid_upper], Pv[:, eye.mid_lower]
        ear_num = sum(np.linalg.norm(Pv[:, a] - Pv[:, b], axis=1) for a, b in eye.ear_pairs)
        series[f"ear_{k}"] = ear_num / (2 * g["w"])
        series[f"A_{k}"] = np.einsum("ij,ij->i", pl - pu, g["ey"]) / s_t
        series[f"mrd2n_{k}"] = np.einsum("ij,ij->i", pl - g["c"], g["ey"]) / s_t   # proxy
        series[f"mrd1n_{k}"] = np.einsum("ij,ij->i", g["c"] - pu, g["ey"]) / s_t   # proxy
        rel = g["c"] - g["m"]
        series[f"u_{k}"] = np.einsum("ij,ij->i", rel, g["ex"]) / g["w"]
        series[f"v_{k}"] = np.einsum("ij,ij->i", rel, g["ey"]) / g["w"]
    series["d_iod"] = d / iod
    proc = procrustes_residuals(Pv[valid])
    for grp in ("iris", "lids", "mesh"):
        full = np.full(n, np.nan)
        full[valid] = proc[f"frame_{grp}"]
        series[f"proc_{grp}"] = full
    roll = roll_deg(geo["R"]["m"], geo["L"]["m"])
    yaw = pitch = None
    mat_pct = 0.0
    if mats is not None and len(mats) == n and any(M is not None for M in mats):
        ang = np.full((n, 2), np.nan)
        for i, M in enumerate(mats):
            if M is not None:
                ang[i] = euler_yxz(M)[:2]
        yaw, pitch = ang[:, 0], ang[:, 1]
        mat_pct = 100.0 * float(np.isfinite(ang[:, 0]).sum()) / max(1, int(np.sum(face)))
    ear_mean = (series["ear_R"] + series["ear_L"]) / 2
    g_pos, g_scale, g_roll = gate_inputs(Pv, gp.legacy)
    g_blink = None if gp.legacy else gate_blink_mask(ear_mean)
    gate = quiet_gate(g_pos, g_scale, g_roll, yaw, pitch, valid, fs, gp, g_blink)
    gate_vals = gate_window_values(g_pos, g_scale, g_roll, yaw, pitch, valid, fs, gp, g_blink)
    _, n_blinks, ear_open = detect_blinks(ear_mean)
    return Analysis(n, fs, valid, empty.face_pct, empty.iris_ok_pct, assign,
                    float(np.nanmedian(iod)), float(np.nanmedian(d)), ratio, series, roll, gate,
                    {"rms_iris": float(proc["rms_iris"]), "rms_lids": float(proc["rms_lids"]),
                     "rms_mesh": float(proc["rms_mesh"])}, n_blinks, ear_open, gate_vals, mat_pct)


def usable_mask(an: Analysis, exclude_blinks: bool = True, min_gate_blocks: int = 3
                ) -> tuple[np.ndarray, bool]:
    """Cuadros utilizables para ruido: validos, sin parpadeo y, si hay al menos
    min_gate_blocks bloques de 1 s dentro del gate, solo los que pasan el gate.
    Devuelve (mascara, gate_aplicado)."""
    mask = an.valid.copy()
    if exclude_blinks:
        ear = (an.series["ear_R"] + an.series["ear_L"]) / 2
        mask &= ~blink_exclusion(ear)
    w = max(3, int(round(an.fs)))
    gated = mask & an.gate
    if len(block_means(np.zeros(an.n), gated, w)) >= min_gate_blocks:
        return gated, True
    return mask, False


def series_noise(an: Analysis, mask: np.ndarray) -> dict[str, dict[str, float]]:
    """Por serie: sigma_hf, sigma_med7 (validacion), sigma entre bloques de 1 s y MDC95."""
    w = max(3, int(round(an.fs)))
    out: dict[str, dict[str, float]] = {}
    for name, x in an.series.items():
        xm = np.where(mask, x, np.nan)
        bm = block_means(x, mask, w)
        sig_b = sigma_robust(bm) if len(bm) >= 3 else float("nan")
        out[name] = {"mean": float(np.nanmean(xm)) if np.isfinite(xm).any() else float("nan"),
                     "sigma_hf": sigma_hf(xm), "sigma_med7": sigma_med7(xm),
                     "sigma_blocks": sig_b, "mdc95": mdc95(sig_b), "n_blocks": len(bm)}
    return out


# ---------------------------------------------------------------- suelo de ruido
def session_summary(analyses: Sequence[Analysis]) -> dict[str, object]:
    """Resumen por sesion (varios bloques): por serie, media y sigma_w = 1,4826*MAD de las
    medias de bloques de 1 s (cuadros que pasan el gate, sin parpadeos +-3 cuadros)."""
    good = [a for a in analyses if a.usable]
    if not good:
        raise ValueError("ningun bloque con cara e iris suficientes")
    names = list(good[0].series)
    summary: dict[str, dict[str, float]] = {}
    for name in names:
        means: list[np.ndarray] = []
        frames: list[np.ndarray] = []
        for a in good:
            ear = (a.series["ear_R"] + a.series["ear_L"]) / 2
            m = a.valid & ~blink_exclusion(ear) & a.gate
            w = max(3, int(round(a.fs)))
            means.append(block_means(a.series[name], m, w))
            frames.append(a.series[name][m])
        bm, fr = np.concatenate(means), np.concatenate(frames)
        summary[name] = {
            "mean": float(bm.mean()) if bm.size else float("nan"),
            "sigma_w": sigma_robust(bm) if bm.size >= 3 else float("nan"),
            "sigma_frame": sigma_robust(fr) if fr.size else float("nan"),
            "n_blocks": int(bm.size),
        }
    return {"metrics": summary,
            "n_frames": int(sum(a.n for a in good)),
            "gate_pct": float(np.mean([a.gate_pct for a in good])),
            "n_blocks_recorded": len(analyses), "n_blocks_usable": len(good)}


def aggregate_sessions(records: Sequence[Mapping[str, object]]) -> dict[str, dict[str, float]]:
    """Agrega sesiones con reposicionamiento. Por serie: sigma_w (mancomunada, RMS de las
    sigma_w), sigma_b (desv. estandar entre medias de sesion, ddof=1), MDC95 intra-sesion
    (1,96*sqrt2*sigma_w) y MDC95 con reposicionamiento (usa sqrt(sigma_w^2+sigma_b^2))."""
    if len(records) < 3:
        raise ValueError(f"se necesitan >= 3 sesiones, hay {len(records)}")
    names = list(records[0]["metrics"])  # type: ignore[index]
    out: dict[str, dict[str, float]] = {}
    for name in names:
        means = np.array([r["metrics"][name]["mean"] for r in records], dtype=float)  # type: ignore[index]
        sw = np.array([r["metrics"][name]["sigma_w"] for r in records], dtype=float)  # type: ignore[index]
        sw = sw[np.isfinite(sw)]
        sigma_w = float(np.sqrt(np.mean(sw ** 2))) if sw.size else float("nan")
        sigma_b = float(np.std(means[np.isfinite(means)], ddof=1)) if np.isfinite(means).sum() > 1 \
            else float("nan")
        out[name] = {"mean": float(np.nanmean(means)), "sigma_w": sigma_w, "sigma_b": sigma_b,
                     "mdc95_within": mdc95(sigma_w),
                     "mdc95_repos": mdc95(math.sqrt(sigma_w ** 2 + sigma_b ** 2)),
                     "n_sessions": len(records)}
    return out


def to_mm(value_iris_diameters: float) -> float:
    """[INF] Convierte unidades de diametro de iris a mm suponiendo iris de 11,7 mm."""
    return value_iris_diameters * IRIS_DIAMETER_MM


# ---------------------------------------------------------------- autoprueba de invariancia
def apply_known_similarity(P: np.ndarray, scale: float, angle_deg: float,
                           shift: tuple[float, float]) -> np.ndarray:
    a = scale * np.exp(1j * math.radians(angle_deg))
    z = P[..., 0] + 1j * P[..., 1]
    z2 = a * z + complex(*shift)
    return np.stack([z2.real, z2.imag], axis=-1)


def invariance_metrics(P: np.ndarray) -> np.ndarray:
    """Vector con metricas 1 a 3: RMS Procrustes (iris, lids, mesh) en % IOD, desviacion
    estandar de u y v de ambos ojos, y CV de D/IOD."""
    ok = np.ones(len(P), dtype=bool)
    an = analyze_recording(P, ok, ok, None, 30.0)
    proc = [an.proc["rms_iris"], an.proc["rms_lids"], an.proc["rms_mesh"]]
    uv = [float(np.nanstd(an.series[k])) for k in ("u_R", "v_R", "u_L", "v_L")]
    d = an.series["d_iod"]
    return np.array(proc + uv + [float(np.nanstd(d) / np.nanmean(d))])


# ---------------------------------------------------------------- datos sinteticos (pruebas y --smoke)
def make_synthetic_landmarks(t: int = 120, noise_px: float = 0.3, seed: int = 0,
                             blinks: Sequence[tuple[int, int]] = (), open_px: float = 14.0,
                             drift_px: float = 0.0, blink_shift_px: float = 0.0) -> np.ndarray:
    """Secuencia (t,478,2) de una cara sintetica: IOD 140 px, ojos de 60 px de ancho, iris de
    22 px de diametro, malla aleatoria fija. Ruido gaussiano independiente por cuadro y
    deriva opcional de traslacion. blinks: lista de (inicio, fin) de cuadros con ojo casi cerrado.
    blink_shift_px: durante cada parpadeo, comisuras, parpados e iris se desplazan (hacia la nariz
    y hacia abajo, algo distinto por ojo) hasta ese numero de pixeles, como un parpadeo real
    arrastra la piel del ojo; los puntos rigidos (nariz, frente, mejillas) NO se mueven."""
    rng = np.random.default_rng(seed)
    base = rng.uniform((150.0, 150.0), (450.0, 380.0), size=(N_LANDMARKS, 2))
    centers = {"R": np.array([230.0, 240.0]), "L": np.array([370.0, 240.0])}
    for i, p in zip((168, 6, 197, 195, 5, 4, 1, 10, 151, 9, 8),
                    ((300, 200), (300, 230), (300, 280), (300, 300), (300, 320), (300, 335),
                     (300, 345), (300, 120), (300, 150), (300, 180), (300, 190))):
        base[i] = p
    base[234], base[454] = (125.0, 240.0), (475.0, 240.0)  # ancho de cara 350 = IOD 140 / 0,4
    frames = np.repeat(base[None], t, axis=0)
    opening = np.full(t, open_px)
    for s, e in blinks:
        opening[s:e] = 1.5
    half = 30.0
    for k, eye in EYES.items():
        c = centers[k]
        xs = (c[0] - half, c[0] + half)
        # R: 33 externa (izquierda en la imagen), 133 interna; L: 362 interna, 263 externa
        frames[:, eye.corner_a] = (xs[0], c[1])
        frames[:, eye.corner_b] = (xs[1], c[1])
        for idx, dx in zip(eye.upper, (-12.0, 0.0, 12.0)):
            frames[:, idx, 0] = c[0] + dx
            frames[:, idx, 1] = c[1] - opening / 2
        for idx, dx in zip(eye.lower, (-12.0, 0.0, 12.0)):
            frames[:, idx, 0] = c[0] + dx
            frames[:, idx, 1] = c[1] + opening / 2
        ic = 468 if k == "R" else 473
        frames[:, ic] = c
        for j, (dx, dy) in enumerate(((-11, 0), (0, -11), (11, 0), (0, 11))):
            frames[:, ic + 1 + j] = (c[0] + dx, c[1] + dy)
    if blink_shift_px:
        eye_pts = {"R": (*EYES["R"].upper, *EYES["R"].lower, 33, 133, 468, 469, 470, 471, 472),
                   "L": (*EYES["L"].upper, *EYES["L"].lower, 362, 263, 473, 474, 475, 476, 477)}
        shift = {"R": (blink_shift_px, blink_shift_px), "L": (-blink_shift_px, 0.6 * blink_shift_px)}
        for s0, e0 in blinks:
            for k, idxs in eye_pts.items():
                frames[s0:e0][:, list(idxs)] += shift[k]
    frames = frames + rng.normal(0.0, noise_px, frames.shape)
    if drift_px:
        frames = frames + np.cumsum(rng.normal(0.0, drift_px, (t, 1, 2)), axis=0)
    return frames


# ---------------------------------------------------------------- reintento por quietud
DEFAULT_MIN_QUIET = 80.0
DEFAULT_MAX_RETRIES = 2
RETRY, ACCEPT, FLAG = "retry", "accept", "flag"


def retry_decision(quiet_pct: float | None, attempt: int, max_retries: int,
                   min_quiet: float = DEFAULT_MIN_QUIET) -> str:
    """Decide que hacer al terminar una captura (funcion pura).

    quiet_pct: % de ventanas de 1 s en verde sobre lo grabado (None = sin dato: se acepta).
    attempt: nº de intento recien terminado (1 = primero). max_retries: reintentos permitidos
    (intentos totales = 1 + max_retries). Devuelve:
      'accept': quiet_pct >= min_quiet (el limite exacto pasa) o sin dato.
      'retry':  no cumple y quedan reintentos.
      'flag':   no cumple y no quedan: se continua marcando CAPTURA CON MOVIMIENTO."""
    if quiet_pct is None or quiet_pct >= min_quiet:
        return ACCEPT
    return RETRY if attempt <= max_retries else FLAG
