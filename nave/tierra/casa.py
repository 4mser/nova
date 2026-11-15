#!/usr/bin/env python3
"""Relevo de Tierra para «Casa»: lo que la familia deja para un astronauta sube a la nave por el enlace.

La nave decide cuándo llega cada mensaje con el retraso real de la luz en el momento del envío (no se muestra antes).
Las fotos se comprimen aquí (lado más largo 1280 px, JPEG) porque el ancho de banda a Marte es escaso.

  python3 casa.py enviar --trip T2 --de "Ana" --relacion "wife" --texto "We miss you!" --foto playa.jpg
  python3 casa.py bajar                      # retira las respuestas del astronauta (y sus fotos) a ./bajada/

Opciones comunes: --nave http://127.0.0.1:8750  --token $NOVA_TOKEN
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))


def comprimir(ruta):
    """JPEG de 1280 px como máximo; usa sips (macOS) y si no está, manda el archivo tal cual"""
    try:
        with tempfile.TemporaryDirectory() as d:
            salida = os.path.join(d, "foto.jpg")
            subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "78", "-Z", "1280", ruta, "--out", salida],
                           check=True, capture_output=True)
            return open(salida, "rb").read(), "image/jpeg"
    except (OSError, subprocess.CalledProcessError):
        ext = os.path.splitext(ruta)[1].lower()
        return open(ruta, "rb").read(), {".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg")


def pedir(nave, ruta, cuerpo, token):
    r = urllib.request.Request(nave.rstrip("/") + ruta, data=json.dumps(cuerpo).encode(),
                               headers={"content-type": "application/json", **({"x-nova-token": token} if token else {})})
    with urllib.request.urlopen(r, timeout=60) as x:
        return json.loads(x.read())


def enviar(a):
    cuerpo = {"trip": a.trip, "de": a.de, "relacion": a.relacion, "texto": a.texto, "enviado": int((time.time() - a.hace * 60) * 1000)}
    if a.foto:
        datos, mime = comprimir(a.foto)
        cuerpo["archivo_b64"], cuerpo["mime"] = base64.b64encode(datos).decode(), mime
        print(f"foto comprimida: {len(datos) / 1024:.0f} KB")
    r = pedir(a.nave, "/v1/casa/subida", cuerpo, a.token)["mensaje"]
    luz, falta = r["luz_ms"] / 60000, (r["llega"] / 1000 - time.time()) / 60
    print(f"enviado a {a.trip}: retraso de la luz {luz:.1f} min · " + (f"llega en {falta:.1f} min" if falta > 0 else "ya llegó"))


def bajar(a):
    lista = pedir(a.nave, "/v1/casa/bajada", {}, a.token)["respuestas"]
    os.makedirs(os.path.join(AQUI, "bajada"), exist_ok=True)
    for r in lista:
        if r.get("archivo_b64"):
            open(os.path.join(AQUI, "bajada", f"{r['id']}.jpg"), "wb").write(base64.b64decode(r.pop("archivo_b64")))
        print(f"{r['trip']} → {r.get('a') or 'family'}: {r.get('texto', '')}" + (" [foto]" if r.get("archivo") else ""))
    json.dump(lista, open(os.path.join(AQUI, "bajada", f"respuestas-{int(time.time())}.json"), "w"), ensure_ascii=False, indent=1)
    print(f"{len(lista)} respuestas bajadas")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nave", default=os.environ.get("NOVA_NAVE", "http://127.0.0.1:8750"))
    ap.add_argument("--token", default=os.environ.get("NOVA_TOKEN", ""))
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("enviar")
    e.add_argument("--trip", required=True)
    e.add_argument("--de", required=True)
    e.add_argument("--relacion", default="")
    e.add_argument("--texto", default="")
    e.add_argument("--foto")
    e.add_argument("--hace", type=float, default=0, help="minutos: simula un mensaje enviado antes (pruebas y demo)")
    sub.add_parser("bajar")
    a = ap.parse_args()
    try:
        {"enviar": enviar, "bajar": bajar}[a.cmd](a)
    except urllib.error.HTTPError as x:
        sys.exit(f"la nave respondió {x.code}: {x.read().decode()[:200]}")


if __name__ == "__main__":
    main()
