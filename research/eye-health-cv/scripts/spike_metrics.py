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


# ---------------------------------------------------------------- ceja (PTB: pupila a ceja)
@dataclass(frozen=True)
class Brow:
    """Polilineas de ceja (lateral a medial). Indices de FACEMESH_*_EYEBROW TOMADOS DE MEMORIA:
    SUPUESTO que se confirma con --brow-check (verde = borde superior, rojo = inferior)."""
    upper: tuple[int, ...]
    lower: tuple[int, ...]
    center_upper: int
    center_lower: int
    lateral_lower: int
    medial_lower: int


BROWS: dict[str, Brow] = {
    "R": Brow((70, 63, 105, 66, 107), (46, 53, 52, 65, 55), 105, 52, 46, 55),
    "L": Brow((300, 293, 334, 296, 336), (276, 283, 282, 295, 285), 334, 282, 276, 285),
}
BROW_IDX = tuple(sorted({i for b in BROWS.values() for i in (*b.upper, *b.lower)}))
assert max(BROW_IDX) < N_LANDMARKS - len(IRIS_IDX)
# series de ceja por ojo (sufijo _R/_L); todas en diametros de iris (los mm son [INF])
BROW_SERIES_EYE = ("ptb_inf", "ptb_sup", "brow_fis", "brow_th", "ptb_inf1", "ptb_sup1",
                   "ptb_inf_lat", "ptb_inf_med")
BROW_SERIES = tuple(f"{b}_{e}" for b in BROW_SERIES_EYE for e in ("R", "L"))
SERIES_EYE = ("ear", "A", "mrd2n", "mrd1n", "u", "v") + BROW_SERIES_EYE  # una serie por ojo (sufijo _R/_L)
SERIES_SINGLE = ("d_iod",)
# blendshapes de ceja que guarda el spike (nombres de MediaPipe)
BROW_BLEND = ("browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight")
BROW_ABS_DEFAULT = 0.30   # PROVISORIO: puntaje absoluto que marca ceja activa
BROW_REL_DEFAULT = 0.15   # PROVISORIO: margen sobre la mediana de la sesion
BROW_PAD = 3              # +- cuadros excluidos, como en parpadeo
PARALLAX_MM = 10.0        # [SUPUESTO] la ceja esta ~10 mm por delante del iris (paralaje con el pitch)
# criterios de aceptacion de PTB_inf (mm [INF], iris 11,7 mm); detecta +2,3 mm con margen si MDC <= 1,15
MDC_OK_MM = 1.15
MDC_LIMIT_MM = 2.3
SLOPE_MAX_MM_DEG = 0.1    # [SUPUESTO]
BROW_EXCL_MAX_PCT = 30.0
BROW_TH_FACTOR = 2.0      # [SUPUESTO] "comparable" a MRD1n: sigma_w(brow_th) <= 2 x sigma_w(mrd1n)
CONTROL_FACTOR = 3.0      # el control positivo debe superar 3 x MDC conocido


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


# ---------------------------------------------------------------- geometria de la ceja
def check_brow_assignment(P: np.ndarray) -> dict[str, float]:
    """Cada ceja debe quedar mas cerca del punto medio de las comisuras de SU ojo que del otro
    (mediana de la sesion, centroide de los 10 puntos de la ceja). Si no, los indices de ceja
    estan mal o la imagen esta cruzada: ValueError con mensaje claro (como assign_iris).
    Devuelve la distancia propia/ajena (< 1 en un caso sano) por ojo."""
    ok = finite_mask(P)
    if ok.sum() == 0:
        raise ValueError("sin cuadros validos para comprobar la asignacion de cejas")
    mids = {n: (P[ok, e.corner_a] + P[ok, e.corner_b]) / 2 for n, e in EYES.items()}
    ratios: dict[str, float] = {}
    for name, brow in BROWS.items():
        other = "L" if name == "R" else "R"
        cen = P[ok][:, list((*brow.upper, *brow.lower))].mean(axis=1)
        own = float(np.median(np.linalg.norm(cen - mids[name], axis=1)))
        alien = float(np.median(np.linalg.norm(cen - mids[other], axis=1)))
        ratios[name] = own / alien if alien > 0 else math.inf
        if not own < alien:
            raise ValueError(
                f"asignacion de cejas incorrecta: la ceja {name} (indices {brow.upper + brow.lower}) "
                f"queda a {own:.1f} px del ojo {name} y a {alien:.1f} px del otro. Los indices de ceja "
                f"son SUPUESTOS (tomados de memoria): confirmalos con --brow-check antes de medir.")
    return ratios


def polyline_y_at_x0(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Interpola cada polilinea (x (T,k), y (T,k); en el eje e_x / e_y del ojo, origen en el punto
    medio de las comisuras) en x = 0. NaN si el 0 queda fuera del tramo cubierto por la ceja o hay
    NaN (no se extrapola)."""
    t, n = x.shape
    order = np.argsort(x, axis=1)
    xs, ys = np.take_along_axis(x, order, 1), np.take_along_axis(y, order, 1)
    idx = np.clip((xs < 0).sum(axis=1), 1, n - 1)
    rows = np.arange(t)
    x0, x1, y0, y1 = xs[rows, idx - 1], xs[rows, idx], ys[rows, idx - 1], ys[rows, idx]
    with np.errstate(invalid="ignore", divide="ignore"):
        out = y0 + (-x0 / (x1 - x0)) * (y1 - y0)
    inside = (xs[:, 0] <= 0) & (xs[:, -1] >= 0) & np.isfinite(xs).all(1) & np.isfinite(ys).all(1)
    return np.where(inside, out, np.nan)


def brow_series(P: np.ndarray, eye_name: str, g: dict[str, np.ndarray], s_t: np.ndarray
                ) -> dict[str, np.ndarray]:
    """Series de ceja de un ojo (diametros de iris), P (T,478,2), g = eye_geometry, s_t escala.

    Valor principal: cada polilinea de ceja se proyecta sobre e_x (origen en el punto medio m de
    las comisuras) y se interpola su coordenada e_y en la posicion de m (aproxima la linea
    medio-pupilar y no depende de la mirada horizontal). e_y apunta hacia abajo: PTB > 0 = ceja por
    encima de la pupila.
      ptb_inf  = (c - ceja_inf).e_y / s_t   PRINCIPAL (Karlin 2021: pupila a borde INFERIOR)
      ptb_sup  = (c - ceja_sup).e_y / s_t
      brow_fis = (parpado_sup - ceja_inf).e_y / s_t   (distancia ceja-parpado; SIGNO invertido frente
                 a la formula literal para que sea positiva, igual que PTB)
      brow_th  = ptb_sup - ptb_inf (grosor, casi constante: mide el jitter puro de la ceja)
    Controles: landmark unico (105/52 y 334/282) y PTB_inf lateral y medial (46/276 y 55/285)."""
    brow, eye = BROWS[eye_name], EYES[eye_name]
    m, ex, ey, c = g["m"], g["ex"], g["ey"], g["c"]

    def y_of(i: int) -> np.ndarray:
        return np.einsum("ij,ij->i", P[:, i] - m, ey)

    def poly_y(idx: Sequence[int]) -> np.ndarray:
        rel = P[:, list(idx)] - m[:, None, :]
        return polyline_y_at_x0(np.einsum("tkj,tj->tk", rel, ex), np.einsum("tkj,tj->tk", rel, ey))

    cy = np.einsum("ij,ij->i", c - m, ey)
    inf_y, sup_y = poly_y(brow.lower), poly_y(brow.upper)
    ptb_inf, ptb_sup = (cy - inf_y) / s_t, (cy - sup_y) / s_t
    return {"ptb_inf": ptb_inf, "ptb_sup": ptb_sup,
            "brow_fis": (y_of(eye.mid_upper) - inf_y) / s_t, "brow_th": ptb_sup - ptb_inf,
            "ptb_inf1": (cy - y_of(brow.center_lower)) / s_t,
            "ptb_sup1": (cy - y_of(brow.center_upper)) / s_t,
            "ptb_inf_lat": (cy - y_of(brow.lateral_lower)) / s_t,
            "ptb_inf_med": (cy - y_of(brow.medial_lower)) / s_t}


# ---------------------------------------------------------------- expresion de ceja (blendshapes)
@dataclass(frozen=True)
class BrowParams:
    """Umbrales PROVISORIOS de 'ceja activa' (configurables por --brow-abs y --brow-rel):
    algun puntaje de BROW_BLEND > abs, o > mediana de la sesion de ESE puntaje + rel. Se excluyen
    +-pad cuadros. enabled=False (--no-brow-filter): se calcula y se guarda la mascara, pero no
    se aplica a las series."""
    abs_thr: float = BROW_ABS_DEFAULT
    rel_thr: float = BROW_REL_DEFAULT
    pad: int = BROW_PAD
    enabled: bool = True


def blend_median(blend: np.ndarray | None) -> np.ndarray:
    """Mediana por puntaje (5,) sobre los cuadros con puntajes finitos; NaN si no hay."""
    if blend is None or not np.isfinite(blend).any():
        return np.full(len(BROW_BLEND), np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmedian(blend, axis=0)


def brow_active_mask(blend: np.ndarray | None, bp: BrowParams, ref_median: np.ndarray | None = None,
                     n: int | None = None) -> np.ndarray:
    """Cuadros con ceja activa (sin padding). blend (T,5), NaN = sin dato (no activo)."""
    if blend is None:
        return np.zeros(0 if n is None else n, dtype=bool)
    med = blend_median(blend) if ref_median is None else np.asarray(ref_median, dtype=float)
    with np.errstate(invalid="ignore"):
        hit = (blend > bp.abs_thr) | (blend > (med + bp.rel_thr)[None, :])
    return hit.any(axis=1) & np.isfinite(blend).any(axis=1)


def pad_mask(mask: np.ndarray, pad: int) -> np.ndarray:
    if not mask.any() or pad <= 0:
        return mask.copy()
    return np.convolve(mask.astype(float), np.ones(2 * pad + 1), mode="same") > 0


def mask_runs(mask: np.ndarray) -> list[list[int]]:
    """Tramos [inicio, fin) de True (para guardar la mascara como numeros)."""
    d = np.diff(np.concatenate([[0], mask.astype(int), [0]]))
    return [[int(s), int(e)] for s, e in zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1))]


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
    blend: np.ndarray | None = None        # (T,5) puntajes BROW_BLEND (NaN sin dato) o None
    pitch: np.ndarray | None = None        # (T,) grados de la matriz, NaN sin matriz
    brow_active: np.ndarray | None = None  # ceja activa por cuadro (mediana del bloque)
    brow_excl: np.ndarray | None = None    # idem con +-pad cuadros

    @property
    def usable(self) -> bool:
        return self.iris_assign is not None

    @property
    def gate_pct(self) -> float:
        return 100.0 * float(self.gate.mean()) if self.n else 0.0


MIN_VALID = 10


def analyze_recording(P: np.ndarray, face: np.ndarray, iris_ok: np.ndarray,
                      mats: Sequence[np.ndarray | None] | None, fs: float,
                      gp: GateParams = GateParams(), blend: np.ndarray | None = None,
                      bp: BrowParams = BrowParams(), brow: bool = True) -> Analysis:
    """Calcula todas las series por cuadro. P (T,478,2) con NaN donde no hay iris valido.
    blend (T,5): puntajes de BROW_BLEND por cuadro (NaN sin dato). brow=False omite las series de
    ceja (barrido). Con brow=True, ValueError si las cejas quedan cruzadas (ver check_brow_assignment)."""
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
    if brow:
        check_brow_assignment(Pv)
        for k in EYES:
            for bname, arr in brow_series(Pv, k, geo[k], s_t).items():
                series[f"{bname}_{k}"] = arr
    proc = procrustes_residuals(Pv[valid])
    for grp in ("iris", "lids", "mesh"):
        full = np.full(n, np.nan)
        full[valid] = proc[f"frame_{grp}"]
        series[f"proc_{grp}"] = full
    roll = roll_deg(geo["R"]["m"], geo["L"]["m"])
    yaw = pitch = None
    mat_pct = 0.0
    if blend is not None and len(blend) != n:
        raise ValueError(f"blend tiene {len(blend)} filas y la grabacion {n} cuadros")
    b_arr = None if blend is None else np.asarray(blend, dtype=float)
    b_act = brow_active_mask(b_arr, bp, n=n)
    b_excl = pad_mask(b_act, bp.pad)
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
                     "rms_mesh": float(proc["rms_mesh"])}, n_blinks, ear_open, gate_vals, mat_pct,
                    b_arr, pitch if pitch is not None else nan_t, b_act, b_excl)


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
def _series_stats(bm: np.ndarray, fr: np.ndarray) -> dict[str, float]:
    return {"mean": float(bm.mean()) if bm.size else float("nan"),
            "sigma_w": sigma_robust(bm) if bm.size >= 3 else float("nan"),
            "sigma_frame": sigma_robust(fr) if fr.size else float("nan"),
            "n_blocks": int(bm.size)}


def _score_stats(blend: np.ndarray | None) -> dict[str, dict[str, float]]:
    """Mediana, p95 y maximo por puntaje de ceja (solo numeros)."""
    out: dict[str, dict[str, float]] = {}
    for j, name in enumerate(BROW_BLEND):
        v = np.array([]) if blend is None else blend[:, j][np.isfinite(blend[:, j])]
        out[name] = ({"median": float(np.median(v)), "p95": float(np.quantile(v, 0.95)),
                      "max": float(v.max())} if v.size else {"median": math.nan, "p95": math.nan,
                                                             "max": math.nan})
    return out


def session_summary(analyses: Sequence[Analysis], bp: BrowParams = BrowParams()) -> dict[str, object]:
    """Resumen por sesion (varios bloques): por serie, media y sigma_w = 1,4826*MAD de las
    medias de bloques de 1 s (cuadros que pasan el gate, sin parpadeos +-3 cuadros).

    Series de ceja: ademas se excluyen los cuadros de ceja activa (+-bp.pad; mediana de la SESION
    de cada puntaje) si bp.enabled. Se guarda tambien la version SIN filtro (mean_nf, sigma_w_nf):
    una ceja alzada persistente (la senal buscada) puede quedar excluida, nunca se borran datos.
    La mascara y los puntajes quedan solo como numeros en 'brow' (tramos y percentiles)."""
    good = [a for a in analyses if a.usable]
    if not good:
        raise ValueError("ningun bloque con cara e iris suficientes")
    names = list(good[0].series)
    blends = [a.blend for a in good if a.blend is not None]
    sess_med = blend_median(np.concatenate(blends)) if blends else np.full(len(BROW_BLEND), math.nan)
    bases, excls, acts = [], [], []
    for a in good:
        ear = (a.series["ear_R"] + a.series["ear_L"]) / 2
        bases.append(a.valid & ~blink_exclusion(ear) & a.gate)
        act = (brow_active_mask(a.blend, bp, sess_med) if a.blend is not None
               else np.zeros(a.n, dtype=bool))
        acts.append(act)
        excls.append(pad_mask(act, bp.pad))
    summary: dict[str, dict[str, float]] = {}
    for name in names:
        is_brow = name in BROW_SERIES
        means: list[np.ndarray] = []
        frames: list[np.ndarray] = []
        means_nf: list[np.ndarray] = []
        frames_nf: list[np.ndarray] = []
        for a, base, ex in zip(good, bases, excls):
            m = base & ~ex if (is_brow and bp.enabled) else base
            w = max(3, int(round(a.fs)))
            means.append(block_means(a.series[name], m, w))
            frames.append(a.series[name][m])
            if is_brow:
                means_nf.append(block_means(a.series[name], base, w))
                frames_nf.append(a.series[name][base])
        summary[name] = _series_stats(np.concatenate(means), np.concatenate(frames))
        if is_brow:
            nf = _series_stats(np.concatenate(means_nf), np.concatenate(frames_nf))
            summary[name].update({"mean_nf": nf["mean"], "sigma_w_nf": nf["sigma_w"],
                                  "n_blocks_nf": nf["n_blocks"]})
    out: dict[str, object] = {
        "metrics": summary, "n_frames": int(sum(a.n for a in good)),
        "gate_pct": float(np.mean([a.gate_pct for a in good])),
        "n_blocks_recorded": len(analyses), "n_blocks_usable": len(good)}
    if "ptb_inf_R" in names:
        n_base = int(sum(b.sum() for b in bases))
        n_excl = int(sum((b & e).sum() for b, e in zip(bases, excls)))
        n_act = int(sum((b & x).sum() for b, x in zip(bases, acts)))
        blocks = []
        for a, base, ex, act in zip(good, bases, excls, acts):
            m = base & ~ex if bp.enabled else base
            ptb = (a.series["ptb_inf_R"] + a.series["ptb_inf_L"]) / 2
            pit = a.pitch if a.pitch is not None else np.full(a.n, np.nan)
            ok = m & np.isfinite(ptb) & np.isfinite(pit)
            blocks.append({
                "pitch_mean": float(pit[ok].mean()) if ok.any() else math.nan,
                "ptb_inf_mean": float(ptb[ok].mean()) if ok.any() else math.nan,
                "n_frames_pitch": int(ok.sum()),
                "excl_pct": 100.0 * float((base & ex).sum()) / max(1, int(base.sum())),
                "scores": _score_stats(a.blend), "mask_runs": mask_runs(ex)})
        out["brow"] = {
            "has_blend": bool(blends), "filter": bool(bp.enabled), "abs": bp.abs_thr, "rel": bp.rel_thr,
            "pad": bp.pad, "session_median": [float(v) for v in sess_med],
            "excl_pct": 100.0 * n_excl / n_base if n_base else math.nan,
            "active_pct": 100.0 * n_act / n_base if n_base else math.nan,
            "blocks": blocks}
    return out


def series_union(records: Sequence[Mapping[str, object]]) -> list[str]:
    names: list[str] = []
    for r in records:
        for n in r["metrics"]:  # type: ignore[attr-defined]
            if n not in names:
                names.append(n)
    return names


def aggregate_sessions(records: Sequence[Mapping[str, object]]) -> dict[str, dict[str, float]]:
    """Agrega sesiones con reposicionamiento. Por serie: sigma_w (mancomunada, RMS de las
    sigma_w), sigma_b (desv. estandar entre medias de sesion, ddof=1), MDC95 intra-sesion
    (1,96*sqrt2*sigma_w) y MDC95 con reposicionamiento (usa sqrt(sigma_w^2+sigma_b^2)).

    Sesiones viejas sin una serie (p. ej. sin PTB) se ignoran SOLO para esa serie; una serie con
    menos de 3 sesiones que la tengan se omite del resultado (ver missing_series). Las series de
    ceja con version sin filtro agregan sigma_w_nf, sigma_b_nf y mdc95_repos_nf."""
    if len(records) < 3:
        raise ValueError(f"se necesitan >= 3 sesiones, hay {len(records)}")
    out: dict[str, dict[str, float]] = {}

    def pool(rs: Sequence[Mapping[str, object]], name: str, mk: str, sk: str) -> tuple[float, float]:
        means = np.array([r["metrics"][name].get(mk, math.nan) for r in rs], dtype=float)  # type: ignore[index]
        sw = np.array([r["metrics"][name].get(sk, math.nan) for r in rs], dtype=float)  # type: ignore[index]
        sw = sw[np.isfinite(sw)]
        sigma_w = float(np.sqrt(np.mean(sw ** 2))) if sw.size else float("nan")
        sigma_b = float(np.std(means[np.isfinite(means)], ddof=1)) if np.isfinite(means).sum() > 1 \
            else float("nan")
        return sigma_w, sigma_b

    for name in series_union(records):
        rs = [r for r in records if name in r["metrics"]]  # type: ignore[operator]
        if len(rs) < 3:
            continue
        means = np.array([r["metrics"][name]["mean"] for r in rs], dtype=float)  # type: ignore[index]
        sigma_w, sigma_b = pool(rs, name, "mean", "sigma_w")
        out[name] = {"mean": float(np.nanmean(means)), "sigma_w": sigma_w, "sigma_b": sigma_b,
                     "mdc95_within": mdc95(sigma_w),
                     "mdc95_repos": mdc95(math.sqrt(sigma_w ** 2 + sigma_b ** 2)),
                     "n_sessions": len(rs)}
        if all("sigma_w_nf" in r["metrics"][name] for r in rs):  # type: ignore[index]
            sw_nf, sb_nf = pool(rs, name, "mean_nf", "sigma_w_nf")
            out[name].update({"sigma_w_nf": sw_nf, "sigma_b_nf": sb_nf,
                              "mdc95_within_nf": mdc95(sw_nf),
                              "mdc95_repos_nf": mdc95(math.sqrt(sw_nf ** 2 + sb_nf ** 2))})
    return out


def missing_series(records: Sequence[Mapping[str, object]], agg: Mapping[str, object]
                   ) -> dict[str, int]:
    """Series que existen en alguna sesion pero NO llegaron al agregado (< 3 sesiones las tienen):
    nombre -> sesiones que si la tienen. Sirve para avisar de sesiones viejas sin PTB."""
    return {n: sum(1 for r in records if n in r["metrics"])  # type: ignore[operator]
            for n in series_union(records) if n not in agg}


def sessions_without(records: Sequence[Mapping[str, object]], name: str) -> list[object]:
    """Ids de las sesiones que no tienen la serie `name` (p. ej. 'ptb_inf_R')."""
    return sorted(r.get("session_id", "?") for r in records if name not in r["metrics"])  # type: ignore[operator]


def _slope(x: np.ndarray, y: np.ndarray, min_n: int = 3, min_span: float = 0.05) -> float:
    ok = np.isfinite(x) & np.isfinite(y)
    if ok.sum() < min_n or np.ptp(x[ok]) < min_span:
        return math.nan
    return float(np.polyfit(x[ok], y[ok], 1)[0])


def pitch_slopes(records: Sequence[Mapping[str, object]]) -> dict[str, float]:
    """Pendiente de PTB_inf contra el pitch (mm [INF] por grado; iris 11,7 mm). 'blocks': todos los
    bloques con la media de su sesion restada (solo variacion de pitch dentro de la sesion);
    'sessions': medias de sesion (variacion entre reposicionamientos). NaN si hay < 3 puntos o el
    pitch varia < 0,05 grados. Solo usa sesiones con datos de ceja."""
    bx: list[float] = []
    by: list[float] = []
    sx: list[float] = []
    sy: list[float] = []
    for r in records:
        br = r.get("brow")
        if not isinstance(br, Mapping):
            continue
        pts = [(b["pitch_mean"], b["ptb_inf_mean"]) for b in br["blocks"]  # type: ignore[index]
               if b["pitch_mean"] is not None and b["ptb_inf_mean"] is not None
               and math.isfinite(b["pitch_mean"]) and math.isfinite(b["ptb_inf_mean"])]
        if not pts:
            continue
        px, py = np.array(pts, dtype=float).T
        sx.append(float(px.mean()))
        sy.append(float(py.mean()))
        bx += list(px - px.mean())
        by += list(py - py.mean())
    return {"blocks_mm_deg": to_mm(_slope(np.array(bx), np.array(by))),
            "sessions_mm_deg": to_mm(_slope(np.array(sx), np.array(sy))),
            "n_blocks": float(len(bx)), "n_sessions": float(len(sx))}


def brow_excl_pcts(records: Sequence[Mapping[str, object]]) -> list[float]:
    """% de cuadros excluidos por ceja activa de cada sesion que tiene datos de ceja."""
    vals = []
    for r in records:
        br = r.get("brow")
        if isinstance(br, Mapping) and br.get("excl_pct") is not None:
            vals.append(float(br["excl_pct"]))  # type: ignore[arg-type]
    return vals


def to_mm(value_iris_diameters: float) -> float:
    """[INF] Convierte unidades de diametro de iris a mm suponiendo iris de 11,7 mm."""
    return value_iris_diameters * IRIS_DIAMETER_MM


# ---------------------------------------------------------------- criterios de aceptacion de la ceja
OK, NOT_OK, NO_DATA = "CUMPLE", "NO CUMPLE", "SIN DATOS"


def _finite(v: object) -> bool:
    return isinstance(v, (int, float)) and math.isfinite(float(v))


def _fmt3(x: float) -> str:
    return f"{x:.3f}" if _finite(x) else "n/a"


def mdc_class(mm: float) -> tuple[str, str]:
    """(veredicto, texto) del MDC95 con reposicionamiento de PTB_inf en mm [INF]."""
    if not _finite(mm):
        return NO_DATA, "sin dato"
    if mm <= MDC_OK_MM:
        return OK, f"{mm:.2f} mm <= {MDC_OK_MM} mm: detecta +2,3 mm con margen"
    if mm <= MDC_LIMIT_MM:
        return NOT_OK, f"{mm:.2f} mm en ({MDC_OK_MM}; {MDC_LIMIT_MM}] mm: LIMITE (detecta +2,3 mm sin margen)"
    return NOT_OK, f"{mm:.2f} mm > {MDC_LIMIT_MM} mm: NO USABLE para detectar +2,3 mm"


def brow_acceptance(agg: Mapping[str, Mapping[str, float]], records: Sequence[Mapping[str, object]],
                    control: Mapping[str, object] | None = None) -> list[tuple[str, str, str]]:
    """Criterios de aceptacion de PTB_inf como (criterio, veredicto, detalle). Todo PROVISORIO
    ([SUPUESTO]); sin datos el veredicto es SIN DATOS, nunca CUMPLE."""
    items: list[tuple[str, str, str]] = []
    r, l_ = agg.get("ptb_inf_R"), agg.get("ptb_inf_L")
    # 1) MDC95 con reposicionamiento (el peor ojo decide)
    if r is None or l_ is None:
        items.append(("MDC95 con reposicionamiento de PTB_inf", NO_DATA,
                      "faltan >= 3 sesiones con PTB (las sesiones viejas no lo tienen)"))
    else:
        mm = {"R": to_mm(r["mdc95_repos"]), "L": to_mm(l_["mdc95_repos"])}
        worst = max(mm.values()) if all(_finite(v) for v in mm.values()) else math.nan
        v, txt = mdc_class(worst)
        extra = ""
        if "mdc95_repos_nf" in r and "mdc95_repos_nf" in l_:
            extra = (f"; SIN filtro de ceja: R {to_mm(r['mdc95_repos_nf']):.2f}, "
                     f"L {to_mm(l_['mdc95_repos_nf']):.2f} mm")
        items.append(("MDC95 con reposicionamiento de PTB_inf (peor ojo)", v,
                      f"R {mm['R']:.2f}, L {mm['L']:.2f} mm [INF] -> {txt}{extra}"))
    # 2) sigma_w de brow_th comparable a MRD1n
    th = [agg.get(f"brow_th_{e}") for e in "RL"]
    m1 = [agg.get(f"mrd1n_{e}") for e in "RL"]
    if any(x is None for x in th + m1):
        items.append(("sigma_w de brow_th comparable a MRD1n", NO_DATA, "faltan series"))
    else:
        s_th = float(np.sqrt(np.mean([x["sigma_w"] ** 2 for x in th])))  # type: ignore[index]
        s_m1 = float(np.sqrt(np.mean([x["sigma_w"] ** 2 for x in m1])))  # type: ignore[index]
        ratio = s_th / s_m1 if s_m1 > 0 else math.nan
        ok = _finite(ratio) and ratio <= BROW_TH_FACTOR
        items.append(("sigma_w de brow_th comparable a MRD1n", OK if ok else (NOT_OK if _finite(ratio) else NO_DATA),
                      f"sigma_w brow_th {s_th:.5f} vs MRD1n {s_m1:.5f} diam. iris (cociente {ratio:.2f}; "
                      f"'comparable' = <= {BROW_TH_FACTOR:g}, [SUPUESTO])"))
    # 3) pendiente con el pitch (paralaje)
    sl = pitch_slopes(records)
    vals = [abs(sl[k]) for k in ("blocks_mm_deg", "sessions_mm_deg") if _finite(sl[k])]
    items.append((f"pendiente PTB_inf-pitch < {SLOPE_MAX_MM_DEG} mm/grado [SUPUESTO]",
                  (OK if max(vals) < SLOPE_MAX_MM_DEG else NOT_OK) if vals else NO_DATA,
                  f"entre bloques {_fmt3(sl['blocks_mm_deg'])} mm/grado ({sl['n_blocks']:.0f} bloques), "
                  f"entre sesiones {_fmt3(sl['sessions_mm_deg'])} mm/grado ({sl['n_sessions']:.0f} sesiones); "
                  f"n/a = pitch casi constante (< 0,05 grados) o < 3 puntos"))
    # 4) exclusion por ceja activa
    ex = brow_excl_pcts(records)
    items.append((f"exclusion por ceja activa < {BROW_EXCL_MAX_PCT:g} %",
                  (OK if max(ex) < BROW_EXCL_MAX_PCT else NOT_OK) if ex else NO_DATA,
                  (f"por sesion: {', '.join(f'{v:.1f} %' for v in ex)}" if ex
                   else "sin sesiones con datos de ceja o sin blendshapes")))
    # 5) control positivo
    if control is None:
        items.append(("control positivo detectado", NO_DATA, "no hay --brow-control registrado"))
    else:
        items.append(("control positivo detectado", OK if control.get("detected") else NOT_OK,
                      str(control.get("summary", ""))))
    return items


# ---------------------------------------------------------------- control positivo (--brow-control)
CONTROL_PHASES = ("neutral", "raised", "frown")


def control_phase_stats(an: Analysis, settle_frames: int, bp: BrowParams = BrowParams(),
                        ref_median: np.ndarray | None = None) -> dict[str, float]:
    """Estadisticos de una fase del control positivo. Cuadros validos sin parpadeo, saltando los
    primeros settle_frames (transicion de expresion). SIN gate ni filtro de ceja (la expresion
    ES la senal). active_pct: % de esos cuadros con ceja activa segun los blendshapes (NaN sin
    ellos), con la mediana de referencia (la de la fase neutral)."""
    out: dict[str, float] = {k: math.nan for k in
                             ("ptb_inf_R", "ptb_inf_L", "brow_th_R", "brow_th_L", "sigma_w_R", "sigma_w_L",
                              "pitch", "active_pct")}
    out["n_frames"] = 0.0
    if not an.usable:
        return out
    ear = (an.series["ear_R"] + an.series["ear_L"]) / 2
    m = an.valid & ~blink_exclusion(ear)
    m[:settle_frames] = False
    out["n_frames"] = float(m.sum())
    w = max(3, int(round(an.fs)))
    for e in "RL":
        for s in ("ptb_inf", "brow_th"):
            x = an.series[f"{s}_{e}"]
            ok = m & np.isfinite(x)
            out[f"{s}_{e}"] = float(x[ok].mean()) if ok.any() else math.nan
        bm = block_means(an.series[f"ptb_inf_{e}"], m, w)
        out[f"sigma_w_{e}"] = sigma_robust(bm) if len(bm) >= 3 else math.nan
    if an.pitch is not None and np.isfinite(an.pitch[m]).any():
        out["pitch"] = float(np.nanmean(an.pitch[m]))
    if an.blend is not None and m.any():
        act = brow_active_mask(an.blend, bp, ref_median)
        out["active_pct"] = 100.0 * float(act[m].mean())
    return out


def control_result(phases: Mapping[str, Mapping[str, float]], mdc: Mapping[str, float], mdc_source: str
                   ) -> dict[str, object]:
    """Cambio de PTB_inf de 'raised' (cejas alzadas) y 'frown' (ceno fruncido) frente a 'neutral',
    por ojo, en diametros de iris y mm [INF]; detectado = en AMBOS ojos |cambio| > CONTROL_FACTOR x
    MDC conocido (mdc: ojo -> MDC95 en diametros de iris). Tambien: signo esperado (alzadas +,
    fruncido -), cambio de pitch (paralaje) y si los blendshapes marcan ceja activa (>= 50 %)."""
    res: dict[str, object] = {"mdc": dict(mdc), "mdc_source": mdc_source, "factor": CONTROL_FACTOR}
    parts = []
    all_det = True
    for ph, sign in (("raised", 1), ("frown", -1)):
        d = {e: phases[ph][f"ptb_inf_{e}"] - phases["neutral"][f"ptb_inf_{e}"] for e in "RL"}
        ratio = {e: (abs(d[e]) / mdc[e] if _finite(d[e]) and _finite(mdc.get(e)) and mdc[e] > 0
                     else math.nan) for e in "RL"}
        det = all(_finite(ratio[e]) and ratio[e] > CONTROL_FACTOR for e in "RL")
        sign_ok = all(_finite(d[e]) and d[e] * sign > 0 for e in "RL")
        act = phases[ph]["active_pct"]
        dp = phases[ph]["pitch"] - phases["neutral"]["pitch"]
        res[ph] = {"delta_diam": d, "delta_mm": {e: to_mm(d[e]) for e in "RL"}, "ratio_mdc": ratio,
                   "detected": det, "sign_ok": sign_ok, "active_pct": act,
                   "blend_flag": bool(_finite(act) and act >= 50.0), "delta_pitch_deg": dp}
        all_det &= det
        parts.append(f"{'cejas alzadas' if ph == 'raised' else 'ceno fruncido'}: "
                     f"{to_mm(d['R']):+.2f}/{to_mm(d['L']):+.2f} mm (R/L) [INF], "
                     f"{ratio['R']:.1f}/{ratio['L']:.1f} x MDC -> {'detectado' if det else 'NO detectado'}")
    res["detected"] = bool(all_det)
    res["summary"] = "; ".join(parts) + f" (umbral {CONTROL_FACTOR:g} x MDC; {mdc_source})"
    return res


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
                             drift_px: float = 0.0, blink_shift_px: float = 0.0,
                             brow_gap_px: float = 40.0, brow_thick_px: float = 10.0) -> np.ndarray:
    """Secuencia (t,478,2) de una cara sintetica: IOD 140 px, ojos de 60 px de ancho, iris de
    22 px de diametro, malla aleatoria fija. Ruido gaussiano independiente por cuadro y
    deriva opcional de traslacion. blinks: lista de (inicio, fin) de cuadros con ojo casi cerrado.
    blink_shift_px: durante cada parpadeo, comisuras, parpados e iris se desplazan (hacia la nariz
    y hacia abajo, algo distinto por ojo) hasta ese numero de pixeles, como un parpadeo real
    arrastra la piel del ojo; los puntos rigidos (nariz, frente, mejillas) NO se mueven.
    Cejas: borde inferior a brow_gap_px sobre el iris y grosor brow_thick_px (PTB_inf = gap/22)."""
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
        # ceja: recta horizontal, borde inferior a brow_gap_px sobre el centro del iris, grosor
        # brow_thick_px; de lateral a medial (R: de izquierda a derecha; L: al reves)
        sgn = 1.0 if k == "R" else -1.0
        for idxs, y_off in ((BROWS[k].lower, brow_gap_px), (BROWS[k].upper, brow_gap_px + brow_thick_px)):
            for idx, dx in zip(idxs, (-36.0, -18.0, 0.0, 18.0, 36.0)):
                frames[:, idx] = (c[0] + sgn * dx, c[1] - y_off)
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
