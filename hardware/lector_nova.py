"""Puente de la estación de Luis (Arduino por USB: lector RFID RC522 + electrocardiograma AD8232) a la nave NOVA.

Lee lo que el Arduino imprime por el puerto serie y lo reparte:
  · «Card UID: 04 A1 B2 C3»  → POST /v1/nfc: la nave abre el espacio de esa persona en NOVA Station.
  · un número por línea (o «E:512»; «E:!» = electrodo suelto) → electrocardiograma:
      - la onda en vivo va a POST /v1/estacion/onda (la tablet y el PC la dibujan);
      - cada 2 s, el pulso y la variabilidad (RMSSD) van a POST /v1/lote a nombre de quien tiene la sesión abierta en
        la tablet, y solo mientras esa persona tiene abierta la hoja ECG (la tablet cuenta qué muestra en
        /v1/station/pantalla). Sin sesión o con otra pantalla, no se guarda nada.
Contratos: nave/estacion/NFC.md y nave/estacion/CONTRATO.md.

Uso (Windows):
    pip install flask pyserial
    python lector_nova.py
Variables opcionales: NOVA_NAVE (http://192.168.6.140:8750), NOVA_PUERTO (COM8), NOVA_BAUDIOS (si no, prueba 115200 y
9600), NOVA_LECTOR (station), NOVA_TOKEN si la nave lo exige.
Página local con lo último: http://<este-pc>:5000
"""
import json
import os
import statistics
import threading
import time
import urllib.request
from collections import deque

import serial
from flask import Flask, jsonify, render_template_string

PUERTO = os.environ.get("NOVA_PUERTO", "COM8")
BAUDIOS = [int(os.environ["NOVA_BAUDIOS"])] if os.environ.get("NOVA_BAUDIOS") else [115200, 9600]
NAVE = os.environ.get("NOVA_NAVE", "http://192.168.6.140:8750").rstrip("/")
LECTOR = os.environ.get("NOVA_LECTOR", "station")
TOKEN = os.environ.get("NOVA_TOKEN", "")

app = Flask(__name__)
estado = {"uid": "Esperando tarjeta...", "nave": "Sin lecturas todavía", "ecg": "Sin señal", "bpm": None,
          "sesion": None, "midiendo": False, "baudios": None}
cerrojo = threading.Lock()


# ── red ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
def pedir(ruta, cuerpo=None, timeout=3):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    p = urllib.request.Request(NAVE + ruta, data=datos, method="POST" if datos else "GET",
                               headers={"Content-Type": "application/json"})
    if TOKEN:
        p.add_header("x-nova-token", TOKEN)
    with urllib.request.urlopen(p, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def avisar_nave(uid):
    """POST /v1/nfc; deja en la página lo que respondió la nave."""
    try:
        r = pedir("/v1/nfc", {"uid": uid, "lector": LECTOR})
        if r.get("nueva"):
            estado["nave"] = "tarjeta nueva: en la tablet elige a quién pertenece"
        elif r.get("vinculada"):
            estado["nave"] = "tarjeta asociada a " + r["vinculada"]
        elif r.get("trip"):
            estado["nave"] = "sesión " + str(r.get("sesion", "")) + " · " + r["trip"]
        else:
            estado["nave"] = "recibida (" + json.dumps(r) + ")"
    except Exception as e:  # la nave apagada o en otra red no debe botar el lector
        estado["nave"] = "sin conexión con " + NAVE + " (" + str(e) + ")"
    print("Nave:", estado["nave"])


def seguir_sesion():
    """Quién tiene la sesión en la tablet (a esa persona va el pulso) y si tiene abierta la hoja ECG."""
    while True:
        try:
            estado["sesion"] = pedir("/v1/sesion?lector=" + LECTOR).get("trip")
            foto = pedir("/v1/station/pantalla?lector=" + LECTOR).get("foto") or {}
            estado["midiendo"] = bool(estado["sesion"]) and foto.get("hoja") == "ecg"
        except Exception:
            pass
        time.sleep(1)


# ── electrocardiograma: latidos, pulso y variabilidad ────────────────────────────────────────────────────────────────
class Corazon:
    """Detector de latidos simple (derivada al cuadrado + umbral adaptable + periodo refractario), suficiente para el
    pulso y la RMSSD; no es un equipo médico."""

    def __init__(self):
        self.fs = 200.0                  # se mide con el reloj del PC
        self.n = 0
        self.t0 = time.time()
        self.cuenta = 0
        self.previos = deque([0, 0], maxlen=2)
        self.energia = 0.0
        self.historia = deque(maxlen=600)   # energía de los últimos ~3 s
        self.umbral = 0.0
        self.ultimo_latido = -10**9
        self.arriba = False
        self.rr = deque(maxlen=12)          # intervalos entre latidos, en segundos
        self.crudo = deque(maxlen=400)      # para ver si el electrodo está suelto
        self.suelto_marcado = False         # el Arduino nuevo dice «E:!» (pines LO+/LO-)
        self.pendientes = []                # muestras por mandar a la nave
        self.t_ultimo = 0.0

    def muestra(self, v):
        with cerrojo:
            self.n += 1
            self.cuenta += 1
            self.t_ultimo = time.time()
            ahora = time.time()
            if ahora - self.t0 >= 2:  # frecuencia de muestreo real
                self.fs = 0.7 * self.fs + 0.3 * (self.cuenta / (ahora - self.t0))
                self.t0, self.cuenta = ahora, 0
            self.suelto_marcado = False
            self.crudo.append(v)
            self.pendientes.append(v)
            d = v - self.previos[0]
            self.previos.append(v)
            a = min(1.0, 1.0 / max(1.0, 0.04 * self.fs))
            self.energia += (d * d - self.energia) * a
            self.historia.append(self.energia)
            if self.n % 20 == 0:
                self.umbral = 0.35 * max(self.historia)
            refractario = 0.28 * self.fs
            if not self.arriba and self.energia > self.umbral > 0 and self.n - self.ultimo_latido > refractario:
                self.arriba = True
                rr = (self.n - self.ultimo_latido) / self.fs
                if 0.3 <= rr <= 2.0:
                    self.rr.append(rr)
                elif rr > 2.0:
                    self.rr.clear()
                self.ultimo_latido = self.n
            elif self.arriba and self.energia < self.umbral * 0.5:
                self.arriba = False

    def suelto(self):
        if self.suelto_marcado:
            return True
        if len(self.crudo) < 100:
            return False
        c = list(self.crudo)
        saturado = sum(1 for x in c if x < 5 or x > 1018) / len(c)
        return saturado > 0.5 or statistics.pstdev(c) < 2

    def lectura(self):
        """(bpm, calidad, rmssd_ms) o (None, 0, None) si no hay latidos claros."""
        with cerrojo:
            if (self.n - self.ultimo_latido) / self.fs > 3 or len(self.rr) < 4:
                return None, 0.0, None
            rr = list(self.rr)[-8:]
            med = statistics.median(rr)
            cv = statistics.pstdev(rr) / med
            calidad = max(0.0, min(1.0, 1 - 2 * cv))
            difs = [(b - a) * 1000 for a, b in zip(rr, rr[1:])]
            rmssd = (sum(x * x for x in difs) / len(difs)) ** 0.5 if len(difs) >= 5 else None
            return 60.0 / med, calidad, rmssd

    def sacar_pendientes(self):
        with cerrojo:
            p, self.pendientes = self.pendientes[-300:], []
            return p


corazon = Corazon()


def mandar_ecg():
    """Onda en vivo cada 0,2 s; pulso y RMSSD al registro cada 2 s si hay sesión, contacto y latidos claros."""
    ultimo_lote = 0.0
    while True:
        time.sleep(0.2)
        muestras = corazon.sacar_pendientes()
        if not muestras:
            if time.time() - corazon.t_ultimo > 3:
                estado["ecg"] = "Sin señal"
            continue
        suelto = corazon.suelto()
        bpm, calidad, rmssd = corazon.lectura()
        trip = estado["sesion"]
        estado["ecg"] = "electrodo suelto" if suelto else ("latidos claros" if bpm else "buscando latidos")
        estado["bpm"] = round(bpm) if bpm and not suelto else None
        try:
            pedir("/v1/estacion/onda", {"lector": LECTOR, "trip": trip, "fs": round(corazon.fs, 1),
                                        "muestras": muestras, "bpm": estado["bpm"], "contacto": not suelto,
                                        "rmssd": round(rmssd, 1) if rmssd and not suelto else None,
                                        "calidad": round(calidad, 2) if bpm and not suelto else None}, timeout=2)
        except Exception:
            pass
        if trip and estado["midiendo"] and bpm and not suelto and calidad >= 0.5 and time.time() - ultimo_lote >= 2:
            ultimo_lote = time.time()
            med = [{"sensor": "pulso", "valor": round(bpm, 1), "unidad": "lpm", "calidad": round(calidad, 2)}]
            if rmssd:
                med.append({"sensor": "vfc", "valor": round(rmssd, 1), "unidad": "ms", "calidad": round(calidad, 2)})
            try:
                pedir("/v1/lote", {"trip": trip, "fuente": "estacion-luis", "mediciones": med})
            except Exception as e:
                estado["nave"] = "no se pudo guardar el pulso (" + str(e) + ")"


# ── puerto serie ─────────────────────────────────────────────────────────────────────────────────────────────────────
def procesar(linea):
    if linea.startswith("Card UID:"):
        uid = linea.split(":", 1)[1].strip()  # «04 A1 B2 C3»
        estado["uid"] = uid
        print("Tarjeta detectada:", uid)
        threading.Thread(target=avisar_nave, args=(uid,), daemon=True).start()
        return True
    v = linea[2:] if linea.startswith("E:") else linea
    if v == "!":
        corazon.suelto_marcado = True
        corazon.t_ultimo = time.time()
        return True
    if v.isdigit() and int(v) <= 4095:
        corazon.muestra(int(v))
        return True
    return False


def abrir_puerto():
    """Prueba las velocidades hasta encontrar una en que las líneas se entienden (el Arduino viejo va a 9600)."""
    for b in BAUDIOS:
        try:
            s = serial.Serial(PUERTO, b, timeout=1)
        except serial.SerialException:
            raise
        buenas = malas = 0
        fin = time.time() + 4  # al abrir el puerto el Arduino se reinicia (~2 s)
        while time.time() < fin and buenas < 30:
            l = s.readline().decode("utf-8", errors="replace").strip()
            if not l:
                continue
            if l.startswith("Card UID:") or l.startswith("E:") or l.isdigit():
                buenas += 1
            else:
                malas += 1
        if buenas >= 10 and buenas > malas or len(BAUDIOS) == 1:
            estado["baudios"] = b
            return s
        s.close()
    raise serial.SerialException("no entiendo lo que manda el Arduino a " + "/".join(map(str, BAUDIOS)) + " baudios")


def leer_arduino():
    while True:  # si se desconecta el USB, reintenta
        try:
            with abrir_puerto() as arduino:
                print("Leyendo", PUERTO, "a", estado["baudios"], "baudios · avisando a", NAVE)
                while True:
                    procesar(arduino.readline().decode("utf-8", errors="replace").strip())
        except serial.SerialException as e:
            estado["nave"] = "sin Arduino en " + PUERTO + " (" + str(e) + ")"
            print(estado["nave"])
            time.sleep(2)


# ── página local ─────────────────────────────────────────────────────────────────────────────────────────────────────
pagina = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Estación · NOVA</title>
    <style>
        body { font-family: Arial; text-align: center; padding: 30px; }
        .dato { font-size: 30px; margin-top: 16px; overflow-wrap: anywhere; }
        .nota { margin-top: 10px; color: #555; }
    </style>
</head>
<body>
    <h2>Estación NOVA · Arduino</h2>
    <p>Última tarjeta detectada:</p>
    <div class="dato" id="uid">Esperando tarjeta...</div>
    <div class="nota" id="nave"></div>
    <p style="margin-top:40px">Electrocardiograma:</p>
    <div class="dato" id="ecg">Sin señal</div>
    <div class="nota" id="sesion"></div>
    <script>
        async function actualizar() {
            try {
                const r = await (await fetch("/datos")).json();
                document.getElementById("uid").innerText = r.uid;
                document.getElementById("nave").innerText = "Nave NOVA: " + r.nave;
                document.getElementById("ecg").innerText = r.bpm ? r.bpm + " lpm" : r.ecg;
                document.getElementById("sesion").innerText = (r.midiendo ? "Guardando a nombre de " + r.sesion
                    : r.sesion ? r.sesion + " tiene la sesión: se guarda al abrir ECG en la tablet"
                    : "Nadie con sesión en la tablet: el pulso no se guarda") + (r.baudios ? " · " + r.baudios + " baudios" : "");
            } catch (error) { console.log(error); }
        }
        setInterval(actualizar, 500);
        actualizar();
    </script>
</body>
</html>
"""


@app.route("/")
def inicio():
    return render_template_string(pagina)


@app.route("/datos")
def datos():
    return jsonify(estado)


if __name__ == "__main__":
    for f in (leer_arduino, seguir_sesion, mandar_ecg):
        threading.Thread(target=f, daemon=True).start()
    app.run(host="0.0.0.0", port=5000, debug=False)
