"""Procesador por cuadro (común a live, video y teléfono): pose, ángulos, calidad, perfil, CSV, grabación."""
from __future__ import annotations

import csv
import shutil
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np

from . import perfil as perfil_mod
from . import sentadilla as sentadilla_mod
from .diagnostico import Cronometro
from .dibujo import dibujar
from .filtros import FiltroAngulos
from .geometria import ANGULOS, CUERPO, angulos_articulares
from .motor import Motor

RAIZ = Path(__file__).resolve().parents[1]
DATA = RAIZ / "data"
CARPETA_PERFILES = DATA / "perfiles"
CARPETA_SESIONES = DATA / "sesiones"
CARPETA_GRABACIONES = DATA / "grabaciones"
CARPETA_SENTADILLAS = DATA / "sentadillas"


class RegistroCSV:
    COLUMNAS = ["t_s", "cuadro", "fps", "latencia_ms", "inferencia_ms", "detectado", "identidad", "calidad",
                "vis_media", "rot_grados", "enderezar", *ANGULOS.keys()]

    def __init__(self, ruta: Path):
        ruta.parent.mkdir(parents=True, exist_ok=True)
        self.ruta = ruta
        self._f = open(ruta, "w", newline="", encoding="utf-8")
        self._w = csv.writer(self._f)
        self._w.writerow(self.COLUMNAS)

    def escribir(self, e: dict) -> None:
        fila = [f"{e['t_s']:.3f}", e["cuadro"], f"{e['fps']:.2f}", f"{e['latencia_ms']:.1f}",
                f"{e['inferencia_ms']:.1f}", int(e["pose"] is not None), e["identidad"], e["calidad"],
                f"{e['vis_media']:.3f}", f"{e['rot_grados']:.1f}", int(e["enderezar"])]
        fila += ["" if e["angulos"][k] is None else f"{e['angulos'][k]:.2f}" for k in ANGULOS]
        self._w.writerow(fila)

    def cerrar(self) -> None:
        self._f.close()


class Grabador:
    """Escribe mp4 (mp4v). Si hay ffmpeg en el PATH, lo recodifica a H.264 al cerrar para que se vea en cualquier reproductor."""

    def __init__(self, ruta: Path, fps: float, tam: tuple[int, int]):
        ruta.parent.mkdir(parents=True, exist_ok=True)
        self.ruta = ruta
        self._tmp = ruta.with_suffix(".tmp.mp4")
        self._vw = cv2.VideoWriter(str(self._tmp), cv2.VideoWriter_fourcc(*"mp4v"), fps, tam)
        if not self._vw.isOpened():
            raise RuntimeError(f"No se pudo crear el video {ruta}.")
        self.tam = tam
        self.n = 0

    def escribir(self, img: np.ndarray) -> None:
        if (img.shape[1], img.shape[0]) != self.tam:
            img = cv2.resize(img, self.tam)
        self._vw.write(img)
        self.n += 1

    def cerrar(self) -> Path:
        self._vw.release()
        ff = shutil.which("ffmpeg")
        if ff:
            r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(self._tmp), "-c:v", "libx264",
                                "-pix_fmt", "yuv420p", "-crf", "23", "-movflags", "+faststart", str(self.ruta)])
            if r.returncode == 0:
                self._tmp.unlink(missing_ok=True)
                return self.ruta
        self._tmp.replace(self.ruta)
        return self.ruta


class Procesador:
    def __init__(self, modelo: str = "heavy", enderezar: bool = False, umbral_vis: float = 0.6,
                 nombre_perfil: str | None = None, csv_ruta: Path | None = None, delegado: str = "auto",
                 segundos_calibracion: float = 4.0, segundos_preparacion: float = 0.0):
        self.segundos_preparacion = segundos_preparacion
        self._prep_hasta = 0.0
        self.resultado_calibracion = ""
        self.motor = Motor(modelo=modelo, modo="video", enderezar=enderezar, delegado=delegado)
        self.umbral_vis = umbral_vis
        self.filtro = FiltroAngulos(min_corte=1.0, beta=0.02)
        self.calibrador = perfil_mod.Calibrador(segundos=segundos_calibracion)
        self.nombre_perfil = nombre_perfil
        self.perfil = perfil_mod.cargar(nombre_perfil, CARPETA_PERFILES) if nombre_perfil else None
        self.registro = RegistroCSV(csv_ruta) if csv_ruta else None
        self.grabador: Grabador | None = None
        self.cuadro = 0
        self.t0 = time.monotonic()
        self.aviso = ""
        self._aviso_hasta = 0.0
        self._calib_pendiente = False
        self.crono = Cronometro(activo=False)
        self.serie: sentadilla_mod.SerieSentadilla | None = None
        self._serie_guardada = True
        self.ruta_serie: Path | None = None

    @property
    def enderezar(self) -> bool:
        return self.motor.enderezar

    def alternar_enderezado(self) -> None:
        self.motor.enderezar = not self.motor.enderezar
        self.decir(f"Enderezado {'activado' if self.motor.enderezar else 'desactivado'}")

    def decir(self, txt: str, seg: float = 3.0) -> None:
        print(txt, flush=True)
        self.aviso = txt.encode("ascii", "ignore").decode() if txt else ""
        self._aviso_hasta = time.monotonic() + seg

    @property
    def serie_activa(self) -> bool:
        return self.serie is not None and not self.serie.terminada

    def alternar_sentadilla(self, segundos_preparacion: float = 8.0, segundos_fin: float | None = 8.0) -> None:
        """Empieza una serie de sentadillas; si ya hay una, la termina."""
        if self._calib_pendiente or self.calibrador.activo:
            self.decir("Espera a que termine la calibracion")
        elif self.serie_activa:
            self.terminar_sentadilla()
        else:
            self.serie = sentadilla_mod.SerieSentadilla(segundos_preparacion, segundos_fin)
            self._serie_guardada = False
            self.ruta_serie = None
            self.decir("Serie de sentadillas: ponte de lado, cuerpo completo")

    def terminar_sentadilla(self) -> None:
        """Cierra y guarda la serie en curso (tecla, fin del archivo o salida del programa)."""
        if self.serie is not None:
            self.serie.terminar()
            self._guardar_serie()

    def _guardar_serie(self) -> None:
        """Guarda en disco una serie terminada (una sola vez)."""
        if self.serie is None or not self.serie.terminada or self._serie_guardada:
            return
        self._serie_guardada = True
        if not self.serie.repeticiones:
            self.decir("Serie sin repeticiones completas: no se guarda", 6)
            return
        self.ruta_serie = sentadilla_mod.guardar(self.serie.resultado(), CARPETA_SENTADILLAS)
        self.decir(f"Serie guardada: {self.ruta_serie.name} y .csv", 6)

    def iniciar_calibracion(self) -> None:
        if self.serie_activa:
            self.decir("Termina la serie (S) antes de calibrar")
            return
        self.serie = None
        if not self.nombre_perfil:
            self.nombre_perfil = "perfil"
        self._calib_pendiente = True
        self._prep_hasta = time.monotonic() + self.segundos_preparacion
        self.resultado_calibracion = ""
        self.decir(f"Calibrando perfil '{self.nombre_perfil}' durante {self.calibrador.segundos:.0f} s")

    def paso(self, img: np.ndarray, t_ms: int | None, fps: float, t_captura: float | None = None) -> tuple[np.ndarray, dict]:
        """Procesa un cuadro. Devuelve (imagen anotada, estado)."""
        t_captura = time.perf_counter() if t_captura is None else t_captura
        self.cuadro += 1
        crono = self.crono
        r = self.motor.procesar(img, t_ms)
        for k, v in self.motor.tiempos.items():
            crono.medir(k, v)
        t_filtro = time.perf_counter()
        t_s = (t_ms / 1000.0) if t_ms is not None else time.monotonic() - self.t0
        pose = r.pose
        if pose is not None:
            cal_txt, vis_media = perfil_mod.calidad(pose.visibilidad, CUERPO, self.umbral_vis)
            base = pose.mundo if pose.mundo is not None else np.hstack([pose.puntos2d, np.zeros((33, 1))])
            crudos = angulos_articulares(base, pose.visibilidad, self.umbral_vis)
        else:
            cal_txt, vis_media = "sin persona", 0.0
            crudos = {k: None for k in ANGULOS}
        angulos = self.filtro(crudos, t_s)

        calibrando = None
        preparando = None
        if self._calib_pendiente and time.monotonic() < self._prep_hasta:
            preparando = self._prep_hasta - time.monotonic()
        elif self._calib_pendiente:
            self.calibrador.iniciar(t_s)
            self._calib_pendiente = False
        if self.calibrador.activo:
            self.calibrador.contar(t_s)
            if pose is not None and pose.mundo is not None:
                self.calibrador.agregar(pose.mundo, crudos, cal_txt)
            calibrando = self.calibrador.progreso(t_s)
            if self.calibrador.terminado(t_s):
                calibrando = None
                luz = (f" Aviso: solo {self.calibrador.fps_captura:.0f} cuadros/s (poca luz o equipo lento): "
                       "usa mas luz." if self.calibrador.pocos_fps else "")
                anterior = " El perfil anterior se mantiene." if self.perfil is not None else ""
                try:
                    self.perfil = self.calibrador.construir(self.nombre_perfil)
                    ruta = perfil_mod.guardar(self.perfil, CARPETA_PERFILES)
                    self.resultado_calibracion = "Calibracion guardada. Ya puedes moverte." + luz
                    self.decir(f"Perfil guardado: {ruta.name} ({self.perfil['muestras']} cuadros).{luz}", 5)
                except perfil_mod.CalibracionConMovimiento as e:
                    self.resultado_calibracion = (f"No se pudo calibrar, te moviste ({e.detalle}). Quedate de pie y "
                                                  f"quieto toda la captura y pulsa C otra vez.{anterior}{luz}")
                    self.decir(str(e) + anterior + luz, 6)
                except ValueError as e:
                    self.resultado_calibracion = ("No se pudo calibrar: aparece completo, quieto y con luz. "
                                                  f"Pulsa C otra vez.{anterior}{luz}")
                    self.decir(str(e) + anterior + luz, 6)

        sentadilla = None
        if self.serie is not None:
            vis_lado = sentadilla_mod.visibilidad_lados(pose.visibilidad) if pose is not None else None
            self.serie.paso(angulos, t_s, vis_lado)
            self._guardar_serie()
            sentadilla = self.serie.estado(t_s)

        diferencias = None
        if self.perfil is not None:
            diferencias = perfil_mod.diferencias(self.perfil, angulos, pose.mundo if pose is not None else None)

        crono.medir("filtro", (time.perf_counter() - t_filtro) * 1000)
        estado = {
            "t_s": t_s, "cuadro": self.cuadro, "tam": (img.shape[1], img.shape[0]), "fps": fps, "pose": pose, "angulos": angulos,
            "calidad": cal_txt, "vis_media": vis_media, "rot_grados": r.rot_grados, "enderezar": self.enderezar,
            "identidad": r.identidad, "n_candidatas": r.n_candidatas, "inferencia_ms": r.ms_inferencia,
            "diferencias": diferencias, "perfil": self.perfil["nombre"] if self.perfil else None,
            "grabando": self.grabador is not None, "calibrando": calibrando,
            "preparando": preparando, "resultado_calibracion": self.resultado_calibracion,
            "sentadilla": sentadilla,
            "aviso": self.aviso if time.monotonic() < self._aviso_hasta else "",
        }
        # latencia: desde que llegó el cuadro (t_captura) hasta tenerlo dibujado
        estado["latencia_ms"] = (time.perf_counter() - t_captura) * 1000
        with crono.etapa("dibujo"):
            anotada = dibujar(img, estado, self.umbral_vis)
        estado["latencia_ms"] = (time.perf_counter() - t_captura) * 1000
        if self.registro:
            with crono.etapa("csv"):
                self.registro.escribir(estado)
        if self.grabador:
            with crono.etapa("grabacion"):
                self.grabador.escribir(anotada)
        return anotada, estado

    def alternar_grabacion(self, fps: float, tam: tuple[int, int]) -> None:
        if self.grabador is None:
            ruta = CARPETA_GRABACIONES / time.strftime("grabacion_%Y%m%d_%H%M%S.mp4")
            self.grabador = Grabador(ruta, fps, tam)
            self.decir(f"Grabando en {ruta.name}")
        else:
            ruta = self.grabador.cerrar()
            self.grabador = None
            self.decir(f"Video guardado: {ruta}")

    def cerrar(self) -> None:
        self.terminar_sentadilla()
        if self.grabador:
            ruta = self.grabador.cerrar()
            print(f"Video guardado: {ruta}")
            self.grabador = None
        if self.registro:
            self.registro.cerrar()
            print(f"CSV de la sesión: {self.registro.ruta}")
        self.motor.cerrar()


def estado_a_json(e: dict) -> dict:
    """Versión compacta para el teléfono: puntos normalizados por el tamaño de la imagen enviada."""
    pose = e["pose"]
    out = {
        "fps": round(e["fps"], 1), "lat_ms": round(e["latencia_ms"], 1), "inf_ms": round(e["inferencia_ms"], 1),
        "calidad": e["calidad"], "rot": round(e["rot_grados"], 1), "enderezar": e["enderezar"],
        "grabando": e["grabando"], "perfil": e["perfil"], "aviso": e["aviso"],
        "calibrando": None if e["calibrando"] is None else round(e["calibrando"], 2),
        "angulos": {k: (None if v is None else round(v, 1)) for k, v in e["angulos"].items()},
        "dif": None, "puntos": None,
    }
    if e.get("diferencias"):
        out["dif"] = {k: (None if v is None else round(v, 1)) for k, v in e["diferencias"]["angulos"].items()}
    if pose is not None:
        w, h = e["tam"]
        out["puntos"] = [[round(float(x) / w, 4), round(float(y) / h, 4), round(float(v), 2)]
                         for (x, y), v in zip(pose.puntos2d, pose.visibilidad)]
    return out
