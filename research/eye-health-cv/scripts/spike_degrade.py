"""Degradaciones de imagen y lista de condiciones del barrido (--check --sweep).

Orden de la ruta, igual para todas las condiciones:
  degradar a resolucion nativa -> rotar -> reducir (INTER_AREA, nunca ampliar) -> JPEG.
Para la condicion compensada, despues de decodificar el JPEG se contrarrota por el roll
estimado con los ojos (como haria el servidor) antes de reinferir.
Nada se guarda en disco.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

REF_WIDTH = 512
REF_QUALITY = 80
GRID_WIDTHS = (640, 512, 384, 256)  # mas "nativo"
GRID_QUALITIES = (50, 70, 80, 95)
ROLLS = (15.0, 30.0, 45.0)
DEGRADE_KINDS = ("none", "dim", "gamma", "noise5", "noise10", "blur1", "blur2", "motion7")


@dataclass(frozen=True)
class Condition:
    name: str
    width: int | None          # None = resolucion nativa
    quality: int | None        # None = sin JPEG
    degrade: str = "none"
    roll: float = 0.0
    compensate: bool = False
    group: str = "grid"        # grid | luz | ruido | desenfoque | roll


def _to_u8(x: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(x), 0, 255).astype(np.uint8)


def add_gaussian_noise(img: np.ndarray, sigma: float, rng: np.random.Generator) -> np.ndarray:
    return _to_u8(img.astype(np.float32) + rng.normal(0.0, sigma, img.shape).astype(np.float32))


def dim_with_noise(img: np.ndarray, rng: np.random.Generator, brightness: float = 0.35,
                   sigma: float = 5.0) -> np.ndarray:
    return add_gaussian_noise(_to_u8(img.astype(np.float32) * brightness), sigma, rng)


def gamma_dark(img: np.ndarray, gamma: float = 1.8) -> np.ndarray:
    lut = _to_u8(255.0 * (np.arange(256) / 255.0) ** gamma)
    return cv2.LUT(img, lut)


def gaussian_blur(img: np.ndarray, sigma: float) -> np.ndarray:
    return cv2.GaussianBlur(img, (0, 0), sigma)


def motion_blur(img: np.ndarray, kernel: int = 7) -> np.ndarray:
    k = np.zeros((kernel, kernel), np.float32)
    k[kernel // 2, :] = 1.0 / kernel  # desenfoque horizontal
    return cv2.filter2D(img, -1, k, borderType=cv2.BORDER_REFLECT)


def degrade(img: np.ndarray, kind: str, rng: np.random.Generator) -> np.ndarray:
    if kind == "none":
        return img
    if kind == "dim":
        return dim_with_noise(img, rng)
    if kind == "gamma":
        return gamma_dark(img)
    if kind == "noise5":
        return add_gaussian_noise(img, 5.0, rng)
    if kind == "noise10":
        return add_gaussian_noise(img, 10.0, rng)
    if kind == "blur1":
        return gaussian_blur(img, 1.0)
    if kind == "blur2":
        return gaussian_blur(img, 2.0)
    if kind == "motion7":
        return motion_blur(img, 7)
    raise ValueError(f"degradacion desconocida: {kind}")


def rotate_reflect(img: np.ndarray, angle_deg: float, center: tuple[float, float]) -> np.ndarray:
    """Rota sobre `center` (px) sin cambiar el tamano; borde reflejado.
    Angulo positivo de cv2 = antihorario en pantalla (el roll de los ojos baja ese angulo)."""
    if angle_deg == 0.0:
        return img
    m = cv2.getRotationMatrix2D(center, angle_deg, 1.0)
    h, w = img.shape[:2]
    return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REFLECT_101)


def shrink(img: np.ndarray, width: int | None) -> np.ndarray:
    """Reduce con INTER_AREA a ancho `width`; nunca amplia (None o >= ancho: sin cambio)."""
    h, w = img.shape[:2]
    if width is not None and width < w:
        return cv2.resize(img, (width, max(1, round(h * width / w))), interpolation=cv2.INTER_AREA)
    return img


def jpeg_encode(img: np.ndarray, quality: int) -> bytes:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("cv2.imencode fallo al codificar JPEG")
    return buf.tobytes()


def jpeg_decode(data: bytes) -> np.ndarray:
    out = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if out is None:
        raise RuntimeError("cv2.imdecode fallo al decodificar JPEG")
    return out


def resize_jpeg(img: np.ndarray, width: int | None, quality: int | None) -> np.ndarray:
    """Reduce con INTER_AREA (nunca amplia) y pasa por JPEG si quality no es None."""
    img = shrink(img, width)
    return img if quality is None else jpeg_decode(jpeg_encode(img, quality))


def build_conditions(native_w: int) -> list[Condition]:
    """Conditions del barrido para una camara de ancho nativo native_w. No duplica ni amplia:
    anchos mayores al nativo se omiten y el nativo no se repite si coincide con 640."""
    ref_w = min(REF_WIDTH, native_w)
    widths: list[int | None] = [None]  # nativo
    widths += [w for w in GRID_WIDTHS if w < native_w]
    conds: list[Condition] = []
    for w in widths:
        for q in GRID_QUALITIES:
            label = f"nativo({native_w})" if w is None else str(w)
            conds.append(Condition(f"w{label}_q{q}", w, q, group="grid"))
    ref = next(c for c in conds if c.quality == REF_QUALITY
               and (c.width == ref_w or (c.width is None and ref_w == native_w)))
    conds = [Condition("REF", ref.width, REF_QUALITY, group="grid")] + [c for c in conds if c is not ref]
    conds.insert(1, Condition("nativo_sin_jpeg", None, None, group="grid"))
    for kind, group in (("dim", "luz"), ("gamma", "luz"), ("noise5", "ruido"), ("noise10", "ruido"),
                        ("blur1", "desenfoque"), ("blur2", "desenfoque"), ("motion7", "desenfoque")):
        conds.append(Condition(kind, ref.width, REF_QUALITY, degrade=kind, group=group))
    for r in ROLLS:
        conds.append(Condition(f"roll{int(r)}_bruto", ref.width, REF_QUALITY, roll=r, group="roll"))
        conds.append(Condition(f"roll{int(r)}_comp", ref.width, REF_QUALITY, roll=r,
                               compensate=True, group="roll"))
    return conds
