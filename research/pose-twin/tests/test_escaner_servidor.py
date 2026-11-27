"""Servidor del escáner: orden de las dos carpetas, tipos MIME, cabeceras y protección de rutas."""
import http.client
import importlib.util
import threading
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("escaner_servidor", RAIZ / "escaner" / "servidor.py")
srv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(srv)


@pytest.fixture(scope="module")
def puerto():
    s = srv.crear_servidor(0)
    assert s.server_address[0] == "127.0.0.1"
    hilo = threading.Thread(target=s.serve_forever, daemon=True)
    hilo.start()
    yield s.server_address[1]
    s.shutdown()
    s.server_close()
    hilo.join(5)


def pedir(puerto, ruta, metodo="GET", host=None):
    c = http.client.HTTPConnection("127.0.0.1", puerto, timeout=10)
    try:
        c.request(metodo, ruta, headers={"Host": host} if host else {})
        r = c.getresponse()
        return r.status, dict(r.getheaders()), r.read()
    finally:
        c.close()


def test_la_copia_tiene_prioridad_sobre_la_nave(puerto):
    for nombre in ("escaner.html", "escaner.js"):
        estado, _, cuerpo = pedir(puerto, f"/{nombre}?v=17")
        assert estado == 200
        assert cuerpo == (RAIZ / "escaner" / nombre).read_bytes()
        assert cuerpo != (srv.NAVE_UI / nombre).read_bytes()


@pytest.mark.parametrize("ruta, tipo", [
    ("/panel.mjs", "text/javascript"),
    ("/angulos.mjs", "text/javascript"),
    ("/lib/three.module.min.js", "text/javascript"),
    ("/lib/mediapipe/vision_bundle.mjs", "text/javascript"),
    ("/lib/mediapipe/wasm/vision_wasm_internal.wasm", "application/wasm"),
    ("/lib/mediapipe/modelos/pose_landmarker_full.task", "application/octet-stream"),
    ("/anatomia/escaner/hombre.bin.gz?v=2", "application/gzip"),
    ("/anatomia/escaner/hombre.json?v=2", "application/json"),
    ("/fuentes/space-grotesk-400-latin.woff2", "font/woff2"),
    ("/panel.css", "text/css"),
])
def test_tipos_mime(puerto, ruta, tipo):
    estado, cabeceras, _ = pedir(puerto, ruta, "HEAD")
    assert estado == 200
    assert cabeceras["Content-Type"].startswith(tipo)
    assert "Content-Encoding" not in cabeceras


def test_csp_impide_conexiones_externas(puerto):
    _, cabeceras, _ = pedir(puerto, "/escaner.html", "HEAD")
    reglas = dict(r.strip().split(" ", 1) for r in cabeceras["Content-Security-Policy"].split(";"))
    assert reglas["connect-src"] == "'self' data: blob:"
    assert "http" not in cabeceras["Content-Security-Policy"]


@pytest.mark.parametrize("ruta", [
    "/../README.md", "/..%2f..%2fREADME.md", "/%2e%2e/%2e%2e/tripulacion.json", "/lib/../../ui/escaner.js",
    "/..%5c..%5cescaner.js", "/lib%5cthree.module.min.js", "/C:/Windows/win.ini", "/C%3a%5cWindows%5cwin.ini",
    "//C:/Windows/win.ini", "/%00escaner.js", "/escaner.js::$DATA", "/..%20/escaner.js", "/../../vision/servidor.py",
    "/%252e%252e/escaner.js", "/servidor.py", "/README.md", "/.gitignore", "/lib", "/", "/no-existe.js",
    "/v1/estado",
])
def test_rutas_fuera_o_no_permitidas(puerto, ruta):
    estado, _, _ = pedir(puerto, ruta)
    assert estado == (302 if ruta == "/" else 404)


def test_resolver_no_sale_de_las_raices(tmp_path):
    raiz = tmp_path / "raiz"
    raiz.mkdir()
    (raiz / "a.js").write_text("ok", encoding="utf-8")
    (tmp_path / "secreto.js").write_text("no", encoding="utf-8")
    assert srv.resolver("/a.js", (raiz,)) == (raiz / "a.js").resolve()
    for ruta in ("/../secreto.js", "/%2e%2e/secreto.js", "a.js", f"/{tmp_path.as_posix()}/secreto.js"):
        assert srv.resolver(ruta, (raiz,)) is None


def test_solo_lectura_y_host_local(puerto):
    for metodo in ("POST", "PUT", "DELETE"):
        assert pedir(puerto, "/v1/escaner/cuadro", metodo)[0] == 501
    assert pedir(puerto, "/escaner.html", host="ejemplo.invalid")[0] == 403
    assert pedir(puerto, "/escaner.html", host=f"localhost:{puerto}")[0] == 200
