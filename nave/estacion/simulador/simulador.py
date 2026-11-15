#!/usr/bin/env python3
"""Simulador de la estación médica de NOVA.

Manda mensajes con el contrato de estacion/CONTRATO.md al núcleo (UDP 50050), como si fuera la estación de Luis.

De dónde salen los datos:
  · Pulso, SpO2 y respiración: la variabilidad real segundo a segundo de cuatro registros del BIDMC PPG and
    Respiration Dataset (PhysioNet, ODC-By 1.0), montada sobre la línea base de cada tripulante. Son pacientes reales
    de UCI: se usa cómo varían, no su valor absoluto.
  · Presión, temperatura, glucosa, VFC y cabina: modelos simples alrededor de la línea base (marcados como modelados).
  · Sueño, ánimo y energía: check-ins diarios de demo (diarios.py). sembrar_diarios.py deja las dos semanas anteriores.

Lo real manda: cada 5 s pregunta al enlace de la nave (GET /v1/fuentes) qué sensores de cada tripulante ya llegan de
verdad (teléfono vinculado, estación física, medición a mano) y deja de simular esos. Solo se inventa lo que nadie mide.

Escenarios (para la demo): se escriben en esta terminal o llegan por UDP 50053 como
  {"escenario":"desmayo","trip":"T3"}
  desmayo T3 · hipoglucemia T1 · fiebre T2 · hipoxia T4 · co2 · normal

Uso: python3 simulador.py [--nucleo 127.0.0.1] [--escenario "desmayo T3@60"]
"""

import argparse
import csv
import json
import math
import os
import random
import socket
import sys
import threading
import time
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
DATOS = os.path.join(AQUI, "datos", "bidmc")
sys.path.insert(0, AQUI)  # se corre con -I: el módulo hermano se agrega a mano
from diarios import diario  # noqa: E402

# Línea base de cada tripulante (demo, tripulación ficticia)
TRIPULACION = [
    {"id": "T1", "registro": "bidmc_03", "pulso": 62, "spo2": 98, "fr": 13, "sis": 116, "dia": 74, "temp": 36.7, "glucosa": 92, "vfc": 62},
    {"id": "T2", "registro": "bidmc_12", "pulso": 58, "spo2": 98, "fr": 12, "sis": 112, "dia": 70, "temp": 36.6, "glucosa": 88, "vfc": 71},
    {"id": "T3", "registro": "bidmc_24", "pulso": 60, "spo2": 97, "fr": 14, "sis": 120, "dia": 78, "temp": 36.8, "glucosa": 95, "vfc": 66},
    {"id": "T4", "registro": "bidmc_41", "pulso": 66, "spo2": 98, "fr": 13, "sis": 118, "dia": 76, "temp": 36.7, "glucosa": 97, "vfc": 48},
]

# Cada cuánto mide cada sensor (segundos)
CADA = {"pulso": 1, "spo2": 1, "fr": 2, "vfc": 10, "temp": 10, "pa": 15, "glucosa": 30, "cabina": 5, "latido": 5, "diario": 60}


def leer_bidmc(nombre):
    """Desvíos respecto de la media de cada columna (HR, RESP, SpO2) de un registro BIDMC."""
    ruta = os.path.join(DATOS, nombre + "_Numerics.csv")
    filas = []
    with open(ruta, newline="") as f:
        lector = csv.reader(f)
        next(lector)
        for r in lector:
            try:
                filas.append((float(r[1]), float(r[3]), float(r[4])))
            except (ValueError, IndexError):
                continue
    medias = [sum(c) / len(c) for c in zip(*filas)]
    return [tuple(v - m for v, m in zip(fila, medias)) for fila in filas]


class Escenario:
    """Un evento médico que se aplica sobre la línea base durante un tiempo."""

    def __init__(self, tipo, trip, inicio):
        self.tipo, self.trip, self.inicio = tipo, trip, inicio

    def fase(self, ahora):
        return ahora - self.inicio

    def aplicar(self, base, ahora):
        """Devuelve un diccionario de deltas (o reemplazos) para el tripulante afectado."""
        s = self.fase(ahora)
        rampa = lambda a, b: max(0.0, min(1.0, (s - a) / (b - a)))  # 0 → 1 entre a y b segundos
        if self.tipo == "desmayo":
            # Síncope vasovagal: bradicardia e hipotensión en ~20 s, recuperación en ~2 min
            caida = rampa(0, 20) * (1 - rampa(70, 180))
            return {"pulso": -26 * caida, "sis": -48 * caida, "dia": -34 * caida, "spo2": -3 * caida, "fr": -4 * caida, "vfc": 25 * caida}
        if self.tipo == "hipoglucemia":
            k = rampa(0, 120)
            return {"glucosa": -46 * k, "pulso": 38 * k, "vfc": -25 * k, "temp": -0.3 * k}
        if self.tipo == "fiebre":
            k = rampa(0, 150)
            return {"temp": 2.0 * k, "pulso": 22 * k, "fr": 5 * k}
        if self.tipo == "hipoxia":
            k = rampa(0, 60)
            return {"spo2": -11 * k, "pulso": 30 * k, "fr": 10 * k}
        return {}


class Simulador:
    def __init__(self, nucleo):
        self.dest = (nucleo, 50050)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.variab = {c["id"]: leer_bidmc(c["registro"]) for c in TRIPULACION}
        self.escenarios = []
        self.co2_extra = 0.0
        self.t0 = time.time()
        self.rng = random.Random(214)
        self.lock = threading.Lock()
        self.reales = {}  # trip → set de sensores que ya llegan de verdad (no se simulan)
        self.vacios = set()  # asientos sin nadie cuando hay tripulación real: no se les inventa nada

    # ---- lo real manda ----
    def mirar_fuentes(self, enlace):
        avisado = set()
        while True:
            try:
                with urllib.request.urlopen(enlace.rstrip("/") + "/v1/fuentes", timeout=3) as r:
                    datos = json.loads(r.read().decode())
                reales = {trip: {k for k, v in sens.items() if v.get("vigente")} for trip, sens in datos.items()}
                nuevos = {(t, k) for t, ks in reales.items() for k in ks}
                for t, k in sorted(nuevos - avisado):
                    print(f"  ◂ {t} {k}: llega real, deja de simularse", flush=True)
                for t, k in sorted(avisado - nuevos):
                    print(f"  ▸ {t} {k}: sin dato real, vuelve a simularse", flush=True)
                avisado = nuevos
                with self.lock:
                    self.reales = reales
                with urllib.request.urlopen(enlace.rstrip("/") + "/tripulacion.json", timeout=3) as r:
                    vacios = {c["id"] for c in json.loads(r.read().decode()) if c.get("vacio")}
                if vacios != self.vacios:
                    print(f"  asientos sin tripulación (no se simulan): {', '.join(sorted(vacios)) or 'ninguno'}", flush=True)
                with self.lock:
                    self.vacios = vacios
            except Exception:
                pass  # sin enlace: se simula todo
            time.sleep(5)

    def real(self, trip, sensor):
        ks = self.reales.get(trip, ())
        return sensor in ks or (sensor == "pa" and ("pa_sis" in ks or "pa_dia" in ks))

    # ---- envío ----
    def enviar(self, **campos):
        msg = {"v": 1, "est": "simulador", "t": int(time.time() * 1000), **campos}
        self.sock.sendto((json.dumps(msg, separators=(",", ":")) + "\n").encode(), self.dest)

    def medir(self, trip, sensor, valor, unidad, **extra):
        if self.real(trip, sensor):
            return
        self.enviar(tipo="medicion", trip=trip, sensor=sensor, valor=round(valor, 2), unidad=unidad, calidad=0.97, **extra)

    # ---- escenarios ----
    def escenario(self, tipo, trip="T1"):
        with self.lock:
            ahora = time.time()
            if tipo == "normal":
                self.escenarios.clear()
                self.co2_extra = 0.0
            elif tipo == "co2":
                self.co2_extra = 1500.0
            elif tipo in ("desmayo", "hipoglucemia", "fiebre", "hipoxia"):
                self.escenarios = [e for e in self.escenarios if e.trip != trip]
                self.escenarios.append(Escenario(tipo, trip, ahora))
            else:
                print(f"  escenario desconocido: {tipo}", flush=True)
                return
        print(f"  ▸ escenario {tipo} {trip if tipo not in ('normal', 'co2') else ''}".rstrip(), flush=True)

    def deltas(self, trip, ahora):
        d = {}
        with self.lock:
            for e in self.escenarios:
                if e.trip == trip:
                    for k, v in e.aplicar(None, ahora).items():
                        d[k] = d.get(k, 0.0) + v
        return d

    # ---- ciclo ----
    def paso(self, seg):
        ahora = time.time()
        r = self.rng
        for c in TRIPULACION:
            tid = c["id"]
            if tid in self.vacios:
                continue
            var = self.variab[tid]
            dhr, dresp, dspo2 = var[seg % len(var)]
            d = self.deltas(tid, ahora)
            # deriva lenta (respiración, actividad) para que no sea plano
            onda = math.sin(seg / 47.0 + hash(tid) % 7)
            if seg % CADA["pulso"] == 0:
                self.medir(tid, "pulso", c["pulso"] + 0.55 * dhr + 1.2 * onda + d.get("pulso", 0), "lpm")
            if seg % CADA["spo2"] == 0:
                v = c["spo2"] + 0.5 * dspo2 + d.get("spo2", 0)
                self.medir(tid, "spo2", min(100.0, v), "%")
            if seg % CADA["fr"] == 0:
                self.medir(tid, "fr", c["fr"] + 0.6 * dresp + d.get("fr", 0), "rpm")
            if seg % CADA["vfc"] == 0:
                self.medir(tid, "vfc", max(8.0, c["vfc"] + 4 * onda + r.gauss(0, 2) + d.get("vfc", 0)), "ms")
            if seg % CADA["temp"] == 0:
                self.medir(tid, "temp", c["temp"] + 0.05 * onda + r.gauss(0, 0.02) + d.get("temp", 0), "C")
            if seg % CADA["pa"] == 0:
                sis = c["sis"] + r.gauss(0, 2.5) + d.get("sis", 0)
                dia = c["dia"] + r.gauss(0, 1.8) + d.get("dia", 0)
                self.medir(tid, "pa", (sis + 2 * dia) / 3, "mmHg", extra={"sis": round(sis), "dia": round(dia)})
            if seg % CADA["diario"] == 0:
                # check-in del día (en la nave real llega desde la app NOVA, solo si la persona lo comparte)
                sueno, animo, energia = diario(tid, 0)
                self.medir(tid, "sueno_h", sueno, "h")
                self.medir(tid, "animo", animo, "1-5")
                self.medir(tid, "energia", energia, "1-5")
            if seg % CADA["glucosa"] == 0:
                self.medir(tid, "glucosa", c["glucosa"] + 3 * onda + r.gauss(0, 1.5) + d.get("glucosa", 0), "mg/dL")
        if seg % CADA["cabina"] == 0:
            with self.lock:
                extra = self.co2_extra
            co2 = 2100 + 120 * math.sin(seg / 90.0) + r.gauss(0, 25) + extra * min(1.0, 1.0)
            self.medir("CABINA", "co2_cabina", co2, "ppm")
            self.medir("CABINA", "o2_cabina", 21.0 + r.gauss(0, 0.05), "%")
            self.medir("CABINA", "temp_cabina", 22.4 + 0.2 * math.sin(seg / 300.0), "C")
        if seg % CADA["latido"] == 0:
            self.enviar(tipo="latido", sensores=["pulso", "spo2", "fr", "vfc", "temp", "pa", "glucosa"], bateria=0.9)

    def correr(self, programados):
        print(f"Simulador de la estación médica → {self.dest[0]}:{self.dest[1]}", flush=True)
        print("Escenarios: desmayo T3 · hipoglucemia T1 · fiebre T2 · hipoxia T4 · co2 · normal", flush=True)
        seg = 0
        siguiente = time.time()
        while True:
            for p in list(programados):
                if seg >= p[2]:
                    self.escenario(p[0], p[1])
                    programados.remove(p)
            self.paso(seg)
            seg += 1
            siguiente += 1.0
            time.sleep(max(0.0, siguiente - time.time()))


def escuchar_terminal(sim):
    for linea in sys.stdin:
        partes = linea.split()
        if partes:
            sim.escenario(partes[0].lower(), partes[1].upper() if len(partes) > 1 else "T1")


def escuchar_udp(sim):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 50053))
    while True:
        datos, _ = s.recvfrom(512)
        try:
            m = json.loads(datos)
            sim.escenario(str(m.get("escenario", "")).lower(), str(m.get("trip", "T1")).upper())
        except (ValueError, AttributeError):
            pass


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nucleo", default="127.0.0.1", help="IP del núcleo de vuelo")
    ap.add_argument("--escenario", action="append", default=[], help='programar, p. ej. "desmayo T3@60"')
    ap.add_argument("--enlace", default="http://127.0.0.1:8750", help="enlace de la nave, para saber qué llega real")
    a = ap.parse_args()
    programados = []
    for e in a.escenario:
        cuerpo, _, cuando = e.partition("@")
        partes = cuerpo.split()
        programados.append((partes[0].lower(), partes[1].upper() if len(partes) > 1 else "T1", int(cuando or 0)))
    sim = Simulador(a.nucleo)
    threading.Thread(target=escuchar_udp, args=(sim,), daemon=True).start()
    threading.Thread(target=sim.mirar_fuentes, args=(a.enlace,), daemon=True).start()
    if sys.stdin and sys.stdin.isatty():
        threading.Thread(target=escuchar_terminal, args=(sim,), daemon=True).start()
    try:
        sim.correr(programados)
    except KeyboardInterrupt:
        print("\nSimulador detenido.")


if __name__ == "__main__":
    main()
