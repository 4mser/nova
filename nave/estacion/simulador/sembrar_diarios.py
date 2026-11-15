#!/usr/bin/env python3
"""Deja en la historia de a bordo las dos semanas anteriores de check-ins de la tripulación ficticia (demo).

Escribe un archivo NDJSON con el mismo formato de resúmenes por minuto que guarda el enlace de la nave
({"s":"T4.animo","t":<inicio del minuto>,"m":..,"lo":..,"hi":..}). El enlace lo carga al arrancar, así que
después de sembrar hay que reiniciarlo. Hoy no se siembra: hoy lo manda el simulador en vivo.

Uso: python3 sembrar_diarios.py [--dias 14] [--forzar]
"""

import argparse
import glob
import json
import os
import sys
from datetime import datetime, timedelta

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from diarios import BASE, diario  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dias", type=int, default=14)
    ap.add_argument("--forzar", action="store_true", help="reemplazar una siembra anterior")
    a = ap.parse_args()
    carpeta = os.environ.get("NOVA_DATOS") or os.path.expanduser("~/.nova-pc/historia")
    os.makedirs(carpeta, exist_ok=True)
    previas = glob.glob(os.path.join(carpeta, "*-checkins-demo.ndjson"))
    if previas and not a.forzar:
        print(f"Ya hay una siembra: {os.path.basename(previas[0])} (usa --forzar para rehacerla)")
        return
    for p in previas:
        os.remove(p)
    hoy = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    inicio = hoy - timedelta(days=a.dias)
    lineas = []
    for trip in BASE:
        for d in range(a.dias, 0, -1):  # del más antiguo al de ayer: cada serie queda en orden
            dia = hoy - timedelta(days=d)
            sueno, animo, energia = diario(trip, d)
            t_man = int((dia + timedelta(hours=7, minutes=30)).timestamp())
            t_noc = int((dia + timedelta(hours=21)).timestamp())
            lineas.append({"s": f"{trip}.sueno_h", "t": t_man - t_man % 60, "m": sueno, "lo": sueno, "hi": sueno})
            lineas.append({"s": f"{trip}.animo", "t": t_noc - t_noc % 60, "m": animo, "lo": animo, "hi": animo})
            lineas.append({"s": f"{trip}.energia", "t": t_noc - t_noc % 60, "m": energia, "lo": energia, "hi": energia})
    ruta = os.path.join(carpeta, f"{inicio:%Y-%m-%d}-checkins-demo.ndjson")
    with open(ruta, "w") as f:
        for l in lineas:
            f.write(json.dumps(l, separators=(",", ":")) + "\n")
    print(f"{len(lineas)} check-ins de demo en {ruta}. Reinicia el enlace para cargarlos.")


if __name__ == "__main__":
    main()
