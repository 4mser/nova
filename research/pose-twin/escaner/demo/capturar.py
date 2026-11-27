"""Graba el escáner de pose-twin (esqueleto de la anatomía 3D) usando un video como cámara falsa.

    python research/pose-twin/escaner/demo/capturar.py [--in VIDEO] [--segundos N]

Todo en local: servidor propio en un puerto libre, Chrome (o Edge) sin ventana con perfil temporal,
cámara FALSA (nunca la real) y la red externa bloqueada. Los temporales, que contienen el video, se borran.
Requiere ffmpeg en el PATH y el paquete websockets (ya está en el entorno).
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import cv2
import numpy as np

AQUI = Path(__file__).resolve().parent
ESCANER = AQUI.parent
RAIZ = ESCANER.parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(ESCANER))

from servidor import crear_servidor  # noqa: E402

from pose_twin.demo import ultima_grabacion  # noqa: E402

NAVEGADORES = (
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
)
CONSULTA = "/escaner.html?local&nosend&mudo&sistema=oseo&estilo=clinico"
PIE = ("Anatomia de referencia: BodyParts3D y HuBMAP, CC BY 4.0",
       "Estimacion no validada, no es medicion medica. La profundidad es aproximada")

# Sin nombres de la tripulación ficticia de NOVA sobre el video de una persona real
SIN_TRIPULANTE = """(() => { const f = window.fetch; window.fetch = (u, ...r) => String(u).endsWith('tripulacion.json')
  ? Promise.resolve(new Response(JSON.stringify([{ id: 'D1', corto: 'Demo', nombre: 'Demo', rol: 'pose-twin' }])))
  : f(u, ...r); })()"""
# La anatomía clínica dibuja el hueso muy transparente (pensado para verse tras los órganos): aquí va solo
HUESOS_VISIBLES = """for (const g of Object.values(window.__escaner.grupos)) {
  const u = g.userData.mat && g.userData.mat.uniforms; if (u && u.hueso && u.hueso.value === 1) u.a.value = %s; }"""
OPACIDAD_HUESO = 0.85

OCULTAR_BARRA = "document.getElementById('barra').style.display = 'none'"
ALTO_PIE = 56


def pie(ruta: Path) -> None:
    """Franja con la atribución y el aviso, que se pega DEBAJO de la captura para no tapar los pies."""
    img = np.zeros((ALTO_PIE, 1280, 3), np.uint8)
    for i, texto in enumerate(PIE):
        ancho = cv2.getTextSize(texto, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)[0][0]
        cv2.putText(img, texto, ((1280 - ancho) // 2, 22 + 24 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 220, 255), 1,
                    cv2.LINE_AA)
    if not cv2.imwrite(str(ruta), img):
        raise OSError(f"No se pudo escribir {ruta}")


class CDP:
    def __init__(self, ws):
        self.ws, self.n, self.espera, self.cuadros = ws, 0, {}, []
        self.carpeta: Path | None = None  # si está definida, se guardan los cuadros de la pantalla

    async def leer(self):
        async for texto in self.ws:
            m = json.loads(texto)
            if "id" in m:
                f = self.espera.pop(m["id"], None)
                if f and not f.done():
                    f.set_result(m)
            elif m.get("method") == "Page.screencastFrame":
                p = m["params"]
                if self.carpeta:
                    ruta = self.carpeta / f"c{len(self.cuadros):05d}.jpg"
                    ruta.write_bytes(base64.b64decode(p["data"]))
                    self.cuadros.append((ruta, p["metadata"]["timestamp"]))
                await self.enviar("Page.screencastFrameAck", {"sessionId": p["sessionId"]}, esperar=False)

    async def enviar(self, metodo: str, params: dict | None = None, esperar: bool = True):
        self.n += 1
        i = self.n
        f = asyncio.get_running_loop().create_future() if esperar else None
        if f:
            self.espera[i] = f
        await self.ws.send(json.dumps({"id": i, "method": metodo, "params": params or {}}))
        if not f:
            return None
        r = await asyncio.wait_for(f, 30)
        if "error" in r:
            raise RuntimeError(f"{metodo}: {r['error']}")
        return r["result"]

    async def js(self, expresion: str):
        r = await self.enviar("Runtime.evaluate", {"expression": expresion, "returnByValue": True,
                                                   "awaitPromise": True, "userGesture": True})
        if "exceptionDetails" in r:
            raise RuntimeError(f"JavaScript: {r['exceptionDetails'].get('text')} en {expresion[:60]}")
        return r["result"].get("value")

    async def hasta(self, expresion: str, segundos: float, que: str):
        fin = time.monotonic() + segundos
        while time.monotonic() < fin:
            if await self.js(expresion):
                return
            await asyncio.sleep(0.5)
        raise RuntimeError(f"El escaner no llego a: {que}")


async def grabar_pagina(puerto_cdp: int, url: str, carpeta: Path, segundos: float, nombre_falso: str) -> list:
    from websockets.asyncio.client import connect

    with urllib.request.urlopen(f"http://127.0.0.1:{puerto_cdp}/json/list", timeout=10) as r:
        pagina = next(p for p in json.load(r) if p["type"] == "page")
    async with connect(pagina["webSocketDebuggerUrl"], max_size=None) as ws:
        c = CDP(ws)
        lector = asyncio.create_task(c.leer())
        try:
            await c.enviar("Page.enable")
            await c.enviar("Emulation.setDeviceMetricsOverride",
                           {"width": 1280, "height": 720, "deviceScaleFactor": 1, "mobile": False})
            await c.enviar("Page.addScriptToEvaluateOnNewDocument", {"source": SIN_TRIPULANTE})
            await c.enviar("Page.navigate", {"url": url})
            await c.hasta("!!window.__escaner", 60, "cargar la pagina")
            await c.js("document.getElementById('bEmpezar').click()")
            await c.hasta("window.__escaner.video.videoWidth > 0", 60, "abrir la camara falsa")
            etiqueta = await c.js("window.__escaner.video.srcObject.getVideoTracks()[0].label")
            if nombre_falso not in etiqueta and "fake" not in etiqueta.lower():
                raise RuntimeError(f"La camara activa no es la falsa ({etiqueta}): se aborta")
            await c.js("document.getElementById('bGirar').click()")  # sin espejo, como el video
            await c.hasta("window.__escaner.listo && window.__escaner.vision.local", 120, "cargar anatomia y vision")
            await c.js("window.__escaner.capas.delete('organos'); window.__escaner.capas.add('esqueleto')")
            await c.js(OCULTAR_BARRA)
            await c.js(HUESOS_VISIBLES % OPACIDAD_HUESO)
            await asyncio.sleep(4)  # que la anatomía se ajuste al cuerpo
            c.carpeta = carpeta
            await c.enviar("Page.startScreencast", {"format": "jpeg", "quality": 88, "everyNthFrame": 1})
            await asyncio.sleep(segundos)
            await c.enviar("Page.stopScreencast")
            c.carpeta = None
            await c.enviar("Browser.close", esperar=False)
            return c.cuadros
        finally:
            lector.cancel()


def montar(cuadros: list, salida: Path, tmp: Path, segundos: float) -> None:
    """Une los cuadros respetando el instante en que se vio cada uno."""
    lineas = []
    for i, (ruta, t) in enumerate(cuadros):
        sig = cuadros[i + 1][1] if i + 1 < len(cuadros) else cuadros[0][1] + segundos
        lineas += [f"file '{ruta.as_posix()}'", f"duration {max(0.001, sig - t):.4f}"]
    lineas.append(f"file '{cuadros[-1][0].as_posix()}'")
    lista = tmp / "lista.txt"
    lista.write_text("\n".join(lineas), encoding="utf-8")
    salida.parent.mkdir(parents=True, exist_ok=True)
    franja = tmp / "pie.png"
    pie(franja)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lista),
                    "-i", str(franja), "-filter_complex", "[0:v]scale=1280:720,fps=30[a];[a][1:v]vstack", "-t", f"{segundos:.3f}", "-c:v", "libx264", "-pix_fmt",
                    "yuv420p", "-crf", "23", "-movflags", "+faststart", str(salida)], check=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="Graba el escaner con un video como camara falsa")
    ap.add_argument("--in", dest="entrada", default=None, help="video (por defecto la ultima grabacion demo)")
    ap.add_argument("--out", dest="salida", default=None)
    ap.add_argument("--segundos", type=float, default=0, help="duracion a capturar (0 = la del video)")
    args = ap.parse_args()

    entrada = Path(args.entrada) if args.entrada else ultima_grabacion()
    if entrada is None or not entrada.is_file():
        print("No hay video de entrada: graba uno o usa --in.")
        return 2
    navegador = next((n for n in NAVEGADORES if Path(n).exists()), None)
    if not navegador or not shutil.which("ffmpeg"):
        print("Hace falta Chrome o Edge y ffmpeg en el PATH.")
        return 2
    salida = Path(args.salida) if args.salida else RAIZ / "data" / "salidas" / f"{entrada.stem}_escaner.mp4"
    segundos = args.segundos or float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(entrada)],
        capture_output=True, text=True, check=True).stdout.strip())

    servidor = crear_servidor(0)  # puerto libre: no toca otros escáneres abiertos
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    proceso = None
    try:
        with tempfile.TemporaryDirectory(prefix="pose_twin_demo_", ignore_cleanup_errors=True) as t:
            tmp = Path(t)
            falso, perfil, carpeta = tmp / "camara_falsa.y4m", tmp / "perfil", tmp / "cuadros"
            carpeta.mkdir()
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(entrada), "-an", "-vf",
                            "scale='trunc(min(960,iw)/2)*2':-2,fps=30", "-pix_fmt", "yuv420p", str(falso)], check=True)
            proceso = subprocess.Popen([
                navegador, "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={perfil}",
                "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
                f"--use-file-for-fake-video-capture={falso}", "--no-first-run", "--no-default-browser-check",
                "--disable-background-networking", "--disable-sync", "--disable-component-update",
                "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--enable-gpu",
                "--ignore-gpu-blocklist", "--mute-audio", "--window-size=1280,720", "about:blank",
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                puerto_txt = perfil / "DevToolsActivePort"
                for _ in range(120):
                    if puerto_txt.exists() and puerto_txt.read_text().strip():
                        break
                    time.sleep(0.25)
                else:
                    raise RuntimeError("El navegador no arranco.")
                puerto_cdp = int(puerto_txt.read_text().split()[0])
                url = f"http://127.0.0.1:{servidor.server_address[1]}{CONSULTA}"
                print(f"Capturando {segundos:.1f} s del escaner...", flush=True)
                cuadros = asyncio.run(grabar_pagina(puerto_cdp, url, carpeta, segundos, falso.name))
                if not cuadros:
                    raise RuntimeError("No se capturo ningun cuadro.")
                montar(cuadros, salida, tmp, segundos)
                print(f"Listo: {salida.resolve()} ({len(cuadros)} cuadros de pantalla, "
                      f"{len(cuadros) / segundos:.1f} por segundo)")
            finally:
                try:
                    proceso.wait(timeout=10)
                except subprocess.TimeoutExpired:  # solo el navegador que abrió este programa y sus hijos
                    subprocess.run(["taskkill", "/PID", str(proceso.pid), "/T", "/F"], capture_output=True)
                    proceso.wait(timeout=10)
    except (RuntimeError, subprocess.CalledProcessError, OSError) as e:
        print(f"Error: {e}")
        return 1
    finally:
        servidor.shutdown()
        servidor.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
