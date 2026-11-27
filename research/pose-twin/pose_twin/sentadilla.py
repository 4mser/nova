"""Sentadilla vista de lado: repeticiones, flexión máxima, tiempos y diferencia entre lados.

Solo medidas sobre los ángulos ya calculados (y suavizados). No hay umbrales clínicos ni juicios de salud: las
constantes de abajo son parámetros técnicos para separar repeticiones. No validado, no es medición médica.
La copia web es escaner/sentadilla.mjs; la paridad se prueba en tests/test_escaner_paridad.py.
"""
from __future__ import annotations

import csv
import json
import math
import time
from pathlib import Path

NOTA = "no validado, no es medicion medica"

# Parámetros de conteo (grados y segundos)
DE_PIE_MIN = 140.0  # para fijar el punto de partida, la rodilla debe estar al menos así de extendida
DE_PIE_RANGO = 10.0  # y variar como mucho esto durante la ventana (sin contar el valor más alto y el más bajo)
DE_PIE_VENTANA = 0.8
DE_PIE_MUESTRAS = 5
ENTRADA = 30.0  # una repetición se cuenta si la rodilla se flexiona al menos esto desde el punto de partida
SALIDA = 15.0  # y termina al volver a menos de esto del punto de partida (histéresis)
FONDO = 5.0  # "fondo": a menos de esto del mínimo
HUECO_MAX = 1.0  # sin ver la rodilla durante más tiempo, la repetición se descarta
DURACION_MIN, DURACION_MAX = 0.5, 20.0
MUESTRAS_ABAJO = 3
CAMBIO_LADO = 0.1  # ventaja de visibilidad necesaria para cambiar el lado que se sigue
COBERTURA_DIF = 0.8  # fracción de cuadros con ambos lados visibles para dar la diferencia
COBERTURA_CADERA = 0.7

LADOS = ("izq", "der")
METRICAS = ("rodilla_min", "cadera_min", "bajada_s", "subida_s", "dif_rodilla", "dif_cadera")
COLUMNAS = ["n", "t_inicio_s", "rodilla_min", "cadera_min", "lado", "bajada_s", "fondo_s", "subida_s",
            "dif_rodilla", "dif_cadera", "calidad", "cobertura"]


def visibilidad_lados(visibilidad) -> dict[str, float]:
    """Visibilidad mínima de cadera, rodilla y tobillo de cada lado."""
    return {"izq": float(min(visibilidad[i] for i in (23, 25, 27))),
            "der": float(min(visibilidad[i] for i in (24, 26, 28)))}


def _mediana(x: list[float]) -> float:
    s = sorted(x)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def _minimo(x: list[float]) -> float:
    """Mínimo tras una mediana de 3 cuadros, para que un solo cuadro erróneo no fije la flexión máxima."""
    if len(x) < 3:
        return min(x)
    return min(sorted(x[i - 1:i + 2])[1] for i in range(1, len(x) - 1))


def estadistica(x: list[float]) -> dict:
    """n, media, desviación estándar muestral (None con menos de 2 datos), mínimo y máximo."""
    n = len(x)
    if not n:
        return {"n": 0, "media": None, "de": None, "min": None, "max": None}
    suma = 0.0
    for v in x:
        suma += v
    media = suma / n
    de = None
    if n > 1:
        cuad = 0.0
        for v in x:
            cuad += (v - media) * (v - media)
        de = round(math.sqrt(cuad / (n - 1)), 2)
    return {"n": n, "media": round(media, 2), "de": de, "min": min(x), "max": max(x)}


class SerieSentadilla:
    """Máquina de estados de una serie: preparando -> buscando (de pie) -> listo <-> abajo -> fin."""

    def __init__(self, segundos_preparacion: float = 8.0, segundos_fin: float | None = 8.0):
        self.segundos_preparacion = segundos_preparacion
        self.segundos_fin = segundos_fin  # None: solo termina cuando se pide
        self.fase = "preparando"
        self.repeticiones: list[dict] = []
        self.descartadas: list[dict] = []
        self.referencia: float | None = None
        self.sin_vista = False
        self._prep_hasta: float | None = None
        self._t0: float | None = None
        self._t: float | None = None
        self._ventana: list[tuple[float, float]] = []
        self._cuadros: list[dict] = []  # desde el último cuadro de pie
        self._t_visto = 0.0
        self._t_fin_rep = 0.0
        self._lado: str | None = None

    @property
    def terminada(self) -> bool:
        return self.fase == "fin"

    def _elegir(self, angulos: dict, vis: dict | None) -> str | None:
        vistos = [lado for lado in LADOS if angulos.get(f"rodilla_{lado}") is not None]
        if not vistos:
            return None
        if self._lado not in vistos:
            self._lado = max(vistos, key=lambda lado: vis[lado] if vis else 0.0)
        elif vis:
            for lado in vistos:
                if vis[lado] > vis[self._lado] + CAMBIO_LADO:
                    self._lado = lado
        return self._lado

    def paso(self, angulos: dict[str, float | None], t: float, vis: dict[str, float] | None = None) -> None:
        """Un cuadro: ángulos (None = abstención), tiempo en segundos y visibilidad por lado (opcional)."""
        if self.terminada or (self._t is not None and t <= self._t):
            return
        self._t = t
        if self._prep_hasta is None:
            self._prep_hasta = t + self.segundos_preparacion
        if t < self._prep_hasta:
            return
        if self._t0 is None:
            self._t0 = t
            self.fase = "buscando"
        lado = self._elegir(angulos, vis)
        x = None if lado is None else angulos[f"rodilla_{lado}"]
        self.sin_vista = x is None
        if self.referencia is None:
            self._buscar_de_pie(x, t)
            return
        if t - self._t_visto > HUECO_MAX and (self._cuadros or self.fase == "abajo"):
            if self.fase == "abajo":
                self._descartar("se perdio la vista")
            self._cuadros = []  # hay que volver a estar de pie antes de contar otra
        cuadro = {"t": t, "x": x, "lado": lado}
        for k in ("rodilla_izq", "rodilla_der", "cadera_izq", "cadera_der"):
            cuadro[k] = angulos.get(k)
        if x is None:
            if self._cuadros:
                self._cuadros.append(cuadro)
        else:
            self._t_visto = t
            arriba = x >= self.referencia - SALIDA
            if self.fase == "listo":
                if arriba:
                    self._cuadros = [cuadro]
                elif self._cuadros:
                    self._cuadros.append(cuadro)
                    if x <= self.referencia - ENTRADA:
                        self.fase = "abajo"
            else:
                self._cuadros.append(cuadro)
                if arriba:
                    self._cerrar_rep()
                    self._cuadros = [cuadro]
        if self.fase == "abajo" and self._cuadros and t - self._cuadros[0]["t"] > DURACION_MAX:
            self._descartar("demasiado larga")
            self._cuadros = []
        if (self.segundos_fin is not None and self.repeticiones and self.fase == "listo"
                and t - self._t_fin_rep >= self.segundos_fin):
            self.terminar()

    def _buscar_de_pie(self, x: float | None, t: float) -> None:
        if x is None:
            self._ventana = []
            return
        self._ventana.append((t, x))
        while len(self._ventana) > 1 and t - self._ventana[1][0] >= DE_PIE_VENTANA:
            self._ventana.pop(0)
        v = [a for _, a in self._ventana]
        if (len(v) >= DE_PIE_MUESTRAS and t - self._ventana[0][0] >= DE_PIE_VENTANA
                and sorted(v)[-2] - sorted(v)[1] <= DE_PIE_RANGO and _mediana(v) >= DE_PIE_MIN):
            self.referencia = _mediana(v)
            self._t_visto = t
            self.fase = "listo"

    def _descartar(self, motivo: str) -> None:
        self.descartadas.append({"t_s": round(self._cuadros[0]["t"] - self._t0, 2), "motivo": motivo})
        self.fase = "listo"

    def _cerrar_rep(self) -> None:
        c = self._cuadros
        n, t_ini, t_fin = len(c), c[0]["t"], c[-1]["t"]
        vistos = [q for q in c if q["x"] is not None]
        abajo = sum(q["x"] <= self.referencia - ENTRADA for q in vistos)
        if t_fin - t_ini < DURACION_MIN or abajo < MUESTRAS_ABAJO:
            self._descartar("demasiado breve")
            return
        usos = {lado: sum(q["lado"] == lado for q in vistos) for lado in LADOS}
        lado = "izq" if usos["izq"] >= usos["der"] else "der"
        minimo = _minimo([q["x"] for q in vistos])
        fondo = [q["t"] for q in vistos if q["x"] <= minimo + FONDO]

        def minimo_de(k: str, cobertura: float) -> float | None:
            v = [q[k] for q in c if q[k] is not None]
            return _minimo(v) if v and len(v) >= cobertura * n else None

        def diferencia(art: str) -> float | None:
            i, d = minimo_de(f"{art}_izq", COBERTURA_DIF), minimo_de(f"{art}_der", COBERTURA_DIF)
            both = sum(q[f"{art}_izq"] is not None and q[f"{art}_der"] is not None for q in c)
            return None if i is None or d is None or both < COBERTURA_DIF * n else round(i - d, 1)

        def r1(v: float | None) -> float | None:
            return None if v is None else round(v, 1)

        cobertura = len(vistos) / n
        hueco = max(b["t"] - a["t"] for a, b in zip(vistos, vistos[1:]))
        fps = (n - 1) / (t_fin - t_ini)
        if cobertura >= 0.9 and hueco <= 0.3 and fps >= 15:
            calidad = "buena"
        else:
            calidad = "regular" if cobertura >= 0.7 else "baja"
        self.repeticiones.append({
            "n": len(self.repeticiones) + 1, "t_inicio_s": round(t_ini - self._t0, 2),
            "rodilla_min": r1(minimo_de(f"rodilla_{lado}", 0.0)),
            "cadera_min": r1(minimo_de(f"cadera_{lado}", COBERTURA_CADERA)), "lado": lado,
            "bajada_s": round(fondo[0] - t_ini, 2), "fondo_s": round(fondo[-1] - fondo[0], 2),
            "subida_s": round(t_fin - fondo[-1], 2), "dif_rodilla": diferencia("rodilla"),
            "dif_cadera": diferencia("cadera"), "calidad": calidad, "cobertura": round(cobertura, 2),
        })
        self.fase = "listo"
        self._t_fin_rep = t_fin

    def terminar(self) -> None:
        """Cierra la serie. Una repetición a medias (sin volver arriba) no se cuenta."""
        if self.terminada:
            return
        if self.fase == "abajo":
            self._descartar("incompleta: no volvio a quedar de pie")
        self.fase = "fin"

    def resumen(self) -> dict:
        return {k: estadistica([r[k] for r in self.repeticiones if r[k] is not None]) for k in METRICAS}

    def estado(self, t: float) -> dict:
        """Lo que necesita la pantalla en este instante."""
        faltan = None
        if self.fase == "preparando":
            faltan = self.segundos_preparacion if self._prep_hasta is None else max(0.0, self._prep_hasta - t)
        fin_en = None
        if self.segundos_fin is not None and self.repeticiones and self.fase == "listo":
            fin_en = max(0.0, self.segundos_fin - (t - self._t_fin_rep))
        return {
            "fase": self.fase, "faltan_s": faltan, "fin_en_s": fin_en, "n": len(self.repeticiones),
            "descartadas": len(self.descartadas), "sin_vista": self.sin_vista,
            "ultima": self.repeticiones[-1] if self.repeticiones else None,
            "repeticiones": self.repeticiones if self.terminada else None,
            "resumen": self.resumen() if self.terminada else None,
        }

    def resultado(self) -> dict:
        return {
            "version": 1, "tipo": "sentadilla_lateral", "creado": time.strftime("%Y-%m-%dT%H:%M:%S"), "nota": NOTA,
            "unidades": "angulos en grados (180 = extendido); tiempos en segundos; dif = izquierda menos derecha",
            "parametros": {"entrada_grados": ENTRADA, "salida_grados": SALIDA, "fondo_grados": FONDO,
                           "hueco_max_s": HUECO_MAX},
            "referencia_de_pie": None if self.referencia is None else round(self.referencia, 1),
            "repeticiones": self.repeticiones, "descartadas": self.descartadas, "resumen": self.resumen(),
        }


def a_csv(resultado: dict, ruta: Path) -> None:
    """Una fila por repetición; celda vacía cuando hay abstención. Cada fila lleva la advertencia."""
    with open(ruta, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([*COLUMNAS, "nota"])
        for r in resultado["repeticiones"]:
            w.writerow(["" if r[k] is None else r[k] for k in COLUMNAS] + [resultado["nota"]])


def guardar(resultado: dict, carpeta: Path) -> Path:
    """Escribe JSON y CSV sin pisar series anteriores; devuelve la ruta del JSON."""
    carpeta.mkdir(parents=True, exist_ok=True)
    base = time.strftime("sentadilla_%Y%m%d_%H%M%S")
    ruta, i = carpeta / f"{base}.json", 2
    while ruta.exists():
        ruta, i = carpeta / f"{base}_{i}.json", i + 1
    ruta.write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding="utf-8")
    a_csv(resultado, ruta.with_suffix(".csv"))
    return ruta


def texto(resultado: dict) -> str:
    """Resumen para la consola."""
    def f(v):
        return "--" if v is None else f"{v:g}"

    lineas = [f"Sentadillas: {len(resultado['repeticiones'])} repeticiones, {len(resultado['descartadas'])} "
              f"no contadas ({resultado['nota']})."]
    if resultado["referencia_de_pie"] is None:
        lineas.append("No se encontro un tramo de pie y quieto, de lado, para empezar a contar.")
    for r in resultado["repeticiones"]:
        lineas.append(f"  {r['n']}: rodilla min {f(r['rodilla_min'])}, cadera min {f(r['cadera_min'])}, "
                      f"baja {f(r['bajada_s'])} s, sube {f(r['subida_s'])} s, dif rodilla {f(r['dif_rodilla'])}, "
                      f"calidad {r['calidad']}")
    for k in METRICAS:
        e = resultado["resumen"][k]
        if e["n"]:
            lineas.append(f"  {k}: n {e['n']}, media {f(e['media'])}, DE {f(e['de'])}")
    return "\n".join(lineas)
