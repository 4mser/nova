"""Servidor local del escáner de pose-twin: solo 127.0.0.1, solo lectura.

Sirve primero esta carpeta (las copias modificadas) y, si el archivo no está, nave/tripulacion/ui
(modelos, wasm, anatomía, librerías y fuentes originales, sin duplicarlos). La cabecera
Content-Security-Policy impide que la página abra conexiones fuera de este mismo servidor.

    python research/pose-twin/escaner/servidor.py [--puerto 8010]
"""
from __future__ import annotations

import argparse
import shutil
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

AQUI = Path(__file__).resolve().parent
NAVE_UI = AQUI.parents[2] / "nave" / "tripulacion" / "ui"
RAICES = (AQUI, NAVE_UI)
ANFITRION = "127.0.0.1"
PUERTO = 8010
URL_PRUEBA = "/escaner.html?local&nosend&auto&mudo&sistema=oseo&estilo=clinico"

# Solo estas extensiones se entregan (ni .py, ni .md, ni nada que no use la página)
TIPOS = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".task": "application/octet-stream",
    ".gz": "application/gzip",  # sin Content-Encoding: la página lo descomprime
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
}

CSP = "; ".join((
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self' data: blob:",  # bloquea, entre otras, la telemetría de MediaPipe
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
))


def resolver(ruta_url: str, raices: tuple[Path, ...] = RAICES) -> Path | None:
    """Archivo que corresponde a la ruta de la URL, o None si no existe o intenta salir de las carpetas."""
    ruta = unquote(urlsplit(ruta_url).path)
    if not ruta.startswith("/") or any(c in ruta for c in ("\\", ":", "\0")):
        return None
    partes = [p for p in ruta.split("/") if p]
    # ".." y ocultos fuera; Windows ignora puntos y espacios finales, así que tampoco se aceptan
    if not partes or any(p.startswith(".") or p != p.rstrip(". ") for p in partes):
        return None
    if Path(partes[-1]).suffix.lower() not in TIPOS:
        return None
    for raiz in raices:
        base = raiz.resolve()
        try:
            archivo = base.joinpath(*partes).resolve()
            if archivo.is_relative_to(base) and archivo.is_file():  # resolve() sigue enlaces: se comprueba después
                return archivo
        except (OSError, ValueError):
            continue
    return None


class Manejador(BaseHTTPRequestHandler):
    server_version = "pose-twin"
    sys_version = ""

    def do_GET(self) -> None:
        self._servir(cuerpo=True)

    def do_HEAD(self) -> None:
        self._servir(cuerpo=False)

    def _servir(self, cuerpo: bool) -> None:
        puerto = self.server.server_address[1]
        # contra "DNS rebinding": solo se atiende si el navegador pidió este equipo por su nombre local
        if self.headers.get("Host") not in (f"{ANFITRION}:{puerto}", f"localhost:{puerto}"):
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if urlsplit(self.path).path == "/":
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", URL_PRUEBA)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if urlsplit(self.path).path == "/favicon.ico":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return
        archivo = resolver(self.path)
        if archivo is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        with archivo.open("rb") as f:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", TIPOS[archivo.suffix.lower()])
            self.send_header("Content-Length", str(archivo.stat().st_size))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            if cuerpo:
                try:
                    shutil.copyfileobj(f, self.wfile)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass  # el navegador cerró la conexión

    def end_headers(self) -> None:
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def log_message(self, formato: str, *args) -> None:
        pass


class Servidor(ThreadingHTTPServer):
    allow_reuse_address = False  # en Windows permitiría dos servidores en el mismo puerto
    daemon_threads = True


def crear_servidor(puerto: int = PUERTO) -> Servidor:
    return Servidor((ANFITRION, puerto), Manejador)


def main() -> int:
    ap = argparse.ArgumentParser(description="Servidor local del escáner de pose-twin")
    ap.add_argument("--puerto", type=int, default=PUERTO)
    args = ap.parse_args()
    if not NAVE_UI.is_dir():
        print(f"No se encuentra {NAVE_UI}")
        return 1
    try:
        servidor = crear_servidor(args.puerto)
    except OSError as e:
        print(f"No se pudo abrir el puerto {args.puerto}: {e}. Prueba con --puerto 8011")
        return 1
    print(f"Escáner pose-twin: http://{ANFITRION}:{servidor.server_address[1]}{URL_PRUEBA}", flush=True)
    print("Ctrl+C para cerrar.", flush=True)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        servidor.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
