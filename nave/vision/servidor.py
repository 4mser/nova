"""Visión de NOVA en la nave: el computador de a bordo procesa lo que ve la cámara del teléfono (o del visor).

El teléfono manda cada cuadro (JPEG chico) por WebSocket; aquí corren los modelos pesados en la GPU del computador
(Metal en un Mac) y vuelven solo los resultados, que pesan poco:
  · pose del cuerpo con el modelo heavy de MediaPipe: 33 puntos en la imagen + 33 en metros (3D) + máscara del cuerpo
  · manos (21 puntos cada una), para saber dónde están las manos del rescatista y contar compresiones
El teléfono sigue mostrando su propia cámara sin retraso y dibuja el holograma con estos resultados, corrigiendo el
tiempo que tardaron en volver (predicción + giroscopio).

Sin cola: si llegan cuadros más rápido de lo que se procesan, se procesa siempre el más nuevo y se descartan los viejos.
Solo escucha en 127.0.0.1; el enlace de la nave (Rust, :8750/:8751) hace de puente en /v1/vision/ws.

Uso: .venv/bin/python servidor.py   (puerto 8792; NOVA_VISION_PUERTO lo cambia)
"""
import asyncio, base64, json, os, struct, sys, threading, time
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision
import websockets

AQUI = os.path.dirname(os.path.abspath(__file__))
PUERTO = int(os.environ.get('NOVA_VISION_PUERTO', '8792'))
MODELO_POSE = os.path.join(AQUI, 'modelos', 'pose_landmarker_heavy.task')
MODELO_MANOS = os.path.join(AQUI, 'modelos', 'hand_landmarker.task')


def crear(clase, opciones, modelo, **extra):
    """GPU primero (Metal en el Mac), CPU si no hay."""
    for delegado in (BaseOptions.Delegate.GPU, BaseOptions.Delegate.CPU):
        try:
            return clase.create_from_options(opciones(base_options=BaseOptions(model_asset_path=modelo, delegate=delegado),
                                                      running_mode=vision.RunningMode.VIDEO, **extra)), delegado.name
        except Exception as e:  # noqa: BLE001
            ultimo = e
    raise ultimo


class Vision:
    """Un solo juego de modelos para toda la nave, cargado una vez y usado siempre desde el mismo hilo: abrir y cerrar
    modelos de GPU por cada visor que se conecta trababa el servidor."""

    def __init__(self):
        self.pose, self.dpose = crear(vision.PoseLandmarker, vision.PoseLandmarkerOptions, MODELO_POSE, num_poses=2,
                                      min_pose_detection_confidence=.5, min_pose_presence_confidence=.5,
                                      min_tracking_confidence=.5, output_segmentation_masks=True)
        self.manos, self.dmanos = crear(vision.HandLandmarker, vision.HandLandmarkerOptions, MODELO_MANOS, num_hands=2,
                                        min_hand_detection_confidence=.5, min_tracking_confidence=.5)
        self.ts = 0

    def procesar(self, jpg):
        t0 = time.perf_counter()
        img = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return None
        h, w = img.shape[:2]
        rgba = cv2.cvtColor(img, cv2.COLOR_BGR2RGBA)
        imagen = mp.Image(image_format=mp.ImageFormat.SRGBA, data=rgba)
        self.ts = max(self.ts + 1, int(time.monotonic() * 1000))
        rp = self.pose.detect_for_video(imagen, self.ts)
        rm = self.manos.detect_for_video(imagen, self.ts)
        t1 = time.perf_counter()
        # el paciente primero: con dos personas a la vista, el de torso más horizontal (acostado); si no, el más grande
        def nota(lm):
            hx, hy = (lm[11].x + lm[12].x) / 2, (lm[11].y + lm[12].y) / 2
            cx, cy = (lm[23].x + lm[24].x) / 2, (lm[23].y + lm[24].y) / 2
            largo = ((hx - cx) ** 2 + (hy - cy) ** 2) ** .5
            return largo + (abs(hx - cx) / (largo or 1) if len(rp.pose_landmarks) > 1 else 0)
        orden = sorted(range(len(rp.pose_landmarks)), key=lambda i: -nota(rp.pose_landmarks[i]))
        poses = []
        for i in orden:
            lm = rp.pose_landmarks[i]
            mundo = rp.pose_world_landmarks[i] if rp.pose_world_landmarks else []
            poses.append({
                'lm': [round(v, 4) for p in lm for v in (p.x, p.y, p.z, p.visibility or 0)],
                'mundo': [round(v, 4) for p in mundo for v in (p.x, p.y, p.z)],
            })
        # la máscara del cuerpo, chica (96 px de alto) y en PNG: pesa 1-3 KB
        mascara = None
        if rp.segmentation_masks and orden:
            m = rp.segmentation_masks[min(orden[0], len(rp.segmentation_masks) - 1)].numpy_view()
            m = m[:, :, 0] if m.ndim == 3 else m
            mh = 96
            mw = max(1, round(mh * w / h))
            chica = cv2.resize((m * 255).astype(np.uint8), (mw, mh), interpolation=cv2.INTER_AREA)
            ok, png = cv2.imencode('.png', chica)
            if ok:
                mascara = base64.b64encode(png.tobytes()).decode()
        manos = []
        for i, lm in enumerate(rm.hand_landmarks):
            lado = rm.handedness[i][0].category_name if rm.handedness and rm.handedness[i] else ''
            manos.append({'lado': lado, 'lm': [round(v, 4) for p in lm for v in (p.x, p.y, p.z)]})
        return {'w': w, 'h': h, 'poses': poses, 'manos': manos, 'mascara': mascara,
                'ms_modelos': round((t1 - t0) * 1000, 1), 'ms': round((time.perf_counter() - t0) * 1000, 1)}


HILO = ThreadPoolExecutor(1, thread_name_prefix='vision')
MOTOR = None
MOTORES = {}  # disp → Vision: each phone keeps its own tracker, so two cameras never mix one person's tracking
MAX_MOTORES = 4


def motor_para(disp):
    if disp in MOTORES:
        return MOTORES[disp]
    if len(MOTORES) >= MAX_MOTORES:  # reuse the oldest one instead of opening (or closing) more GPU models
        viejo = next(iter(MOTORES)); v = MOTORES.pop(viejo)
    else:
        v = Vision()
    MOTORES[disp] = v
    return v


async def atender(ws):
    loop = asyncio.get_running_loop()
    v = MOTOR
    await ws.send(json.dumps({'tipo': 'hola', 'gpu': v.dpose, 'modelo': 'MediaPipe Pose heavy + Hands', 'equipo': os.uname().machine}))
    ultimo = {'msg': None}
    hay = asyncio.Event()

    async def recibir():
        async for m in ws:
            if isinstance(m, (bytes, bytearray)) and len(m) > 4:
                ultimo['msg'] = m  # solo el más nuevo
                hay.set()

    async def procesar():
        while True:
            await hay.wait()
            hay.clear()
            m, ultimo['msg'] = ultimo['msg'], None
            if m is None:
                continue
            n = struct.unpack('<I', m[:4])[0]
            cab = json.loads(m[4:4 + n])
            d = str(cab.get('disp') or id(ws))
            r = await loop.run_in_executor(HILO, lambda: motor_para(d).procesar(m[4 + n:]))
            if r is None:
                continue
            r.update({'tipo': 'vision', 'id': cab.get('id'), 'tc': cab.get('tc')})
            await ws.send(json.dumps(r, separators=(',', ':')))

    tr, tp = asyncio.create_task(recibir()), asyncio.create_task(procesar())
    try:
        await tr
    except websockets.ConnectionClosed:
        pass
    finally:
        tp.cancel()


def vigilar_padre():
    """Si la nave que me abrió se cierra, me cierro también (no quedan servidores huérfanos)."""
    padre = os.getppid()
    if os.environ.get('NOVA_VISION_SOLO'):
        return
    while True:
        time.sleep(2)
        if os.getppid() != padre:
            os._exit(0)


async def main():
    global MOTOR
    threading.Thread(target=vigilar_padre, daemon=True).start()
    MOTOR = await asyncio.get_running_loop().run_in_executor(HILO, Vision)
    MOTORES['_primero'] = MOTOR
    async with websockets.serve(atender, '127.0.0.1', PUERTO, max_size=4 * 1024 * 1024, compression=None):
        print(f'[nova-vision] visión de a bordo en ws://127.0.0.1:{PUERTO}', flush=True)
        await asyncio.Future()


if __name__ == '__main__':
    asyncio.run(main())
