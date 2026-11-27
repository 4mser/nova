"""Tiempos por etapa del bucle en vivo (opción --diagnostico) y cierre por ausencia de persona."""
from __future__ import annotations

import csv
import time
from contextlib import contextmanager
from pathlib import Path

import numpy as np

# Orden en que se muestran las etapas en el resumen
ETAPAS = ("captura", "preparacion", "inferencia", "post", "filtro", "dibujo", "csv", "grabacion", "pantalla")


class Cronometro:
    """Acumula milisegundos por etapa y por cuadro.

    Medir cuesta dos llamadas a perf_counter por etapa (microsegundos), así que siempre se mide;
    solo se guardan las filas si está activo.
    """

    def __init__(self, activo: bool = False):
        self.activo = activo
        self.filas: list[tuple[bool, float, dict[str, float]]] = []  # (persona, t fin, etapas)
        self.latencias: list[tuple[bool, float]] = []  # (persona, ms desde que llegó el cuadro hasta la pantalla)
        self._actual: dict[str, float] = {}

    def medir(self, etapa: str, ms: float) -> None:
        self._actual[etapa] = self._actual.get(etapa, 0.0) + ms

    @contextmanager
    def etapa(self, nombre: str):
        t0 = time.perf_counter()
        try:
            yield
        finally:
            self.medir(nombre, (time.perf_counter() - t0) * 1000)

    def cerrar_cuadro(self, persona: bool, latencia_ms: float | None = None) -> dict[str, float]:
        actual, self._actual = self._actual, {}
        if self.activo:
            self.filas.append((persona, time.perf_counter(), actual))
            if latencia_ms is not None:
                self.latencias.append((persona, latencia_ms))
        return actual

    def resumen(self) -> dict[str, dict]:
        """{'con persona'|'sin persona': {'n', 'fps_mediana', etapa: (mediana, p95)}}."""
        out: dict[str, dict] = {}
        for nombre, quiere in (("con persona", True), ("sin persona", False)):
            filas = [(t, e) for p, t, e in self.filas if p == quiere]
            if not filas:
                continue
            grupo: dict = {"n": len(filas)}
            etapas = [k for k in ETAPAS if any(k in e for _, e in filas)]
            etapas += sorted({k for _, e in filas for k in e} - set(etapas))
            for k in etapas:
                v = np.array([e.get(k, 0.0) for _, e in filas])
                grupo[k] = (float(np.median(v)), float(np.percentile(v, 95)))
            total = np.array([sum(e.values()) for _, e in filas])
            grupo["total"] = (float(np.median(total)), float(np.percentile(total, 95)))
            # FPS a partir de cuadros consecutivos del mismo grupo
            tiempos = np.array([t for p, t, _ in self.filas])
            persona = np.array([p for p, _, _ in self.filas])
            dt = np.diff(tiempos)[(persona[1:] == quiere) & (persona[:-1] == quiere)]
            if dt.size:
                grupo["fps_mediana"] = float(1.0 / np.median(dt))
            lat = np.array([v for p, v in self.latencias if p == quiere])
            if lat.size:
                grupo["latencia"] = (float(np.median(lat)), float(np.percentile(lat, 95)))
            out[nombre] = grupo
        return out

    def texto(self) -> str:
        res = self.resumen()
        if not res:
            return "Diagnóstico: sin cuadros."
        lineas = ["Diagnóstico de tiempos (ms, mediana / p95):"]
        for nombre, g in res.items():
            fps = f", {g['fps_mediana']:.1f} FPS" if "fps_mediana" in g else ""
            lineas.append(f"  {nombre} ({g['n']} cuadros{fps})")
            for k, v in g.items():
                if isinstance(v, tuple) and k != "latencia":
                    lineas.append(f"    {k:<12} {v[0]:7.1f} / {v[1]:7.1f}")
            if "latencia" in g:
                lineas.append(f"    {'latencia':<12} {g['latencia'][0]:7.1f} / {g['latencia'][1]:7.1f}"
                              "   (llegada del cuadro -> pantalla)")
        return "\n".join(lineas)

    def guardar_csv(self, ruta: Path) -> Path:
        ruta.parent.mkdir(parents=True, exist_ok=True)
        claves = list(ETAPAS) + sorted({k for _, _, e in self.filas for k in e} - set(ETAPAS))
        with open(ruta, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["t_s", "persona", *claves])
            t0 = self.filas[0][1] if self.filas else 0.0
            for p, t, e in self.filas:
                w.writerow([f"{t - t0:.4f}", int(p), *(f"{e[k]:.2f}" if k in e else "" for k in claves)])
        return ruta


class Ausencia:
    """Avisa cuando pasan `minutos` sin ver a una persona (0 o None = nunca)."""

    def __init__(self, minutos: float | None, ahora: float | None = None):
        self.segundos = (minutos or 0) * 60.0
        self.ultima_vez = time.monotonic() if ahora is None else ahora

    def ver(self, persona: bool, ahora: float | None = None) -> bool:
        """Registra el cuadro; devuelve True si se superó el tiempo sin persona."""
        ahora = time.monotonic() if ahora is None else ahora
        if persona:
            self.ultima_vez = ahora
            return False
        return self.segundos > 0 and ahora - self.ultima_vez >= self.segundos
