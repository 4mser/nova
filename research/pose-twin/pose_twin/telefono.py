"""Modo teléfono: el PC sirve una página HTTPS en la red local y recibe cuadros por WebSocket.

- Certificado autofirmado generado localmente (data/certs/, nunca en git).
- Token aleatorio en la ruta: https://<ip-lan>:<puerto>/<token>/ ; sin token, 404.
- Escucha SOLO en la IP de la LAN (no en 0.0.0.0). Un cliente a la vez.
- Protocolo: el teléfono envía un JPEG (binario) y espera la respuesta JSON con puntos y ángulos
  antes de enviar el siguiente (sin cola, latencia mínima). Mensajes de texto {"cmd": ...} son órdenes.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import ipaddress
import json
import queue
import secrets
import socket
import ssl
import sys
import threading
import time
from http import HTTPStatus
from pathlib import Path

import cv2
import numpy as np

from .fuente import ErrorFuente, Fuente

RAIZ = Path(__file__).resolve().parents[1]
CARPETA_CERTS = RAIZ / "data" / "certs"
PAGINA = Path(__file__).with_name("web") / "telefono.html"
COMANDOS_VALIDOS = {"grabar", "calibrar", "enderezar"}
MAX_BYTES = 2 * 1024 * 1024


def ip_lan() -> str:
    """IP local de la interfaz con ruta por defecto (no envía paquetes)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.254.254.254", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def asegurar_certificado(ips: list[str], carpeta: Path = CARPETA_CERTS) -> tuple[Path, Path]:
    """Crea (o reutiliza) un certificado autofirmado válido para las IP dadas."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    carpeta.mkdir(parents=True, exist_ok=True)
    cert_p, key_p = carpeta / "cert.pem", carpeta / "key.pem"
    ahora = dt.datetime.now(dt.timezone.utc)
    if cert_p.exists() and key_p.exists():
        try:
            cert = x509.load_pem_x509_certificate(cert_p.read_bytes())
            san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
            ips_cert = {str(i) for i in san.get_values_for_type(x509.IPAddress)}
            if set(ips) <= ips_cert and cert.not_valid_after_utc > ahora + dt.timedelta(days=1):
                return cert_p, key_p
        except Exception:
            pass  # se regenera
    clave = ec.generate_private_key(ec.SECP256R1())
    nombre = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "pose-twin local")])
    alt = [x509.DNSName("localhost")] + [x509.IPAddress(ipaddress.ip_address(i)) for i in sorted(set(ips))]
    cert = (
        x509.CertificateBuilder()
        .subject_name(nombre).issuer_name(nombre).public_key(clave.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(ahora - dt.timedelta(minutes=5))
        .not_valid_after(ahora + dt.timedelta(days=30))
        .add_extension(x509.SubjectAlternativeName(alt), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(clave, hashes.SHA256())
    )
    key_p.write_bytes(clave.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                          serialization.NoEncryption()))
    cert_p.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert_p, key_p


def guardar_qr(texto: str, ruta: Path) -> Path | None:
    """QR como PNG (dibujado con numpy + OpenCV, sin Pillow) y en la terminal si se puede."""
    try:
        import qrcode
    except ImportError:
        return None
    qr = qrcode.QRCode(border=2)
    qr.add_data(texto)
    qr.make(fit=True)
    m = np.array(qr.get_matrix(), dtype=np.uint8)
    img = np.where(m, 0, 255).astype(np.uint8)
    img = cv2.resize(img, None, fx=10, fy=10, interpolation=cv2.INTER_NEAREST)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(ruta), img)
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        qr.print_ascii(invert=True)
    except Exception:
        pass
    return ruta


class ServidorTelefono:
    def __init__(self, host: str | None = None, puerto: int = 8443, token: str | None = None):
        self.host = host or ip_lan()
        self.puerto = puerto
        self.token = token or secrets.token_urlsafe(16)
        self.cuadros: queue.Queue = queue.Queue(maxsize=1)
        self.ordenes: queue.Queue = queue.Queue()
        self._ws = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._listo = threading.Event()
        self._error: BaseException | None = None
        self._parar: asyncio.Event | None = None
        self._hilo = threading.Thread(target=self._correr, daemon=True, name="servidor-telefono")
        self.html = PAGINA.read_bytes()

    @property
    def url(self) -> str:
        return f"https://{self.host}:{self.puerto}/{self.token}/"

    def iniciar(self) -> None:
        ips = sorted({self.host, "127.0.0.1"})
        cert, key = asegurar_certificado(ips)
        self._ssl = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self._ssl.load_cert_chain(cert, key)
        self._hilo.start()
        self._listo.wait(10)
        if self._error:
            raise ErrorFuente(f"No se pudo iniciar el servidor en {self.host}:{self.puerto}: {self._error}")

    def _correr(self) -> None:
        try:
            asyncio.run(self._principal())
        except BaseException as e:  # se informa al hilo principal
            self._error = e
            self._listo.set()

    async def _principal(self) -> None:
        from websockets.asyncio.server import serve

        self._loop = asyncio.get_running_loop()
        self._parar = asyncio.Event()
        async with serve(self._manejar, self.host, self.puerto, ssl=self._ssl, process_request=self._http,
                         max_size=MAX_BYTES, compression=None):
            self._listo.set()
            await self._parar.wait()

    def _http(self, conexion, solicitud):
        from websockets.datastructures import Headers
        from websockets.http11 import Response

        ruta = solicitud.path.split("?", 1)[0].encode("utf-8", "replace")
        base = f"/{self.token}/".encode()
        if secrets.compare_digest(ruta, base + b"ws"):
            return None  # sigue el handshake WebSocket
        if not secrets.compare_digest(ruta, base):
            return conexion.respond(HTTPStatus.NOT_FOUND, "No encontrado\n")
        cab = Headers([
            ("Content-Type", "text/html; charset=utf-8"), ("Content-Length", str(len(self.html))),
            ("Cache-Control", "no-store"), ("Referrer-Policy", "no-referrer"),
            ("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
                                        "connect-src 'self' wss:; img-src 'self' blob: data:; media-src 'self' blob:"),
        ])
        return Response(200, "OK", cab, self.html)

    async def _manejar(self, ws) -> None:
        if self._ws is not None:
            await ws.close(1013, "Ya hay un teléfono conectado")
            return
        self._ws = ws
        print(f"Teléfono conectado desde {ws.remote_address[0]}", flush=True)
        try:
            async for msg in ws:
                if isinstance(msg, (bytes, bytearray)):
                    img = cv2.imdecode(np.frombuffer(msg, np.uint8), cv2.IMREAD_COLOR)
                    if img is None:
                        continue
                    try:
                        self.cuadros.get_nowait()  # descarta el viejo si lo hubiera
                    except queue.Empty:
                        pass
                    self.cuadros.put_nowait((img, time.perf_counter()))
                else:
                    try:
                        cmd = json.loads(msg).get("cmd")
                    except (ValueError, AttributeError):
                        continue
                    if cmd in COMANDOS_VALIDOS:
                        self.ordenes.put(cmd)
        except Exception as e:
            print(f"Conexión del teléfono cerrada: {e}", flush=True)
        finally:
            self._ws = None
            print("Teléfono desconectado", flush=True)

    def enviar(self, datos: dict) -> None:
        ws, loop = self._ws, self._loop
        if ws is None or loop is None:
            return
        texto = json.dumps(datos, separators=(",", ":"))
        asyncio.run_coroutine_threadsafe(self._enviar_seguro(ws, texto), loop)

    @staticmethod
    async def _enviar_seguro(ws, texto: str) -> None:
        try:
            await ws.send(texto)
        except Exception:
            pass

    def detener(self) -> None:
        if self._loop and self._parar:
            self._loop.call_soon_threadsafe(self._parar.set)
        self._hilo.join(timeout=5)


class FuenteTelefono(Fuente):
    nombre = "telefono"
    es_archivo = False

    def __init__(self, host: str | None = None, puerto: int = 8443, token: str | None = None, mostrar_qr: bool = True, **_):
        self.servidor = ServidorTelefono(host, puerto, token)
        self.servidor.iniciar()
        self.ultimo_t_captura: float | None = None
        print("\n=== Modo teléfono ===")
        print(f"Abre en el teléfono (misma red Wi-Fi): {self.servidor.url}")
        print("El certificado es autofirmado: acepta la advertencia del navegador (Avanzado > Continuar).")
        if mostrar_qr:
            ruta = guardar_qr(self.servidor.url, RAIZ / "data" / "telefono_qr.png")
            if ruta:
                print(f"QR guardado en {ruta}")
        print("Si no carga: permite el puerto en el Firewall de Windows solo para redes privadas.\n", flush=True)

    def leer(self):
        try:
            img, t = self.servidor.cuadros.get(timeout=0.05)
        except queue.Empty:
            return True, None, None  # sigue vivo, sin cuadro nuevo
        self.ultimo_t_captura = t
        return True, img, None

    def responder(self, estado_json: dict) -> None:
        self.servidor.enviar(estado_json)

    def comandos(self) -> list[str]:
        out = []
        while True:
            try:
                out.append(self.servidor.ordenes.get_nowait())
            except queue.Empty:
                return out

    def cerrar(self) -> None:
        self.servidor.detener()
