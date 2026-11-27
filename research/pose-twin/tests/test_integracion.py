"""Pruebas de integración: fuente inexistente, servidor del teléfono local y procesador sobre la muestra."""
import asyncio
import json
import ssl
import urllib.error
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import pytest

from pose_twin.fuente import ErrorFuente, abrir_fuente

RAIZ = Path(__file__).resolve().parents[1]
MUESTRA = RAIZ / "data" / "muestras" / "pose.jpg"
requiere_muestra = pytest.mark.skipif(not MUESTRA.exists(), reason="falta data/muestras/pose.jpg (ver README)")


def test_archivo_inexistente_da_error_claro():
    with pytest.raises(ErrorFuente, match="No existe"):
        abrir_fuente("no/existe.mp4")


def test_camara_ausente_da_error_claro_sin_abrir_hardware(monkeypatch):
    class CapturaFalsa:
        def __init__(self, *a, **k):
            pass

        def isOpened(self):
            return False

        def release(self):
            pass

    monkeypatch.setattr(cv2, "VideoCapture", CapturaFalsa)
    with pytest.raises(ErrorFuente, match="No se pudo abrir la cámara 0") as e:
        abrir_fuente("0")
    assert "--source telefono" in str(e.value)


def test_imagen_como_fuente(tmp_path):
    ruta = tmp_path / "x.png"
    cv2.imwrite(str(ruta), np.zeros((20, 30, 3), np.uint8))
    f = abrir_fuente(str(ruta), repeticiones=2)
    assert f.leer()[0] and f.leer()[0] and not f.leer()[0]


@requiere_muestra
def test_procesador_sobre_imagen_de_muestra():
    from pose_twin.sesion import Procesador

    proc = Procesador(modelo="full")
    img = cv2.imread(str(MUESTRA))
    try:
        for i in range(3):
            anotada, e = proc.paso(img.copy(), (i + 1) * 33, 30.0)
    finally:
        proc.cerrar()
    assert e["pose"] is not None
    assert e["calidad"] in {"buena", "regular"}
    assert anotada.shape == img.shape
    assert e["angulos"]["rodilla_der"] is not None


@pytest.mark.slow
@requiere_muestra
def test_servidor_telefono_local():
    """Levanta el servidor en 127.0.0.1, pide la página, envía un JPEG por WSS y recibe puntos."""
    from websockets.asyncio.client import connect

    from pose_twin.sesion import Procesador, estado_a_json
    from pose_twin.telefono import FuenteTelefono

    fuente = FuenteTelefono(host="127.0.0.1", puerto=8765, mostrar_qr=False)
    proc = Procesador(modelo="full")
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # certificado autofirmado
    url = fuente.servidor.url
    try:
        html = urllib.request.urlopen(url, context=ctx, timeout=5).read().decode("utf-8")
        assert "getUserMedia" in html
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen("https://127.0.0.1:8765/token-falso/", context=ctx, timeout=5)
        assert e.value.code == 404

        jpg = cv2.imencode(".jpg", cv2.imread(str(MUESTRA)))[1].tobytes()

        async def cliente():
            async with connect(url.replace("https://", "wss://") + "ws", ssl=ctx) as ws:
                await ws.send(json.dumps({"cmd": "enderezar"}))
                await ws.send(jpg)
                # el bucle principal procesa en este hilo mientras el cliente espera
                return json.loads(await asyncio.wait_for(ws.recv(), 30))

        async def todo():
            tarea = asyncio.create_task(cliente())
            for _ in range(600):
                ok, img, _ = await asyncio.to_thread(fuente.leer)
                ordenes = fuente.comandos()
                if "enderezar" in ordenes:
                    proc.alternar_enderezado()
                if img is not None:
                    _, est = proc.paso(img, None, 0.0)
                    fuente.responder(estado_a_json(est))
                    break
            return await tarea

        r = asyncio.run(todo())
        assert r["puntos"] is not None and len(r["puntos"]) == 33
        assert all(0 <= x <= 1.2 for x, y, v in r["puntos"][11:29])
        assert r["enderezar"] is True
        assert "rodilla_der" in r["angulos"]
    finally:
        proc.cerrar()
        fuente.cerrar()
