"""Dibujo del esqueleto y del panel. Texto solo ASCII (las fuentes Hershey de OpenCV no tienen tildes)."""
from __future__ import annotations

import math

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
    serie = estado.get("sentadilla")
    if serie:
        _dibujar_sentadilla(img, serie, k)
    cuenta = estado.get("preparando")
    if cuenta is None and serie and serie["fase"] == "preparando":
        cuenta = serie["faltan_s"]
    if cuenta is not None:
        txt = str(math.ceil(cuenta))
        tw = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, 4 * k, int(6 * k))[0][0]
        _texto(img, txt, ((w - tw) // 2, h // 2), 4 * k, (0, 220, 255), int(6 * k))
    cal_prog = estado.get("calibrando")
    if cal_prog is not None:
        x0, x1, yb = int(w * 0.25), int(w * 0.75), int(h * 0.9)
        cv2.rectangle(img, (x0, yb), (x1, yb + int(14 * k)), (255, 255, 255), g)
        cv2.rectangle(img, (x0, yb), (x0 + int((x1 - x0) * cal_prog), yb + int(14 * k)), (80, 200, 80), -1)
        _texto(img, "Calibrando: de pie, cuerpo completo", (x0, yb - int(8 * k)), 0.6 * k, grosor=g)
    return img


def _num(v, formato: str = "{:.0f}") -> str:
    return "--" if v is None else formato.format(v)


def _dibujar_sentadilla(img: np.ndarray, s: dict, k: float) -> None:
    """Cuadro arriba a la derecha: contador, ultima repeticion y, al terminar, resumen de la serie."""
    w = img.shape[1]
    lineas = [f"SENTADILLA  repeticiones: {s['n']}"]
    if s["descartadas"]:
        lineas.append(f"no contadas: {s['descartadas']}")
    if s["fase"] == "fin":
        if s["n"]:
            lineas.append("rep rod cad baja sube dif calidad")
        for r in s["repeticiones"][-8:]:
            lineas.append(f"{r['n']}  {_num(r['rodilla_min'])}  {_num(r['cadera_min'])}  "
                          f"{_num(r['bajada_s'], '{:.1f}')}  {_num(r['subida_s'], '{:.1f}')}  "
                          f"{_num(r['dif_rodilla'], '{:+.0f}')}  {r['calidad']}")
        for clave, nombre, unidad, f in (("rodilla_min", "Rodilla min", "gr", "{:.0f}"),
                                         ("cadera_min", "Cadera min", "gr", "{:.0f}"),
                                         ("bajada_s", "Bajada", "s", "{:.1f}"), ("subida_s", "Subida", "s", "{:.1f}")):
            e = s["resumen"][clave]
            if e["n"]:
                lineas.append(f"{nombre}: media {_num(e['media'], f)} DE {_num(e['de'], f)} {unidad} (n={e['n']})")
    elif s["ultima"]:
        r = s["ultima"]
        lineas += [f"Ultima: rodilla min {_num(r['rodilla_min'])} gr", f"cadera min {_num(r['cadera_min'])} gr",
                   f"baja {_num(r['bajada_s'], '{:.1f}')} s  sube {_num(r['subida_s'], '{:.1f}')} s",
                   f"calidad {r['calidad']}"]
    lineas.append("no validado, no es medicion medica")
    e, g = 0.5 * k, max(1, int(k))
    margen = int(16 * k)
    largo = max(cv2.getTextSize(t, cv2.FONT_HERSHEY_SIMPLEX, e, g)[0][0] for t in lineas)
    maximo = w - int(260 * k)  # no tapa el panel de angulos de la izquierda
    if largo + margen > maximo > margen:  # en imagenes angostas se reduce la letra
        e *= (maximo - margen) / largo
        largo = maximo - margen
    ancho, paso, y0 = largo + margen, int(20 * k), int(44 * k)
    overlay = img.copy()
    cv2.rectangle(overlay, (w - ancho, y0), (w, y0 + paso * len(lineas) + int(8 * k)), (20, 20, 20), -1)
    cv2.addWeighted(overlay, 0.65, img, 0.35, 0, img)
    for i, t in enumerate(lineas):
        _texto(img, t, (w - ancho + margen // 2, y0 + paso * (i + 1) - int(3 * k)), e, (255, 255, 255), g)


def pasos_sentadilla(s: dict) -> str:
    fase = s["fase"]
    if fase == "preparando":
        return (f"Ponte DE LADO a la camara, a 2-3 m, cuerpo completo y de pie. "
                f"Empieza en {math.ceil(s['faltan_s'])} s. S cancela")
    if fase == "buscando":
        if s["sin_vista"]:
            return "No veo tu pierna: ponte de lado, con cadera, rodilla y pie a la vista, y con luz"
        return "De lado, de pie y quieto un segundo para tomar el punto de partida"
    if fase in ("listo", "abajo"):
        if s["sin_vista"]:
            return "No veo tu pierna: vuelve a mostrar cadera, rodilla y pie, de lado"
        if fase == "abajo":
            return f"Sube hasta quedar de pie. Repeticiones: {s['n']}"
        if s["n"] == 0:
            return "YA: haz sentadillas a tu ritmo, de lado, y vuelve a quedar de pie en cada una"
        fin = "pulsa S" if s["fin_en_s"] is None else f"quedate de pie {math.ceil(s['fin_en_s'])} s o pulsa S"
        return f"Repeticiones: {s['n']}. Sigue, o para terminar {fin}"
    if s["n"]:
        return f"Serie terminada: {s['n']} repeticiones. Resultado a la derecha. S hace otra serie"
    return "No se conto ninguna repeticion. De lado y de pie al inicio; baja y vuelve a subir. S repite"


def pasos(estado: dict, umbral_vis: float) -> str:
    """Instruccion del momento para quien esta frente a la camara."""
    pose = estado.get("pose")
    if estado.get("sentadilla"):
        return pasos_sentadilla(estado["sentadilla"])
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
        return "Muevete: dobla codos y rodillas. S mide sentadillas. G graba tu prueba"
    return "Cuerpo completo visible. Pulsa C para calibrar o S para medir sentadillas"


def _partir(txt: str, ancho: int, escala: float) -> list[str]:
    lineas: list[str] = []
    for palabra in txt.split():
        prueba = f"{lineas[-1]} {palabra}" if lineas else palabra
        if lineas and cv2.getTextSize(prueba, cv2.FONT_HERSHEY_SIMPLEX, escala, 1)[0][0] <= ancho:
            lineas[-1] = prueba
        else:
            lineas.append(palabra)
    return lineas


def guiar(img: np.ndarray, estado: dict, umbral_vis: float) -> np.ndarray:
    """Franja de instrucciones bajo la imagen (solo para la ventana; no queda en la grabacion).

    La instruccion se parte en hasta 3 renglones; el alto de la franja es fijo para que la ventana no salte.
    """
    w = img.shape[1]
    k = max(w, 640) / 640
    franja = np.zeros((int(100 * k), w, 3), dtype=img.dtype)
    serie = estado.get("sentadilla")
    teclas = ("C calibrar | S " + ("TERMINAR serie" if serie and serie["fase"] != "fin" else "sentadilla")
              + " | G " + ("DETENER grabacion" if estado.get("grabando") else "grabar") + " | E enderezar | Q salir")
    texto = pasos(estado, umbral_vis)
    escala = 0.55 * k
    renglones = _partir(texto, w - 16, escala)
    while len(renglones) > 3:
        escala *= 0.92
        renglones = _partir(texto, w - 16, escala)
    lineas = [(t, escala, (0, 230, 255), 22 + 22 * i) for i, t in enumerate(renglones)]
    lineas.append((teclas, 0.5 * k, (255, 255, 255), 90))
    for txt, esc, color, y in lineas:
        ancho = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, esc, 1)[0][0]
        _texto(franja, txt, (8, int(y * k)), esc * min(1.0, (w - 16) / ancho), color, 1)
    return np.vstack([img, franja])
