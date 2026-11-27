"""Dibujo del esqueleto y del panel. Texto solo ASCII (las fuentes Hershey de OpenCV no tienen tildes)."""
from __future__ import annotations

import cv2
import numpy as np

from .geometria import ANGULOS, CONEXIONES

COLOR_CALIDAD = {"buena": (80, 200, 80), "regular": (0, 190, 255), "baja": (60, 60, 230), "sin persona": (150, 150, 150)}
ETIQUETA = {
    "codo_izq": "Codo izq", "codo_der": "Codo der", "hombro_izq": "Hombro izq", "hombro_der": "Hombro der",
    "cadera_izq": "Cadera izq", "cadera_der": "Cadera der", "rodilla_izq": "Rodilla izq", "rodilla_der": "Rodilla der",
}


def _texto(img, txt, org, escala=0.5, color=(255, 255, 255), grosor=1):
    cv2.putText(img, txt, (org[0] + 1, org[1] + 1), cv2.FONT_HERSHEY_SIMPLEX, escala, (0, 0, 0), grosor, cv2.LINE_AA)
    cv2.putText(img, txt, org, cv2.FONT_HERSHEY_SIMPLEX, escala, color, grosor, cv2.LINE_AA)


def dibujar(img: np.ndarray, estado: dict, umbral_vis: float) -> np.ndarray:
    h, w = img.shape[:2]
    k = max(1.0, min(w, h) / 720)  # escala de trazos según resolución
    pose = estado.get("pose")
    if pose is not None:
        p, v = pose.puntos2d, pose.visibilidad
        for a, b in CONEXIONES:
            if v[a] >= 0.3 and v[b] >= 0.3:
                ok = v[a] >= umbral_vis and v[b] >= umbral_vis
                cv2.line(img, tuple(map(int, p[a])), tuple(map(int, p[b])),
                         (255, 255, 255) if ok else (120, 120, 120), int(2 * k), cv2.LINE_AA)
        for i in range(11, 33):
            if v[i] >= 0.3:
                c = (80, 200, 80) if v[i] >= umbral_vis else (0, 140, 255)
                cv2.circle(img, tuple(map(int, p[i])), int(4 * k), c, -1, cv2.LINE_AA)
        # ángulo junto a cada articulación (solo si no hay abstención)
        for n, (_, vert, _) in ANGULOS.items():
            val = estado["angulos"].get(n)
            if val is not None:
                x, y = p[vert]
                _texto(img, f"{val:.0f}", (int(x + 6 * k), int(y - 6 * k)), 0.5 * k, (255, 255, 0), max(1, int(k)))

    # panel
    ancho_panel = int(250 * k)
    overlay = img.copy()
    cv2.rectangle(overlay, (0, 0), (ancho_panel, int(330 * k)), (20, 20, 20), -1)
    cv2.addWeighted(overlay, 0.55, img, 0.45, 0, img)
    y = int(22 * k)
    paso = int(20 * k)
    e = 0.5 * k
    g = max(1, int(k))
    cal = estado["calidad"]
    _texto(img, f"FPS {estado['fps']:.1f}  lat {estado['latencia_ms']:.0f} ms", (8, y), e, grosor=g); y += paso
    _texto(img, f"Calidad: {cal} ({estado['vis_media']:.2f})", (8, y), e, COLOR_CALIDAD.get(cal, (255, 255, 255)), g); y += paso
    _texto(img, f"Enderezado {'ON' if estado['enderezar'] else 'off'}  rot {estado['rot_grados']:.0f}", (8, y), e, grosor=g); y += paso
    _texto(img, f"Persona #{estado['identidad']}  cand {estado['n_candidatas']}", (8, y), e, grosor=g); y += paso
    d_ang = (estado.get("diferencias") or {}).get("angulos", {})
    for n in ANGULOS:
        val = estado["angulos"].get(n)
        if val is None:
            txt, col = f"{ETIQUETA[n]:<11} --  (abstiene)", (150, 150, 150)
        else:
            d = d_ang.get(n)
            txt = f"{ETIQUETA[n]:<11} {val:5.0f}" + (f"  d{d:+.0f}" if d is not None else "")
            col = (255, 255, 255)
        _texto(img, txt, (8, y), e, col, g); y += paso
    if estado.get("perfil"):
        _texto(img, f"Perfil: {estado['perfil']}", (8, y), e, (200, 200, 255), g); y += paso
    if estado.get("aviso"):
        _texto(img, estado["aviso"], (8, h - int(14 * k)), 0.6 * k, (0, 220, 255), g)
    if estado.get("grabando"):
        cv2.circle(img, (w - int(24 * k), int(24 * k)), int(9 * k), (0, 0, 255), -1, cv2.LINE_AA)
        _texto(img, "REC", (w - int(80 * k), int(30 * k)), 0.6 * k, (0, 0, 255), g)
    cal_prog = estado.get("calibrando")
    if cal_prog is not None:
        x0, x1, yb = int(w * 0.25), int(w * 0.75), int(h * 0.9)
        cv2.rectangle(img, (x0, yb), (x1, yb + int(14 * k)), (255, 255, 255), g)
        cv2.rectangle(img, (x0, yb), (x0 + int((x1 - x0) * cal_prog), yb + int(14 * k)), (80, 200, 80), -1)
        _texto(img, "Calibrando: de pie, cuerpo completo", (x0, yb - int(8 * k)), 0.6 * k, grosor=g)
    return img


def pasos(estado: dict, umbral_vis: float) -> str:
    """Instruccion del momento para quien esta frente a la camara."""
    pose = estado.get("pose")
    if estado.get("preparando") is not None:
        return f"Alejate y ponte de pie, brazos algo separados. Empieza en {estado['preparando']:.0f} s"
    if estado.get("calibrando") is not None:
        return f"QUIETO: calibrando {100 * estado['calibrando']:.0f}%"
    if pose is None:
        return "No te veo: ponte frente a la camara, con luz de frente"
    if min(pose.visibilidad[i] for i in (25, 26, 27, 28)) < umbral_vis:
        return "Alejate hasta que se vean rodillas y pies"
    if estado.get("resultado_calibracion"):
        return estado["resultado_calibracion"]
    if estado.get("perfil"):
        return "Muevete: dobla codos y rodillas. G graba tu prueba"
    return "Cuerpo completo visible. Pulsa C para calibrar"


def guiar(img: np.ndarray, estado: dict, umbral_vis: float) -> np.ndarray:
    """Franja de instrucciones bajo la imagen (solo para la ventana; no queda en la grabacion)."""
    w = img.shape[1]
    k = max(w, 640) / 640
    franja = np.zeros((int(76 * k), w, 3), dtype=img.dtype)
    teclas = "C calibrar | G " + ("DETENER grabacion" if estado.get("grabando") else "grabar") + " | E enderezar | Q salir"
    lineas = ((pasos(estado, umbral_vis), 0.55, (0, 230, 255), 30), (teclas, 0.5, (255, 255, 255), 60))
    for txt, escala, color, y in lineas:
        ancho = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, escala * k, 1)[0][0]
        escala_k = escala * k * min(1.0, (w - 16) / ancho)
        _texto(franja, txt, (8, int(y * k)), escala_k, color, 1)
    return np.vstack([img, franja])

