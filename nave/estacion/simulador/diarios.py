"""Check-ins diarios de la tripulación ficticia (demo): horas de sueño, ánimo y energía.

En la nave real estos datos llegan desde la app NOVA de cada astronauta, solo si la persona comparte su día.
Aquí se generan con una historia fija y repetible para que la demo tenga dos semanas de contexto:
  · Mara y David: estables.
  · Ingrid: ánimo que baja despacio (aislamiento).
  · Kenji: duerme peor desde hace seis días y su ánimo lo sigue un día después.
"""

import math
import random

# (sueño base h, ánimo base, energía base)
BASE = {"T1": (7.1, 4.1, 4.0), "T2": (7.4, 4.4, 4.3), "T3": (6.9, 4.1, 3.9), "T4": (7.0, 4.2, 4.0)}


def diario(trip, dias_atras):
    """Valores del check-in de hace `dias_atras` días (0 = hoy)."""
    s, a, e = BASE[trip]
    r = random.Random(f"{trip}-{dias_atras}")
    ruido = lambda k: r.gauss(0, k)
    if trip == "T3":  # Ingrid: baja lenta en las últimas dos semanas
        a -= max(0, 10 - dias_atras) * 0.08
    if trip == "T4":  # Kenji: el sueño cae hace 6 días, el ánimo lo sigue un día después
        s -= max(0, 6 - dias_atras) * 0.32
        a -= max(0, 5 - dias_atras) * 0.42
        e -= max(0, 5 - dias_atras) * 0.3
    ola = math.sin(dias_atras * 0.9 + len(trip))
    sueno = min(9.5, max(3.5, s + 0.25 * ola + ruido(0.25)))
    animo = min(5, max(1, round(a + ruido(0.25))))
    energia = min(5, max(1, round(e + 0.2 * ola + ruido(0.3))))
    return round(sueno, 1), animo, energia
