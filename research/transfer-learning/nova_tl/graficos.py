"""Gráficos de la presentación. Solo leen tablas: se pueden rehacer en el PC sin correr ninguna red."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from nova_tl.expectativa import ADAPTADO
from nova_tl.variables import OBJETIVOS, PROTOCOLO

NOTA = "Análogo terrestre: reposo en cama a −6° (NASA NLSP/LSDA, 29 sujetos), no datos de vuelo. Validación por sujetos."
NOTA_IC = NOTA + " Barras de error: IC 95 % por bootstrap de sujetos."
MODELOS_PRONOSTICO = ["media7", "chronos-2 (sin adaptar)", "solo espacio (sin Tierra)", "solo reposo (sin LifeSnaps)",
                      "tierra (sin adaptar)", "tierra→espacio (cabeza)", "tierra→espacio (todo)"]
GRIS, AZUL, CLARO, NEGRO = "#9aa4b1", "#2a7fff", "#bcd4ff", "#222222"


def _etiquetas(orden):
    return [f"{v}\n(protocolo)" if v in PROTOCOLO else v for v in orden]


def _err(t, m):
    return np.vstack([t[m] - t[f"{m}_ic_bajo"], t[f"{m}_ic_alto"] - t[m]]).clip(min=0)


def _pie(fig, nota=NOTA):
    fig.text(0.01, 0.01, nota, fontsize=7, color="#555")
    fig.tight_layout(rect=(0, 0.04, 1, 1))


def todos(tabla: pd.DataFrame, placebo: pd.DataFrame, pronostico: pd.DataFrame | None, carpeta: Path) -> list[str]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    carpeta.mkdir(parents=True, exist_ok=True)
    orden = [v for v in OBJETIVOS if v in set(tabla.variable)]
    x = np.arange(len(orden))

    def fila(modelo, k):
        return tabla[(tabla.modelo == modelo) & (tabla.k == k)].set_index("variable").reindex(orden)

    t0, tc, ta = fila("tierra", 0), fila("tierra (ancho calibrado)", 0), fila(*ADAPTADO)
    pl = placebo.set_index("variable").reindex(orden)
    hechos = []

    # 1 · falsas alarmas con la regla de Tierra, contra su propio piso dentro del pre-reposo
    fig, ax = plt.subplots(figsize=(10, 4.2))
    ax.bar(x - 0.2, t0["falsas_alarmas_pct"], 0.4, yerr=_err(t0, "falsas_alarmas_pct"), capsize=2, color=GRIS,
           label="Línea base de Tierra (±1,96·sd del pre-reposo)")
    ax.bar(x + 0.2, ta["falsas_alarmas_pct"], 0.4, yerr=_err(ta, "falsas_alarmas_pct"), capsize=2, color=AZUL,
           label="Adaptado (población + 28 días propios), calibrado al 5 %")
    ax.scatter(x - 0.2, pl["placebo_fa_pct"], marker="_", s=400, color=NEGRO, zorder=3,
               label="Piso: la misma regla dentro del pre-reposo (placebo)")
    ax.axhline(5, ls="--", lw=1, color="k")
    ax.set_xticks(x, _etiquetas(orden))
    ax.set_ylabel("% de días normales fuera del rango")
    ax.set_title("1 · En reposo, la línea base de Tierra marca como anormal la «nueva normalidad»")
    ax.legend(frameon=False, fontsize=8)
    _pie(fig, NOTA_IC)
    fig.savefig(carpeta / "1_falsas_alarmas.png", dpi=150)
    plt.close(fig)
    hechos.append("1_falsas_alarmas.png")

    # 2 · a igual tasa de falsas alarmas: ancho del rango y detección
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(12, 4.2))
    a1.bar(x - 0.2, np.ones(len(orden)), 0.4, color=GRIS, label="Tierra, ancho calibrado al 5 %")
    a1.bar(x + 0.2, ta["ancho_medio"] / tc["ancho_medio"], 0.4, color=AZUL, label="Adaptado, calibrado al 5 %")
    a1.set_xticks(x, _etiquetas(orden), fontsize=8)
    a1.set_ylabel("ancho del rango (1 = Tierra calibrado)")
    a1.set_title("2a · Rango más angosto con las mismas falsas alarmas")
    a1.set_ylim(0, 1.3)
    a1.legend(frameon=False, fontsize=8, loc="upper right", ncol=2)
    a2.bar(x - 0.2, tc["recall_pct"], 0.4, yerr=_err(tc, "recall_pct"), capsize=2, color=GRIS,
           label="Tierra, ancho calibrado")
    a2.bar(x + 0.2, ta["recall_pct"], 0.4, yerr=_err(ta, "recall_pct"), capsize=2, color=AZUL, label="Adaptado")
    a2.set_xticks(x, _etiquetas(orden), fontsize=8)
    a2.set_ylabel("% de escalones de 3 días detectados")
    a2.set_title("2b · Detección (regla: ≥ 2 de 3 días fuera)")
    a2.legend(frameon=False, fontsize=8)
    _pie(fig, NOTA_IC)
    fig.savefig(carpeta / "2_igual_falsas_alarmas.png", dpi=150)
    plt.close(fig)
    hechos.append("2_igual_falsas_alarmas.png")

    # 3 · cuántos días propios necesita (evaluado siempre en días ≥ 28: es extrapolación, no adaptación temprana)
    fig, ax = plt.subplots(figsize=(10, 4.2))
    for v in [v for v in orden if v not in PROTOCOLO]:
        c = tabla[(tabla.variable == v) & tabla.modelo.isin(["tierra+poblacion", ADAPTADO[0]])].sort_values("k")
        ax.plot(c["k"], c["mae"] / t0.loc[v, "mae"], marker="o", label=v)
    ax.axhline(1, ls="--", lw=1, color="k")
    ax.set_xlabel("días propios en reposo usados para ajustar (k); se evalúa desde el día 28")
    ax.set_ylabel("error relativo a la línea base de Tierra")
    ax.set_title("3 · Error del valor esperado según cuántos días propios ve NOVA")
    ax.legend(frameon=False, ncol=4, fontsize=8)
    _pie(fig)
    fig.savefig(carpeta / "3_curva_aprendizaje.png", dpi=150)
    plt.close(fig)
    hechos.append("3_curva_aprendizaje.png")

    if pronostico is not None and len(pronostico):
        p = pronostico[pronostico.fase == "reposo"].pivot(index="variable", columns="modelo",
                                                          values="mae_rel_persistencia").reindex(orden)
        p = p[[m for m in MODELOS_PRONOSTICO if m in p.columns]]
        fig, ax = plt.subplots(figsize=(12, 4.8))
        p.plot.bar(ax=ax, width=0.85)
        ax.axhline(1, ls="--", lw=1, color="k")
        ax.set_ylim(0, 1.05)
        ax.set_xlabel("")
        ax.set_xticklabels(_etiquetas(orden), rotation=0, fontsize=8)
        ax.set_ylabel("MAE relativo a persistencia (1 = repetir el último día)", fontsize=8)
        ax.set_title("4 · Pronóstico a 7 días en reposo (validación por sujetos)")
        ax.legend(frameon=False, fontsize=7, ncol=4, loc="upper center", bbox_to_anchor=(0.5, -0.12))
        _pie(fig)
        fig.savefig(carpeta / "4_pronostico.png", dpi=150)
        plt.close(fig)
        hechos.append("4_pronostico.png")
    return hechos


if __name__ == "__main__":
    import sys

    salida = Path(sys.argv[1])  # carpeta con rango_esperado.csv, placebo_pre.csv y pronostico.csv
    pron = pd.read_csv(salida / "pronostico.csv") if (salida / "pronostico.csv").exists() else None
    print(todos(pd.read_csv(salida / "rango_esperado.csv"), pd.read_csv(salida / "placebo_pre.csv"), pron,
                salida / "graficos"))
