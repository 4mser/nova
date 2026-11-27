"""Perfil personal: proporciones de segmentos y rangos de ángulos de una persona de pie.

No entrena ninguna red. Solo guarda estadísticas (mediana y dispersión) medidas con el
modelo genérico durante unos segundos, para comparar luego en vivo.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

import numpy as np

from .geometria import ANGULOS, longitudes_segmentos

VERSION = 1

# Regla de quietud de la calibración. Son límites técnicos para detectar que la persona se movió, no umbrales
# clínicos. En 4 capturas reales de una persona (3 quietas, 1 con sentadillas) cadera y rodilla quietas dieron
# p95-p5 <= 7,9 y MAD <= 3,2 grados, y la capturada con movimiento p95-p5 >= 76. Los brazos quietos llegaron a
# MAD 9,5 (y p95-p5 37, por eso en brazos no se mira el rango).
RANGO_MAX_PIERNAS = 20.0  # p95 - p5 en caderas y rodillas, grados
MAD_MAX_PIERNAS = 10.0  # grados
MAD_MAX_BRAZOS = 15.0  # codos y hombros, grados
MIN_DATOS_QUIETUD = 10  # un ángulo visto en menos cuadros no se juzga
FPS_MIN_CAPTURA = 15.0  # por debajo se avisa (sin bloquear): poca luz o equipo lento


class CalibracionConMovimiento(ValueError):
    """La persona se movió durante la captura: no se crea (ni se sobrescribe) el perfil."""

    def __init__(self, detalle: str):
        self.detalle = detalle
        super().__init__(f"Calibración rechazada porque hubo movimiento: {detalle}. "
                         "Quédate de pie y quieto durante toda la captura.")


def movimiento(perfil: dict) -> str | None:
    """Motivo (texto ASCII) si las estadísticas muestran movimiento; None si la captura fue quieta.

    Rechaza si en alguna cadera o rodilla p95-p5 > 20 o MAD > 10 grados, o si en algún codo u hombro MAD > 15.
    Informa la medida que más supera su límite.
    """
    peor, motivo = 1.0, None
    for k in ANGULOS:
        e = perfil.get("angulos", {}).get(k)
        if not e or e["n"] < MIN_DATOS_QUIETUD:
            continue
        pierna = k.startswith(("cadera", "rodilla"))
        medidas = [("dispersion MAD", e["mad"], MAD_MAX_PIERNAS if pierna else MAD_MAX_BRAZOS)]
        if pierna:
            medidas.insert(0, ("rango p5-p95", e["p95"] - e["p5"], RANGO_MAX_PIERNAS))
        for que, valor, limite in medidas:
            if valor / limite > peor:
                art, lado = k.split("_")
                peor = valor / limite
                motivo = f"{art} {lado}: {que} de {valor:.0f} grados (maximo {limite:.0f})"
    return motivo


def calidad(visibilidad: np.ndarray, indices: list[int], umbral: float = 0.6) -> tuple[str, float]:
    """Calidad de la pose: media de visibilidad de los puntos del cuerpo y fracción sobre el umbral."""
    v = np.asarray(visibilidad)[indices]
    media = float(np.mean(v))
    frac = float(np.mean(v >= umbral))
    if media >= 0.8 and frac >= 0.9:
        return "buena", media
    if media >= 0.55 and frac >= 0.6:
        return "regular", media
    return "baja", media


def _mad(x: np.ndarray) -> float:
    return float(np.median(np.abs(x - np.median(x)))) * 1.4826  # equivalente a sigma si es normal


class Calibrador:
    """Acumula muestras de cuadros con buena calidad y construye el perfil."""

    def __init__(self, segundos: float = 4.0, min_muestras: int = 15):
        self.segundos = segundos
        self.min_muestras = min_muestras
        self.inicio: float | None = None
        self.segmentos: list[dict[str, float]] = []
        self.angulos: list[dict[str, float | None]] = []
        self._cuadros, self._t_primero, self._t_ultimo = 0, 0.0, 0.0

    def iniciar(self, t: float | None = None) -> None:
        self.inicio = time.monotonic() if t is None else t
        self.segmentos.clear()
        self.angulos.clear()
        self._cuadros = 0

    def contar(self, t: float) -> None:
        """Anota cada cuadro de la captura (con o sin persona) para medir los cuadros por segundo."""
        if not self._cuadros:
            self._t_primero = t
        self._cuadros += 1
        self._t_ultimo = t

    @property
    def fps_captura(self) -> float | None:
        dt = self._t_ultimo - self._t_primero
        return (self._cuadros - 1) / dt if self._cuadros > 1 and dt > 0 else None

    @property
    def pocos_fps(self) -> bool:
        f = self.fps_captura
        return f is not None and f < FPS_MIN_CAPTURA

    @property
    def activo(self) -> bool:
        return self.inicio is not None

    def progreso(self, t: float) -> float:
        return 0.0 if self.inicio is None else min(1.0, (t - self.inicio) / self.segundos)

    def agregar(self, mundo: np.ndarray, angulos: dict[str, float | None], calidad_txt: str) -> None:
        if not self.activo or calidad_txt != "buena":
            return
        self.segmentos.append(longitudes_segmentos(mundo))
        self.angulos.append(angulos)

    def terminado(self, t: float) -> bool:
        return self.activo and self.progreso(t) >= 1.0

    def construir(self, nombre: str) -> dict:
        self.inicio = None
        if len(self.segmentos) < self.min_muestras:
            raise ValueError(
                f"Calibración insuficiente: {len(self.segmentos)} cuadros con calidad buena "
                f"(se necesitan {self.min_muestras}). Ponte de pie, cuerpo completo en cuadro y buena luz."
            )
        perfil = construir_perfil(nombre, self.segmentos, self.angulos)
        detalle = movimiento(perfil)
        if detalle:
            raise CalibracionConMovimiento(detalle)
        return perfil


def construir_perfil(nombre: str, segmentos: list[dict[str, float]], angulos: list[dict[str, float | None]]) -> dict:
    seg_stats = {}
    torso = np.array([s["torso"] for s in segmentos])
    for k in segmentos[0]:
        x = np.array([s[k] for s in segmentos])
        seg_stats[k] = {
            "mediana_m": round(float(np.median(x)), 4),
            "mad_m": round(_mad(x), 4),
            "proporcion_torso": round(float(np.median(x / np.maximum(torso, 1e-6))), 4),
        }
    ang_stats = {}
    for k in ANGULOS:
        x = np.array([a[k] for a in angulos if a.get(k) is not None], dtype=float)
        if len(x) == 0:
            ang_stats[k] = None
            continue
        ang_stats[k] = {
            "mediana": round(float(np.median(x)), 2),
            "mad": round(_mad(x), 2),
            "p5": round(float(np.percentile(x, 5)), 2),
            "p95": round(float(np.percentile(x, 95)), 2),
            "n": int(len(x)),
        }
    return {
        "version": VERSION,
        "nombre": nombre,
        "creado": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "muestras": len(segmentos),
        "nota": "Estadísticas de la persona de pie medidas con el modelo genérico. No es entrenamiento de red.",
        "segmentos": seg_stats,
        "angulos": ang_stats,
    }


def nombre_seguro(nombre: str) -> str:
    limpio = re.sub(r"[^A-Za-z0-9_-]+", "_", nombre.strip())[:40]
    if not limpio.strip("_"):
        raise ValueError("Nombre de perfil vacío o inválido.")
    return limpio


def guardar(perfil: dict, carpeta: Path) -> Path:
    carpeta.mkdir(parents=True, exist_ok=True)
    ruta = carpeta / f"{nombre_seguro(perfil['nombre'])}.json"
    ruta.write_text(json.dumps(perfil, ensure_ascii=False, indent=2), encoding="utf-8")
    return ruta


def cargar(nombre: str, carpeta: Path) -> dict | None:
    ruta = carpeta / f"{nombre_seguro(nombre)}.json"
    if not ruta.exists():
        return None
    return json.loads(ruta.read_text(encoding="utf-8"))


def diferencias(perfil: dict, angulos: dict[str, float | None], mundo: np.ndarray | None) -> dict:
    """Diferencia en vivo frente al perfil.

    - angulos: grados actuales menos la mediana de pie (None si se abstiene o no hay dato).
    - segmentos: % de diferencia de la longitud actual frente a la mediana calibrada. Una
      diferencia grande indica estimación dudosa (la longitud real de un hueso no cambia).
    """
    d_ang = {}
    for k, v in angulos.items():
        ref = perfil.get("angulos", {}).get(k)
        d_ang[k] = None if (v is None or ref is None) else v - ref["mediana"]
    d_seg = {}
    if mundo is not None:
        actuales = longitudes_segmentos(mundo)
        for k, ref in perfil.get("segmentos", {}).items():
            m = ref["mediana_m"]
            d_seg[k] = None if m <= 0 else 100.0 * (actuales[k] - m) / m
    return {"angulos": d_ang, "segmentos": d_seg}
