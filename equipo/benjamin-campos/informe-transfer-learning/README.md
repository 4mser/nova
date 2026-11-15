# Informe: transfer learning Tierra → espacio

Informe técnico en LaTeX del trabajo de [`../transfer-learning/`](../transfer-learning) (PR #2). Si solo quieres
leerlo, abre [`informe.pdf`](informe.pdf): 65 páginas y 91 referencias.

Cubre la historia del transfer learning y del ajuste fino, desde Thorndike (1901) hasta los modelos fundacionales de
series de tiempo; los datos (reposo en cama a −6° de la NASA y LifeSnaps); los dos modelos (rango esperado y
pronóstico con PatchTST); los resultados del tercer run del kernel; la auditoría del 14-11-2026; cómo encajaría en la
nave; y las 26 decisiones del 14-11. La conexión con la nave está diseñada, no construida, y la corrida v4 está
planeada, no corrida. El informe lo dice así en cada caso.

## Qué hay aquí

| Ruta | Qué es |
|---|---|
| `informe.tex`, `preambulo.tex` | documento principal y estilo (clase memoir) |
| `capitulos/` | un archivo por capítulo y apéndice |
| `generado/` | cifras, tablas, figuras y bibliografía generadas por script; no se editan a mano |
| `herramientas/` | los scripts que escriben `generado/` |
| `informe.pdf` | el informe compilado |

## Compilar

Necesitas LuaLaTeX, biber y latexmk (MiKTeX o TeX Live), más las fuentes Libertinus Serif, Libertinus Sans y Source
Code Pro.

```
latexmk -lualatex informe
```

Para compilar basta con lo que está en esta carpeta, porque `generado/` viene incluido.

## Regenerar las cifras

Ninguna cifra de resultado está escrita a mano en los capítulos: todas salen de `generado/cifras.tex` con
`\cifra{...}`, o de una tabla o figura de `generado/`. Las escribe `herramientas/construir_cifras.py`, que lee la
carpeta `fuentes/` y el código de `../transfer-learning/`:

```
cd herramientas
python construir_cifras.py .. ../../transfer-learning
```

`fuentes/` no está en git, porque trae datos de personas y pesos de modelos. Así se arma:

| Archivo | De dónde sale |
|---|---|
| `metricas.json`, `log.txt`, `rango_esperado*.csv`, `placebo_pre.csv`, `pronostico*.csv`, `desplazamiento_reposo.csv`, `ruido_por_variable.json`, `corrector_poblacion.json` | salida del tercer run: `kaggle kernels output benjacampos/nova-transfer-learning` |
| `reposo_largo.parquet`, `reposo_covariables.parquet`, `tierra_largo.parquet` | entrada del kernel, preparada con `python -m nova_tl.datos` (ver el README de `../transfer-learning/`) |
| `nova-tierra.safetensors`, `nova-espacio.safetensors`, `config_patchtst.json` | el `model.safetensors` y el `config.json` de `Benjjaman/nova-tierra` y `Benjjaman/nova-espacio` en Hugging Face (privados por ahora); el kernel también los deja en su carpeta `pesos/` |
| `datos_auditoria.json` | el script de la auditoría del 14-11, que no está en el repositorio |

Los sha256 de esos archivos están en el apéndice de reproducibilidad del informe (tablas de trazabilidad y de datos de
entrada).

## Bibliografía

Las referencias no se escribieron de memoria: salen de Crossref, DBLP, OpenAlex, arXiv y Semantic Scholar, con una
regla de coincidencia de título, primer autor y año. Los pasos están en el apéndice de reproducibilidad, y los
`generado/registro_*.tsv` dicen qué servicio resolvió cada clave. `resolver_bib2.py` también baja los resúmenes de las
obras a `generado/resumenes.json`, que no se sube porque es texto de terceros.

## Datos y licencias

- Tierra: LifeSnaps, de Yfantidou et al., *Scientific Data* 2022 (doi:10.1038/s41597-022-01764-x, CC BY 4.0).
- Análogo: NASA Life Sciences Data Archive, estudios de reposo en cama de la UTMB.
