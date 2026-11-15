#!/usr/bin/env python3
"""Voz de NOVA a bordo: Kokoro-82M (Apache 2.0) en ONNX, sin internet.

POST http://127.0.0.1:8082/decir  {"texto": "...", "idioma": "en" | "es"}  →  audio/wav (PCM 16 bit, 24 kHz)
GET  http://127.0.0.1:8082/salud

Voz elegida por el equipo: af_heart en inglés (la más parecida a la NOVA de la app) y ef_dora en español.
El modelo vive en ~/.nova-pc/voz (o NOVA_VOZ_DIR): kokoro-v1.0.onnx y voices-v1.0.bin.
"""

import io
import json
import os
import queue
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

DIR = os.environ.get("NOVA_VOZ_DIR", os.path.expanduser("~/.nova-pc/voz"))
VOCES = {"en": ("af_heart", "en-us"), "es": ("ef_dora", "es")}
VELOCIDAD = float(os.environ.get("NOVA_VOZ_VELOCIDAD", "1.0"))
MAX_TEXTO = 600

kokoro = Kokoro(os.path.join(DIR, "kokoro-v1.0.onnx"), os.path.join(DIR, "voices-v1.0.bin"))
candado = threading.Lock()  # una síntesis a la vez: el modelo no es reentrante


# Kokoro corre en el hilo principal: en macOS, sintetizar desde un hilo nuevo por pedido es ~3 veces más lento
# (0,34 s → 0,95 s por frase). Los hilos HTTP dejan el pedido en esta cola y esperan el audio.
pedidos = queue.Queue()


def sintetizar(texto, idioma):
    if threading.current_thread() is not threading.main_thread():
        listo, caja = threading.Event(), {}
        pedidos.put((texto, idioma, listo, caja))
        listo.wait()
        if "error" in caja:
            raise caja["error"]
        return caja["wav"]
    return _sintetizar(texto, idioma)


def _sintetizar(texto, idioma):
    voz, lang = VOCES.get(idioma, VOCES["en"])
    with candado:
        audio, sr = kokoro.create(texto, voice=voz, speed=VELOCIDAD, lang=lang)
    # unos milisegundos de silencio al final para que las frases no se peguen
    audio = np.concatenate([audio, np.zeros(int(sr * 0.12), dtype=audio.dtype)])
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


class Manejador(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def responder(self, codigo, cuerpo, tipo="application/json"):
        self.send_response(codigo)
        self.send_header("content-type", tipo)
        self.send_header("content-length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self):
        if self.path == "/salud":
            self.responder(200, json.dumps({"ok": True, "voz": VOCES}).encode())
        else:
            self.responder(404, b"{}")

    def do_POST(self):
        if self.path != "/decir":
            return self.responder(404, b"{}")
        try:
            largo = min(int(self.headers.get("content-length", 0)), 8192)
            pedido = json.loads(self.rfile.read(largo) or b"{}")
            texto = str(pedido.get("texto", "")).strip()[:MAX_TEXTO]
            idioma = "es" if pedido.get("idioma") == "es" else "en"
            if not texto:
                return self.responder(400, b'{"error":"falta texto"}')
            t = time.time()
            wav = sintetizar(texto, idioma)
            sys.stderr.write(f"[voz] {len(texto)} car. en {time.time() - t:.2f}s\n")
            self.responder(200, wav, "audio/wav")
        except Exception as e:  # nunca botar el servidor por una frase
            self.responder(500, json.dumps({"error": str(e)}).encode())


if __name__ == "__main__":
    sintetizar("Ready.", "en")  # calentar el modelo
    puerto = int(os.environ.get("NOVA_VOZ_PUERTO", "8082"))
    print(f"[voz] NOVA habla en http://127.0.0.1:{puerto} (af_heart · ef_dora, sin internet)", flush=True)
    servidor = ThreadingHTTPServer(("127.0.0.1", puerto), Manejador)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    while True:  # el hilo principal sintetiza
        texto, idioma, listo, caja = pedidos.get()
        try:
            caja["wav"] = _sintetizar(texto, idioma)
        except Exception as e:  # noqa: BLE001
            caja["error"] = e
        listo.set()
