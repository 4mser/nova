"""Las 8 variables que NOVA pronostica, con el nombre y la unidad del contrato de la nave.

Rangos aceptados: los de `nave/estacion/CONTRATO.md`. Un valor fuera de rango es error de sensor y se descarta.
`diuresis` y `agua` no están en el contrato todavía (ver PREGUNTAS.md, pregunta 18); sus rangos son SUPUESTO.
"""

VARIABLES: dict[str, dict] = {
    "pulso": {"unidad": "lpm", "rango": (20, 250), "en_contrato": True},
    "pa_sis": {"unidad": "mmHg", "rango": (50, 250), "en_contrato": True},
    "pa_dia": {"unidad": "mmHg", "rango": (30, 150), "en_contrato": True},
    "fr": {"unidad": "rpm", "rango": (4, 60), "en_contrato": True},
    "temp": {"unidad": "C", "rango": (30, 43), "en_contrato": True},
    "peso": {"unidad": "kg", "rango": (30, 200), "en_contrato": True},
    "diuresis": {"unidad": "g/dia", "rango": (200, 8000), "en_contrato": False},  # SUPUESTO
    "agua": {"unidad": "g/dia", "rango": (200, 10000), "en_contrato": False},  # SUPUESTO
}

# Canales de LifeSnaps que solo existen en Tierra: sirven para pre-entrenar la dinámica diaria, no se evalúan.
SOLO_TIERRA: dict[str, dict] = {
    "vfc": {"unidad": "ms", "rango": (5, 250)},
    "spo2": {"unidad": "%", "rango": (50, 100)},
    "sueno_h": {"unidad": "h", "rango": (0, 16)},
    "actividad_min": {"unidad": "min", "rango": (0, 1440)},
    "estres": {"unidad": "0-100", "rango": (0, 100)},
}

OBJETIVOS = list(VARIABLES)

# El agua sigue una meta diaria del protocolo: su «esperado» es la meta y su anomalía es una desviación del protocolo,
# no fisiología. Se reporta aparte y queda fuera de los promedios y de los titulares.
PROTOCOLO = {"agua"}
TITULAR = [v for v in OBJETIVOS if v not in PROTOCOLO]


def rango(variable: str) -> tuple[float, float]:
    if variable in VARIABLES:
        return VARIABLES[variable]["rango"]
    return SOLO_TIERRA[variable]["rango"]
