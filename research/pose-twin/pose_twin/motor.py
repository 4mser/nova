"""Envoltura de MediaPipe PoseLandmarker (BlazePose GHUM) con enderezado opcional por rotación."""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from .geometria import Rotacion, angulo_torso, aplicar_afin, desrotar_mundo, rotacion_lienzo
from .seleccion import Candidata, Seguidor, puntaje_inicial

RAIZ_NOVA = Path(__file__).resolve().parents[3]
CARPETA_MODELOS = Path(os.environ.get("POSE_TWIN_MODELOS", RAIZ_NOVA / "nave" / "vision" / "modelos"))
# Carpeta local (fuera de git) para modelos que no vienen en el repo, como el lite
CARPETA_MODELOS_LOCAL = Path(__file__).resolve().parents[1] / "data" / "modelos"
MODELOS = {"lite": "pose_landmarker_lite.task", "full": "pose_landmarker_full.task",
           "heavy": "pose_landmarker_heavy.task"}
URL_MODELOS = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/{n}/float16/latest/{n}.task"

# Ángulos que se prueban cuando se pierde a la persona con el enderezado activo
BUSQUEDA = (0.0, 90.0, 180.0, -90.0)


class ErrorModelo(RuntimeError):
    pass


@dataclass
class Pose:
    puntos2d: np.ndarray  # (33, 2) píxeles, imagen original
    visibilidad: np.ndarray  # (33,)
    presencia: np.ndarray  # (33,)
    mundo: np.ndarray | None  # (33, 3) metros, origen en el centro de caderas, ejes de la imagen original


@dataclass
class Resultado:
    pose: Pose | None
    rot_grados: float = 0.0
    n_candidatas: int = 0
    ms_inferencia: float = 0.0
    identidad: int = 0
    extra: dict = field(default_factory=dict)


def ruta_modelo(nombre: str) -> Path:
    if nombre not in MODELOS:
        raise ErrorModelo(f"Modelo desconocido '{nombre}'. Usa: {', '.join(MODELOS)}.")
    for carpeta in (CARPETA_MODELOS, CARPETA_MODELOS_LOCAL):
        ruta = carpeta / MODELOS[nombre]
        if ruta.exists():
            return ruta
    url = URL_MODELOS.format(n=MODELOS[nombre].removesuffix(".task"))
    raise ErrorModelo(
        f"No encuentro el modelo {MODELOS[nombre]} en nave/vision/modelos/ ni en data/modelos/ "
        f"(o define la variable POSE_TWIN_MODELOS con la carpeta). Descárgalo de {url}"
    )


class Motor:
    """Infiere la pose de una sola persona por cuadro y mantiene su identidad.

    modo='video': usa el seguimiento por recorte de BlazePose (requiere tiempos crecientes).
    modo='imagen': cada cuadro es independiente (para bench sobre imágenes giradas).
    """

    def __init__(
        self,
        modelo: str = "heavy",
        modo: str = "video",
        num_poses: int = 3,
        enderezar: bool = False,
        umbral_enderezar: float = 15.0,
        delegado: str = "auto",
        confianza: float = 0.5,
    ):
        from mediapipe.tasks.python import BaseOptions, vision

        self.modelo = modelo
        self.modo = modo
        self.enderezar = enderezar
        self.umbral_enderezar = umbral_enderezar
        self.seguidor = Seguidor()
        self._ts = -1
        self._torso_prev: float | None = None
        self._perdidos = 0
        self._busqueda_i = 0
        self.tiempos: dict[str, float] = {}
        ruta = str(ruta_modelo(modelo))
        modo_mp = vision.RunningMode.VIDEO if modo == "video" else vision.RunningMode.IMAGE
        orden = {"auto": ("GPU", "CPU"), "gpu": ("GPU",), "cpu": ("CPU",)}[delegado]
        ultimo_error = None
        for d in orden:
            try:
                opciones = vision.PoseLandmarkerOptions(
                    base_options=BaseOptions(model_asset_path=ruta, delegate=getattr(BaseOptions.Delegate, d)),
                    running_mode=modo_mp,
                    num_poses=num_poses,
                    min_pose_detection_confidence=confianza,
                    min_pose_presence_confidence=confianza,
                    min_tracking_confidence=confianza,
                    output_segmentation_masks=False,
                )
                self._lm = vision.PoseLandmarker.create_from_options(opciones)
                self.delegado = d
                break
            except Exception as e:  # el delegado GPU no existe en Windows en algunas versiones
                ultimo_error = e
        else:
            raise ErrorModelo(f"No se pudo crear PoseLandmarker ({orden}): {ultimo_error}")

    def cerrar(self) -> None:
        self._lm.close()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.cerrar()

    # ---- enderezado ---------------------------------------------------------------
    def _angulo_a_usar(self) -> float:
        if not self.enderezar:
            return 0.0
        if self._torso_prev is not None:
            return self._torso_prev if abs(self._torso_prev) >= self.umbral_enderezar else 0.0
        # Persona perdida: recorre ángulos de búsqueda, uno por cuadro
        a = BUSQUEDA[self._busqueda_i % len(BUSQUEDA)]
        self._busqueda_i += 1
        return a

    def _inferir(self, img_bgr: np.ndarray, rot: Rotacion | None, t_ms: int | None):
        import mediapipe as mp

        t0 = time.perf_counter()
        if rot is not None:
            img_bgr = cv2.warpAffine(img_bgr, rot.M, (rot.ancho, rot.alto), flags=cv2.INTER_LINEAR,
                                     borderMode=cv2.BORDER_CONSTANT)
        h, w = img_bgr.shape[:2]
        rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        imagen = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        t1 = time.perf_counter()
        if self.modo == "video":
            ts = int(time.monotonic() * 1000) if t_ms is None else int(t_ms)
            ts = max(ts, self._ts + 1)
            self._ts = ts
            r = self._lm.detect_for_video(imagen, ts)
        else:
            r = self._lm.detect(imagen)
        t2 = time.perf_counter()
        poses = []
        for i, lms in enumerate(r.pose_landmarks):
            p = np.array([[l.x * w, l.y * h] for l in lms], dtype=float)
            vis = np.array([l.visibility if l.visibility is not None else 0.0 for l in lms], dtype=float)
            pres = np.array([l.presence if l.presence is not None else 0.0 for l in lms], dtype=float)
            mundo = None
            if r.pose_world_landmarks and i < len(r.pose_world_landmarks):
                mundo = np.array([[l.x, l.y, l.z] for l in r.pose_world_landmarks[i]], dtype=float)
            if rot is not None:
                p = aplicar_afin(rot.Minv, p)
                if mundo is not None:
                    mundo = desrotar_mundo(mundo, rot)
            poses.append(Pose(p, vis, pres, mundo))
        t3 = time.perf_counter()
        # tiempos de la última llamada (ms), para el diagnóstico
        self.tiempos = {"preparacion": (t1 - t0) * 1000, "inferencia": (t2 - t1) * 1000, "post": (t3 - t2) * 1000}
        return poses

    def procesar(self, img_bgr: np.ndarray, t_ms: int | None = None, rot_forzada: float | None = None) -> Resultado:
        h, w = img_bgr.shape[:2]
        grados = self._angulo_a_usar() if rot_forzada is None else rot_forzada
        usar_rot = self.enderezar or rot_forzada is not None
        rot = rotacion_lienzo(w, h, grados, cuadrado=(self.modo == "video")) if usar_rot else None
        t0 = time.perf_counter()
        poses = self._inferir(img_bgr, rot, t_ms)
        ms = (time.perf_counter() - t0) * 1000
        if self.modo == "imagen":  # cuadros independientes: sin continuidad entre llamadas
            pose = _mas_probable(poses, w, h) if poses else None
        else:
            cands = [Candidata(p.puntos2d, p.visibilidad) for p in poses]
            i = self.seguidor.elegir(cands, w, h)
            pose = poses[i] if i is not None else None
        if pose is not None:
            self._torso_prev = angulo_torso(pose.puntos2d)
            self._perdidos = 0
            self._busqueda_i = 0
        else:
            self._perdidos += 1
            if self._perdidos > 5:
                self._torso_prev = None
        return Resultado(pose=pose, rot_grados=grados if usar_rot else 0.0, n_candidatas=len(poses),
                         ms_inferencia=ms, identidad=self.seguidor.identidad)

    def detectar_enderezado_estatico(self, img_bgr: np.ndarray) -> Resultado:
        """Para imágenes sueltas (bench): primera pasada para medir el torso, segunda enderezada.

        Si la primera pasada no encuentra a nadie, prueba los ángulos de búsqueda.
        Equivale a lo que hace el modo en vivo con el cuadro anterior.
        """
        h, w = img_bgr.shape[:2]
        t0 = time.perf_counter()
        primera = None
        for a in BUSQUEDA:
            poses = self._inferir(img_bgr, rotacion_lienzo(w, h, a) if a else None, None)
            if poses:
                primera = poses
                break
        if not primera:
            return Resultado(pose=None, ms_inferencia=(time.perf_counter() - t0) * 1000)
        mejor = _mas_probable(primera, w, h)
        t = angulo_torso(mejor.puntos2d)
        pose, grados = mejor, 0.0
        if abs(t) >= self.umbral_enderezar:
            segunda = self._inferir(img_bgr, rotacion_lienzo(w, h, t), None)
            if segunda:
                pose, grados = _mas_probable(segunda, w, h), t
        return Resultado(pose=pose, rot_grados=grados, ms_inferencia=(time.perf_counter() - t0) * 1000)


def _mas_probable(poses: list[Pose], w: int, h: int) -> Pose:
    puntajes = [puntaje_inicial(Candidata(p.puntos2d, p.visibilidad), w, h) for p in poses]
    return poses[int(np.argmax(puntajes))]
