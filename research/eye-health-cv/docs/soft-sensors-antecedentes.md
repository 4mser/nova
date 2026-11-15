# Antecedentes: visión ocular con computer vision, soft sensors, transferencia Tierra→espacio y datos

Actualizado: 14 nov 2026, después de verificar contra fuentes primarias (abstracts, páginas oficiales, arXiv).
Estado: solo antecedentes. No hay implementación ni carpetas nuevas.
Página visual del diseño: `Antecedentes/nova-vision-ocular.html`.

## Cómo leer las marcas
- **[V]** verificado: se abrió la fuente primaria y la cifra o dato aparece ahí.
- **[P]** parcial: se confirmó la existencia o parte del dato; falta texto completo, denominador u otra pieza.
- **[NV]** no verificado: viene de resúmenes de búsqueda, de un blog o de inferencia propia. **No citar en el pitch.**
- **[INF]** inferencia mía, sin fuente.

Límite de la verificación: PubMed, PMC, Nature, NEJM y Wiley bloquearon la lectura automática. Los abstracts se leyeron vía Europe PMC, E-utilities y Crossref; los textos completos no.

## 1. Correcciones respecto a versiones anteriores
- **MRD2** es la distancia del centro de la córnea al borde del párpado **inferior**. MRD1 es la del párpado superior. Antes lo describí al revés.
- **El único estudio de MRD2 en astronautas figura como RETRACTADO** en la página del journal (ver 5.6). No usarlo como evidencia.
- **PPG-Distill** tiene ID arXiv **2509.19215**. El 2511.18829 es otro paper (caracterización de destilación para estimar pulso).
- **Costes 2024** es en realidad **Sanders et al. 2024** (Costes es el último autor).
- **"Lee et al., *Lancet Neurology* 2020"** no existe en lo hallado. La cita correcta es Lee et al., *npj Microgravity* 2020;6:7.
- **Buller 2013:** las cifras N=83 y ±0,58 °C **no se pudieron verificar**.
- **Prevalencia de SANS ~1/3:** no se encontró su fuente. Se conserva solo el ~70 % de NASA, sin denominador.
- **Cifra "~50 mL" de líquido desplazado** y estudio de bed rest de 1991: sin fuente primaria. Fuera.

## 2. Arquitectura propuesta

```
FASE 1 (Tierra)
 sensores comunes + cámara del teléfono (escáner AR)
   -> visión ocular por computer vision (sin soft sensors)
   -> encoder PPG preentrenado (PaPaGei, ~5 M parámetros) + soft sensors de señales
   -> puerta de calidad + línea base personal (mediana/MAD, propias de este repo)
   -> LLM pequeño (Qwen3 4B): SOLO verbaliza salidas calculadas, no decide

FASE 2 (espacio)
 modelo Tierra (teacher) --destilación--> modelo pequeño (student, a bordo)
   -> calibración por astronauta con su línea base pre-vuelo
   -> forecasting con cono de incertidumbre
   -> parámetros de vuelo desde literatura, no desde datos crudos
```

"Small data" = dato escaso del espacio. El modelo más pequeño sale de **destilación** (teacher→student). Fase 2 se presenta como diseño: no hay datos de astronautas para validarla.

## 2.1 Decisiones de diseño (14 nov)
- El software depende **solo de teléfono y webcam**. Si las misiones ya usan otros instrumentos oftálmicos, se **integran como entrada opcional** por el contrato de la estación médica (no son parte de la visión por computador). Según la página de riesgo SANS de NASA [V], en la ISS se usan OCT, fondo de ojo, tonometría, ecografía ocular y software de agudeza.
- Agudeza visual y rejilla de Amsler **se incluyen**, asistidas por la cámara (distancia y fijación). Amsler se marca como exploratoria: sin validación verificada.
- La pupila se mide con **luz visible**, como tamaño relativo, declarando que hay sesgo y fallas con ojos marrones (ver 3.2).
- El módulo ocular corre **dentro del puente `/v1/vision/ws`** (puerto 8792, MediaPipe en la GPU).
- La cámara es **conmutable**: frontal (autochequeo, modo autónomo) y trasera (otra persona escanea, modo supervisado). La línea base se guarda por cámara, la estimación de distancia por iris se calibra por cámara y el módulo registra si la imagen viene espejada y qué cámara se usó. [INF: diseño propio; el PDF no especifica qué cámara usa hoy el escáner]

## 3. Visión ocular con computer vision

### 3.1 Herramientas de CV
| Tema | Estado | Evidencia |
|---|---|---|
| MediaPipe Face Landmarker | [V] | "3D facial surface landmarks (478 points)", 52 blendshapes, detector BlazeFace. Docs de Google AI Edge. |
| Que esos 478 incluyan iris (468+10) | [V] medido | Spike del 14 nov con la webcam de Niko: 478 landmarks por cara, índices 468-477 presentes con x e y entre 0 y 1, cara detectada en 90 de 90 cuadros, latencia 7,76 ms de mediana y 8,97 ms p95 en CPU (`docs/spike-resultados.md`). Una persona, una sesión, buena luz: no mide la precisión del iris. |
| Licencia | [P] | Repo MediaPipe: Apache 2.0. La página del Landmarker no declara licencia. |
| Attention Mesh | [V] | Grishchenko, Ablavatski, Kartynnik, Raveendran, Grundmann. CVPRW 2020. arXiv 2006.10962. |
| Pupila en tiempo real | [V] | Ablavatski et al. 2020, arXiv 2006.11341: 7,16 % MAD/IED en ~4.000 imágenes (anotación humana 5,73-7,04 %). |
| Distancia a pantalla por tamaño del iris | [P] | Blog de Google Research (no paper): error relativo medio 4,3 % (SD 2,4 %); con lentes 4,8 % (SD 3,1 %); menor a 10 %; ~50.000 imágenes, >200 participantes. |
| Iris ≈ 11,7 ± 0,5 mm | [NV] | Aparece en el blog; los 4 papers de origen no se identificaron. |
| Eye Aspect Ratio | [V] | Soukupová y Čech, CVWW 2016. ZJU (80 videos, 20 sujetos) y Eyeblink8, umbral EAR 0,2 y EAR+SVM. Es "relatively easy" en ZJU; el umbral simple queda atrás del SVM en Eyeblink8. Falla con sonrisa, vista lateral, cierres largos e IOD menor a 20 px. Resultados en curvas, sin cifra única. |

### 3.2 Señales oculares
| Señal | Estado | Evidencia |
|---|---|---|
| PERCLOS | [V] concepto, [NV] webcam | NHTSA DOT HS 808 762 (1998), Dinges, Mallis, Maislin, Powell: proporción de tiempo por minuto con ojos >80 % cerrados (concepto de Wierwille 1994). Correlación con lapsos de atención PVT: r=0,875 (frecuencia) y r=0,919 (duración); la autoevaluación de sueño r=0,626. **Se validó con observadores humanos sobre video CCTV de baja luz**; el informe pide automatizarlo. Con webcam solo hay una revisión secundaria sin abrir (umbrales heterogéneos). |
| Pupilometría con teléfono | [P] | Tabla de Solyman et al., *Clin Ophthalmol* 2022: cámara infrarroja, 12 pacientes (23 ojos), diferencia media 0,03 ± 0,15 mm contra pupilómetro de escritorio, LoA -0,27 a 0,32, ICC 0,982-0,986. PupilScreen (Mariakakis 2017, cámara visible en caja cerrada): sesgo +0,24 mm (ojos azules), +0,27 (marrones), +0,07 (mixtos). Neice 2020 (visible): 6 de 26 ojos sin identificar. **Las cifras buenas usan infrarrojo o condiciones controladas; el ojo marrón con cámara visible es el punto débil.** |
| MRD1/MRD2 con teléfono | [V] | Chen et al., *JMIR mHealth uHealth* 2021 (PMC8538024): iPhone 11 Pro Max, 822 ojos de 411 voluntarios, error absoluto medio 0,35 mm (MRD1) y 0,37 mm (MRD2), LoA MRD1 ±0,94 mm. Es deep learning, no landmarks puros. |
| Agudeza visual con teléfono | [V] | Peek Acuity, Bastawrous et al., *JAMA Ophthalmol* 2015, PMID 26022921: 300 adultos ≥55 años, Kenia; test-retest ±0,033 logMAR; diferencia media 0,07 logMAR contra ETDRS (IC 0,05-0,09) y 0,08 contra Snellen (0,06-0,10); 77 s vs 82 s. Usa una "E" ETDRS con operador a distancia fija: no es estimación solo con CV. |
| Rejilla de Amsler digital | [NV] | Solo snippets (PocDoc sensibilidad 50 %, Checkup 93 %/92 %). Abrir los papers antes de citar. |
| Papiledema con IA, BONSAI | [P] | Milea et al., *NEJM* 2020, PMID 32286748: 15.846 fotos (14.341 de 19 centros en 11 países para entrenamiento y validación; 1.505 de 5 centros para test externo). Validación AUC 0,99; test externo AUC 0,96, sensibilidad 96,4 %, especificidad 84,7 %. Abstract leído vía E-utilities. |
| Papiledema con fotos no midriáticas, FOTO-ED | [V] | Biousse et al., *Am J Ophthalmol* 261:199-207, 2024, PMID 37926337: análisis secundario retrospectivo con BONSAI modificado, 1.608 fotos de 828 pacientes. Papiledema vs resto: AUC 0,97 (IC 0,95-0,99), sensibilidad 84,0 %, especificidad 98,9 %. Normal vs anormal: AUC 0,92, sensibilidad 75,6 %, especificidad 89,6 %. Cámaras de fondo de ojo, no teléfono. |
| Papiledema con cámaras de mano | [NV] | Gungor et al., *J Neuroophthalmol* 2026, PMID 40867029: solo se leyó el título. |

### 3.3 Edema periorbital: estado de la evidencia
- Estudio de astronautas: Ax, Bothe, Craig, Dean, Zimmermann, March de Ribot, Jensen, Millar, Seitz. "The Effect of Microgravity on Lower Eyelid Position in Astronauts". *Eye & ENT Research* 3(2):69-74, 2026. DOI 10.1002/eer3.70043.
  - Contenido [V en la página del journal]: 115 fotos de la NASA (52 en Tierra, 63 en espacio) de 13 astronautas; MRD2 medido a mano en Photoshop, calibrado con el diámetro corneal medio (11,60 mm hombres, 11,71 mm mujeres); MRD2 pasó de 4,9 ± 0,7 mm en Tierra a 3,9 ± 0,7 mm en espacio (p<0,001); 8 de 13 bajaron ≥1 mm.
  - **Estado: la página del journal dice "This article has been retracted" y "The Retraction Note was updated to reflect reception of statements of disagreement from all authors". No da fecha ni motivo.** No citar hasta revisar el aviso de retractación (Wiley o Retraction Watch).
- No existe método validado para medir hinchazón facial global con visión por computador (no encontrado).
- No encontré monitoreo ocular en vuelo con cámaras de consumo. Una revisión sistemática de 72 estudios (Meer et al., *npj Microgravity* 2025, PMID 40890229) concluye "No single technology can independently track SANS progression".

## 4. SANS y vigilancia en vuelo
| Tema | Estado | Evidencia |
|---|---|---|
| Descripción original | [V] abstract | Mader, Gibson, Pass et al., *Ophthalmology* 118(10):2058-2069, 2011, PMID 21849212: 7 astronautas con hallazgos oculares tras misiones largas en la ISS, más cuestionarios de ~300. Edema de disco en 5, aplanamiento del globo en 5, pliegues coroideos en 5; cambio hipermetrópico de +0,50 D o más en 5 de 7 (hasta +1,75 D). En los 4 con edema de disco, presión de apertura de punción lumbar de 21 a 28,5 cm H2O. Cuestionarios: ~29 % (misión corta) y ~60 % (larga) con peor visión. |
| Revisión | [P] | Lee, Mader, Gibson et al., *npj Microgravity* 6:7, 2020, PMID 32047839 (PMC7005826). El abstract lista edema de disco, aplanamiento del globo, pliegues coroideos y retinianos, cambio hipermetrópico y exudados algodonosos. No se leyó el cuerpo: no hay N ni prevalencia verificados. |
| Prevalencia | [P] | NASA HRP: "About 70% of crewmembers show at least one hallmark sign". Sin denominador ni año. El ~1/3 no tiene fuente hallada. Mader 2011 no es prevalencia clínica. |
| Cohorte reciente | [V] | Brunstetter et al., *JAMA Ophthalmol* 2025, PMID 41066117: 16 astronautas con dos misiones en la ISS; el estado de SANS en una misión predijo el de la siguiente. N pequeño. |
| Mecanismo | [P] | Solo abstracts de revisiones: Rodrigues et al., *npj Microgravity* 2025 (PMID 40456790), 20 estudios: aumento de presión intracraneal por desplazamiento de LCR vs compartimentalización del LCR; "not mutually exclusive". Martin Paez et al., *Eye Brain* 2020 (PMID 33117025). Mampre et al., 2025 (PMID 40643392): hipótesis venosa. Los primarios (Marshall-Goebel, Laurie, Lawley) no se abrieron. |
| Vigilancia en la ISS | [V] | Página de riesgo SANS de NASA HRP: software de agudeza visual, ecografía ocular, imagen oftálmica y OCT. Tarea "Ocular Health": mediciones en vuelo cada ~30 días (tonometría, ecografía ocular, fundoscopía, agudeza, OCT, presión arterial, gasto cardíaco, Doppler transcraneal), de 1 año antes a 1 año después. Campos visuales antes e inmediatamente después del vuelo; RM de cerebro y ojo antes y en los primeros 3 días tras el regreso. MiniOCT Demo-ISS (4 sujetos) pensado para Artemis. |
| Amsler en vuelo | [NV] | No aparece en la parte leída de la página de NASA. |
| Contramedidas | [P] | Nguyen et al., *Prog Retin Eye Res* 2025 (PMID 39971096): gafas, presión negativa en la parte baja del cuerpo, manguitos en los muslos, centrifugación. |

**Qué NO se puede decir sin OCT:** diagnosticar, descartar o graduar edema de disco; ver pliegues coroideos o aplanamiento del globo; inferir presión intracraneal; cuantificar edema en mL. Un cambio en agudeza, pupila o parpadeo no es específico de SANS. Formulación permitida: "alerta de seguimiento", nunca "SANS". [INF, consistente con las fuentes]

## 5. Datasets de fondo de ojo
| Dataset | Estado | Hallazgo |
|---|---|---|
| REFUGE | [P] | 1.200 fotos a color, 1:1:1 en 400 entrenamiento, 400 validación y 400 test. Sin licencia declarada, solo términos generales de Grand Challenge. |
| G1020 | [P] | Bajwa et al., arXiv 2006.09158, IJCNN 2020: 1.020 imágenes. Sin licencia declarada en la página. |
| PAPILA | [P] | Kovalyk et al., *Sci Data* 9:291, 2022, DOI 10.1038/s41597-022-01388-1. Solo se confirmó la cita; tamaño y licencia sin abrir. |
| ORIGA | [NV] | No se abrió ninguna fuente. |
| Papiledema público | [NV] | No se encontró ninguno; la búsqueda no fue exhaustiva. |

## 6. Soft sensors y modelos de señales (fuera del módulo de visión)
| Tema | Estado | Evidencia |
|---|---|---|
| PaPaGei | [V] | Pillai, Spathis, Kawsar, Malekzadeh. ICLR 2025, arXiv 2410.20542. PaPaGei-P 5 M y PaPaGei-S 5,7 M de parámetros; >57.000 h y 20 M de segmentos; 20 tareas en 10 datasets; +6,3 % en métricas de clasificación y +2,9 % en regresión en al menos 14 tareas. Que la métrica sea AUROC es [INF]. Código BSD-3. **Pesos (Zenodo 13983110): sin licencia declarada** (confirmado en la API); solo citan VitalDB CC BY 4.0 y MIMIC-III Matched ODbL. CPU: plausible, no medido [INF]. |
| Pulse-PPG | [P] | Saha, Xu, Mao, Neupane, Rehg, Kumar. arXiv 2502.01108, 2025, preprint. Estudio de campo de 100 días y 120 participantes [V]. "Supera a PaPaGei en 10 de 11 tareas" es de los propios autores [NV en texto]. Código MIT [NV recheck]. |
| PPG-Distill | [V] | Ni, Kataria, Tang, Yang, Hu, Jin. arXiv 2509.19215, NeurIPS 2025 TS4H workshop. Hasta +21,8 % sobre el estudiante, inferencia 7x más rápida, memoria 19x menor (FC y fibrilación auricular). |
| Destilación para estimar pulso | [V] existe | Arora, Narayanswamy, Patel, Li. arXiv 2511.18829, NeurIPS 2025 workshop. Compara 4 estrategias de destilación; el abstract no da métricas. |
| UNIPHY+ | [V] existe | Wang et al. (Xiao Hu último autor). arXiv 2509.16348, preprint. Sin métricas en el abstract. |
| Presión arterial por PPG, NBPDB | [V] | Mathew, Shen, Hu, Rahimi, Zouridakis. arXiv 2602.04725, 2026, preprint. 101.453 segmentos de 1.103 adultos sanos (MIMIC-III y VitalDB). Ningún modelo cumplía AAMI/ISO 81060-2 antes de la mejora; MInception con edad, sexo e IMC: MAE 4,75 mmHg (SBP) y 2,90 (DBP). |
| Estrés, generalización | [P] | Prajod, Mahesh, André. arXiv 2405.09563, 2024: 4 datasets (WESAD, SWELL-KW, ForDigitStress, VerBIO). El abstract no da la caída porcentual: la cifra "15-40 %" es [NV]. |
| LLM + wearables | [V] | Health-LLM (Kim et al., arXiv 2401.06866): 12 LLM, 4 datasets, 10 tareas; HealthAlpaca mejor en 8 de 10; hasta +23,8 % con contexto. PH-LLM (Cosentino et al., arXiv 2406.06474): 79 % en sueño y 88 % en fitness, 857 casos. HealthSLM-Bench (arXiv 2509.07260, NeurIPS 2025 GenAI4Health workshop): sin cifras en el abstract. WearableQA y SensorQA: [NV]. |
| Modelos de series de tiempo | [P] | Existen: SensorLM (arXiv 2506.09108; 59,7 M de horas, >103.000 personas), MIRA (arXiv 2506.07584, NeurIPS 2025), SOTER (arXiv 2609.16804), HRV zero-shot (arXiv 2607.20027, CinC 2026), arXiv 2510.14254 (benchmark generalista vs especialista en PPG) y arXiv 2412.03427. **La afirmación "un baseline simple (LOCF) gana en varias tareas" no se verificó y su atribución a 2510.14254 es dudosa.** Licencias de Chronos, MOMENT y TimesFM [NV recheck]. |
| Temperatura central desde pulso (Kalman) | [P] | Buller et al., *Physiol Meas* 34:781-798, 2013, DOI 10.1088/0967-3334/34/7/781. No se abrió el abstract. N=83 y ±0,58 °C: [NV]. La página del USARIEM da sesgo -0,03 °C, SD 0,32, RMSE 0,30 °C, límites ±0,63 °C, sin decir con qué dataset. |
| Temperatura central con piel + flujo de calor + pulso | [P] | Welles et al., *Comput Biol Med* 99:1-6, 2018, PMID 29803944. RMSE 0,18 °C (pectoral 0,18 ± 0,04; costilla 0,18 ± 0,09) solo en resultados de búsqueda. Usa 3 señales, no solo pulso. |
| Presión sistólica en la ISS (Waterloo/CSA) | [NV] | Comunicado de EurekAlert (649440): camiseta Bio-Monitor (Hexoskin), primer autor Carmelo Mastrandrea, ~72 h antes y ~72 h en órbita, "estimación continua" de presión sistólica. Sin valores ni métricas; no hay paper revisado hallado. |
| Bio-Monitor / Astroskin (CSA) | [NV recheck] | Página de la CSA citada por una búsqueda previa; no se reabrió. |
| Thermolab / Double Sensor (DLR/ESA) | [P] | Voló a la ISS en 2009 (DLR). Validación en Tierra de -0,16 a 0,1 °C vs rectal en 20 sujetos (abstract de Physiological Society). ESA reporta 10 astronautas y el resumen IAC-18, 11. No usar la cifra "+1 °C en 2 meses" (solo prensa). |

## 7. Datos de señales fisiológicas
Conclusión: **no se encontraron señales crudas abiertas de vuelo espacial, Mars-500, HI-SEAS ni SIRIUS** (búsqueda no exhaustiva).

| Dataset | Estado | Señales | N | Licencia | Acceso |
|---|---|---|---|---|---|
| BIDMC | [V] | PPG, resp. por impedancia, ECG a 125 Hz; HR, RR, SpO2 a 1 Hz | 53 registros de 8 min (no sujetos únicos); 207,7 MB | ODC-By 1.0 | descarga abierta |
| PPG-DaLiA | [P] | BVP 64 Hz, EDA, temp., acel., ECG de referencia | 15; 2,7 GB | CC BY 4.0 | UCI |
| MMASH | [V] | IBI/RR, HR, ACC, pasos, sueño, cuestionarios, cortisol y melatonina; 23,5 MB | 22 varones sanos | ODbL 1.0 | abierto |
| LifeSnaps (Zenodo 6826682, v4) | [V] | Fitbit Sense + encuestas, 35+ tipos, >4 meses; 615 MB | 71 | CC BY 4.0 | abierto. La v2 (6832186) está restringida y obsoleta |
| WESAD | [P] | RespiBAN 700 Hz: ECG, EDA, EMG, resp., temp., ACC. Empatica E4: BVP 64 Hz, EDA 4 Hz, temp. 4 Hz, ACC 32 Hz | 15 | UCI no declara licencia; "no comercial + crédito" [NV] | Siegen o `ucimlrepo` id=465 |
| MIMIC-III waveform matched | [P] | formas de onda de UCI | 10.282 pacientes | PhysioNet (términos [NV]) | descarga; población no sana |
| Sleep-EDF Expanded | [NV recheck] | EEG/EOG/EMG | 197 PSG | ODC-BY según PhysioNet; un espejo dice ODbL | PhysioNet |
| LunAres (2 sem, 2018) | [NV] | logs diarios (peso, FC, presión, sueño, nutrición, ejercicio) | sin dato | sin dato | PDF y página del autor dieron 404; datos no ubicados |
| OSDR / Inspiration4 | [P] | ómica y clínica | 4 | pública (procesado) | OSDR; crudo por comité. Cita correcta: Sanders et al., *npj Microgravity* 10:56, 2024 (artículo de acceso a datos) |
| LSAH / LSDA | [P] | clínicos e investigación | n/a | n/a | solicitud con IRB; plazos de presentaciones de 2012-2017; inviable hoy |
| Bed rest HDT (Solbiati y Caiani 2025) | [P] | HRV de campañas de bed rest | "66 hombres, 6 campañas" [NV] | n/a | sin repositorio verificado. **Es bed rest, no vuelo** |

## 8. Límites a declarar en el pitch
- Todo validado en Tierra; nada en astronautas. No es dispositivo médico.
- Sin acceso a LSAH/LSDA. Fase 2 es diseño.
- El overlay anatómico del escáner AR es genérico, no del paciente; no es diagnóstico.
- Visión: la evidencia con cámara de teléfono es moderada; las cifras buenas de pupila usan infrarrojo. El único estudio de MRD2 en astronautas figura como retractado.
- Sin evidencia verificada de rPPG en astronautas.

## 9. Pendiente de cerrar
- Aviso de retractación del estudio de astronautas (Wiley o Retraction Watch).
- Texto completo de Lee 2020 y Mader 2011 (acceso institucional): resolver la prevalencia de SANS.
- Abstract de Buller 2013 y texto de Welles 2018.
- Papers de origen del iris de 11,7 mm; papers de Amsler digital; PMC10108649 (PERCLOS con webcam); Annals of Medicine 2021 (MRD).
- Confirmar iris en el model card de Face Landmarker; licencias de los modelos.
- Licencias de PAPILA, ORIGA, REFUGE y G1020; WESAD en la página de Siegen.
- Medir CPU/edge real (PaPaGei, modelos de series de tiempo).
- Primarios del mecanismo de SANS (Marshall-Goebel 2019, Laurie 2020, Lawley 2017).
- Origen de la cifra de ~50 mL y del estudio de 1991, si es que existen.
- Datos de LunAres, Mars-500, HI-SEAS y SIRIUS por nombre en Zenodo, PhysioNet y OSDR.

## 10. Fuentes con links directos
Los links vienen de las verificaciones. Los marcados ⚠ no se pudieron abrir o tienen discrepancia.

### Visión por computador
- MediaPipe Face Landmarker: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
- Blog de Google, iris y profundidad: https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation
- Attention Mesh: https://arxiv.org/abs/2006.10962
- Pupila en tiempo real: https://arxiv.org/abs/2006.11341
- Soukupová y Čech 2016 (EAR): buscar "Real-Time Eye Blink Detection using Facial Landmarks", CVWW 2016
- PERCLOS, NHTSA DOT HS 808 762 (1998): buscar el informe por número
- Pupilometría con teléfono, Solyman et al. 2022 (Clin Ophthalmol, Dovepress): buscar el título en Dovepress
- MRD con iPhone, Chen et al. 2021: https://pmc.ncbi.nlm.nih.gov/articles/PMC8538024/
- Peek Acuity, JAMA Ophthalmol 2015: https://pubmed.ncbi.nlm.nih.gov/26022921/
- rPPG-Toolbox: https://arxiv.org/abs/2210.00716

### Ocular y SANS
- Mader 2011: https://pubmed.ncbi.nlm.nih.gov/21849212/
- Lee 2020 (npj Microgravity): https://pmc.ncbi.nlm.nih.gov/articles/PMC7005826/
- NASA HRP, riesgo SANS: https://humanresearchroadmap.nasa.gov/Risks/risk.aspx?i=105
- Brunstetter 2025: https://pubmed.ncbi.nlm.nih.gov/41066117/
- Rodrigues 2025 (mecanismo): https://pubmed.ncbi.nlm.nih.gov/40456790/
- Martin Paez 2020: https://pubmed.ncbi.nlm.nih.gov/33117025/
- Mampre 2025: https://pubmed.ncbi.nlm.nih.gov/40643392/
- Nguyen 2025 (contramedidas): https://pubmed.ncbi.nlm.nih.gov/39971096/
- Meer 2025 (72 estudios): https://pubmed.ncbi.nlm.nih.gov/40890229/
- BONSAI, NEJM 2020: https://pubmed.ncbi.nlm.nih.gov/32286748/
- FOTO-ED, 2024: https://pubmed.ncbi.nlm.nih.gov/37926337/
- Gungor 2026 (⚠ solo título): https://pubmed.ncbi.nlm.nih.gov/40867029/
- Estudio de astronautas, MRD2 (⚠ RETRACTADO según la página): https://journal.hep.com.cn/eer/EN/10.1002/eer3.70043
- REFUGE: https://refuge.grand-challenge.org/Details/
- G1020: https://arxiv.org/abs/2006.09158
- PAPILA: https://doi.org/10.1038/s41597-022-01388-1
- Catálogo de datasets de glaucoma: https://github.com/TheBeastCoding/glaucoma-dataset-metadata

### Modelos y soft sensors
- PaPaGei: https://arxiv.org/abs/2410.20542 · código: https://github.com/Nokia-Bell-Labs/papagei-foundation-model · pesos (sin licencia declarada): https://zenodo.org/records/13983110
- Pulse-PPG: https://arxiv.org/abs/2502.01108
- PPG-Distill: https://arxiv.org/abs/2509.19215
- Destilación para estimar pulso: https://arxiv.org/abs/2511.18829
- UNIPHY+: https://arxiv.org/abs/2509.16348
- NBPDB: https://arxiv.org/abs/2602.04725
- Estrés: https://arxiv.org/abs/2405.09563
- Health-LLM: https://arxiv.org/abs/2401.06866 · PH-LLM: https://arxiv.org/abs/2406.06474 · HealthSLM-Bench: https://arxiv.org/abs/2509.07260
- SensorLM: https://arxiv.org/abs/2506.09108 · MIRA: https://arxiv.org/abs/2506.07584 · SOTER: https://arxiv.org/abs/2609.16804 · HRV zero-shot: https://arxiv.org/abs/2607.20027 · Benchmark PPG: https://arxiv.org/abs/2510.14254 · https://arxiv.org/abs/2412.03427
- Chronos: https://github.com/amazon-science/chronos-forecasting · MOMENT: https://github.com/moment-timeseries-foundation-model/moment (arXiv 2402.03885) · TimesFM: https://github.com/google-research/timesfm
- Buller 2013: https://doi.org/10.1088/0967-3334/34/7/781 · USARIEM: https://usariem.health.mil/index.cfm/research/products/cbt_algorithm
- Welles 2018: https://pubmed.ncbi.nlm.nih.gov/29803944/
- Waterloo/CSA (comunicado): https://www.eurekalert.org/news-releases/649440
- Thermolab (DLR 2009): https://www.dlr.de/en/latest/news/2009/20091015_from-charit-into-space-thermolab-experiment-starts-on-the-iss_20458/@@download/file
- Double Sensor (Physiological Society): https://www.physoc.org/abstracts/core-body-temperature-changes-under-different-physical-and-environmental-conditions-on-earth-and-in-space/
- ESA, ritmo circadiano: https://www.esa.int/Our_Activities/Human_Spaceflight/Research/Keeping_the_rhythm_in_space · IAC-18: https://iafastro.directory/iac/archive/browse/IAC-18/A1/2/43234/

### Datos
- BIDMC: https://physionet.org/content/bidmc/1.0.0/ · MMASH: https://physionet.org/content/mmash/1.0.0/ · PPG-DaLiA: https://archive.ics.uci.edu/dataset/495/ppg+dalia · WESAD: https://archive.ics.uci.edu/dataset/465/wesad
- LifeSnaps: https://zenodo.org/records/6826682 · paper: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9622868/
- MIMIC-III waveform matched: https://www.physionet.org/content/mimic3wdb-matched/1.0/p03 · Sleep-EDF: https://physionet.org/content/sleep-edfx/
- NASA LSDA/LSAH: https://lsda.jsc.nasa.gov/explore/lsdahome/datarequest
- OSDR: https://science.data.nasa.gov/features-events/osdr-spotlight · Sanders et al. 2024: https://doi.org/10.1038/s41526-024-00393-5
- Bed rest, Solbiati y Caiani 2025: https://doi.org/10.1038/s41526-025-00509-5 · ESA Bedrest Core Data: https://explorationscience.esa.int/?p=889
- LunAres (⚠ 404): https://simonbouriat.github.io/files/Bouriat_2021_physiological_inventory_data_lunares.pdf
- NASA DAP (gemelo digital): https://ntrs.nasa.gov/citations/20170007202

## 11. Verificación del escáner AR (14 nov 2026)
Fuente: `Antecedentes/NOVA-arquitectura.pdf` (13 nov), revisado con `pdftotext`, y BodyParts3D v4.0 (descarga oficial de DBCLS).

| Duda | Resultado | Estado |
|---|---|---|
| ¿Las 689 estructuras incluyen el ojo? | El PDF: "689 estructuras, BodyParts3D y HuBMAP (CC BY 4.0). Esqueleto completo y órganos animados por el gemelo". No menciona el ojo en ninguna parte. La lista `partof_parts_list_e.txt` de BodyParts3D v4.0 contiene globo ocular, iris, córnea, cristalino, esclera, coroides, cuerpo vítreo, párpados superior e inferior, órbita y los músculos extraoculares (rectos, oblicuos, elevador del párpado). **No contiene** "retina" ni "optic nerve". Qué entró a las 689 no se puede saber sin los datos de `nova-pc`. | [P] |
| Licencia de BodyParts3D | El PDF dice CC BY 4.0. El README de BodyParts3D dice "Creative Commons Attribution-Share Alike 2.1 Japan" (CC BY-SA, con share-alike). Revisar. | [V] discrepancia |
| ¿Cámara trasera o frontal? | El PDF no lo especifica. Dice: el teléfono manda JPEG de 512 px, dibuja la anatomía calzada, predice el movimiento con el giroscopio (filtro de 0,7 Hz y predicción máxima de 60 ms); sin respuesta en 2,5 s usa su propia visión; el servidor entrega 33 puntos de pose, 21 por mano y máscara del paciente; "paciente = el torso más horizontal a la vista". Que el cuerpo use la cámara trasera era un supuesto mío. | [V] no especificado |
| ¿Alcanza una foto de 512 px? | Estimación propia con supuestos (cara ≈ 60 % del ancho; distancia entre ojos ≈ 45 % del ancho de la cara; iris 11,7 mm sobre ~63 mm entre pupilas): distancia entre ojos ≈ 138 px, iris ≈ 26 px, pupila ≈ 8 px; 1 px ≈ 0,46 mm. El error de 0,37 mm de MRD2 (Chen 2021) es menor a 1 px. El detector de EAR "falla con IOD menor a 20 px" (Soukupová y Čech): con ~138 px no es el límite. Para pupila y MRD2 hará falta mayor resolución o procesar en el teléfono. | [INF] |
| ¿Latencia por `/v1/vision/ws`? | El PDF: MediaPipe Pose + Hands en la GPU, "unos 15 ms por cuadro". `/v1/vision/ws` figura como WebSocket local del puente de visión en el computador, no como el enlace del teléfono. La latencia del módulo ocular no se puede medir sin `nova-pc`; el spike mide solo Face Landmarker local (la prueba de humo en CPU dio 1,56 ms de mediana sobre un cuadro negro; la medición real con cara está pendiente). | [P] |
| ¿Existe un protocolo de lesión ocular? | No. Los 12 protocolos del PDF: paro cardíaco, desmayo (síncope), hipoglucemia, oxígeno bajo, CO2 alto en cabina, anafilaxia, atragantamiento, fiebre, convulsión, descompresión, sueño y ánimo, hemorragia. Diez tienen pasos en AR (el PDF no dice cuáles). Ninguno de los 5 PDFs de `Antecedentes/` menciona el ojo, salvo una nota sobre un LED de la placa. | [V] |

## 12. Modelo utilizado: MediaPipe Face Landmarker (ficha técnica)
Fuentes: archivo `models/face_landmarker.task` inspeccionado localmente [V medido]; página oficial de Google AI Edge (`developers.google.com/edge/mediapipe/solutions/vision/face_landmarker`) [V]; fichas del modelo (model cards) de Google, leídas con `pdftotext` [V].

### Qué es el archivo
Un paquete (`.task`, formato zip) de 3.758.596 bytes, sha256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`, descargado de `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`. Contiene [V medido]:

| Archivo interno | Tamaño | Función |
|---|---|---|
| `face_detector.tflite` | 229.746 B | Detector de cara (BlazeFace, alcance corto) |
| `face_landmarks_detector.tflite` | 2.553.590 B | Modelo de puntos 3D de la cara (FaceLandmarker-V2) |
| `face_blendshapes.tflite` | 955.312 B | Modelo de 52 puntajes de expresión |
| `geometry_pipeline_metadata_landmarks.binarypb` | 19.376 B | Metadatos de geometría (matriz 4x4 de transformación) |

### Especificaciones
| Modelo | Dato | Fuente |
|---|---|---|
| Detector (BlazeFace short range) | Red convolucional tipo SSD con codificador propio; 224 KB; "~275 FPS en un solo núcleo de CPU de Pixel 2 con XNNPACK"; Apache 2.0; entrada 128x128 según su ficha, 192x192 según la página de la tarea (discrepancia entre fuentes); devuelve caja y 6 puntos clave | [V] ficha y página |
| Puntos (FaceLandmarker-V2) | Red convolucional "MobileNetV2-like con bloques personalizados"; entrada: cara recortada con 25 % de margen y escalada a 256x256; salida: 478 puntos 3D aplanados (x, y en píxeles de imagen; z relativo al centro de masa de la cara y escalado a su ancho), un indicador de presencia de cara (umbral 0,5 por defecto) y un subconjunto de blendshapes; licencia Apache 2.0; autores Geng Yan e Ivan Grishchenko (Google); fecha 15 sep 2022 | [V] ficha |
| Blendshapes | Entrada 1x146x2, salida 52 puntajes; datos float16 en el paquete | [V] página (su ficha no se leyó) |
| Salida de la tarea | 478 puntos 3D, 52 blendshapes (opcional), matriz 4x4 de transformación (opcional) | [V] página |
| Iris | La página y la ficha dicen "478 puntos" sin nombrar el iris. Que los índices 468-477 sean el iris se confirmó midiendo (spike del 14 nov). | [V] medido |
| Relación con los papers | Attention Mesh (arXiv 2006.10962) y pupila en tiempo real (arXiv 2006.11341) existen; que FaceLandmarker-V2 sea exactamente esa arquitectura no está declarado. | [NV] |

### Uso previsto y límites (ficha de FaceLandmarker-V2)
- **Uso previsto:** detección de landmarks faciales en video monocular, "optimizado para videos capturados con cámaras frontales de teléfonos"; aplicación principal: realidad aumentada de entretenimiento.
- **Fuera de alcance:** "no está pensado para decisiones críticas para la vida humana". NOVA respeta esto al emitir solo "alerta de seguimiento" y no diagnosticar.
- **Entrada:** el video debe capturarse en modo selfie. No es adecuado con la cara girada más de 80°, inclinada más de 8° de la vertical, visible menos del 50 %, o demasiado lejos. Tolerancia: 10 % de desplazamiento y escala, 8° de roll. La imagen debe estar rotada de modo que una línea horizontal una los centros de los ojos.
- **Entorno:** con poca luz, ruido, movimiento o cara parcialmente tapada, la calidad baja y aumenta el "jitter" (ruido entre cuadros).
- **Datos de entrenamiento:** imágenes de diversas cámaras de teléfono, frontales y traseras, en entornos reales, vía una aplicación de AR. Tamaño del conjunto: no declarado.

### Precisión (ficha)
- Métrica: error absoluto medio normalizado por la distancia entre ojos (IOD MAE).
- Modo seguimiento: de **2,06 % a 3,27 %** entre 17 subregiones geográficas (1.700 imágenes, 100 por región); modo readquisición (primer cuadro): de 2,67 % a 3,85 %.
- Referencia humana: 2,56 % IOD MAE de discrepancia entre 11 anotadores sobre 58 muestras.
- Por tono de piel (Fitzpatrick 1 a 6): seguimiento 2,49 % a 2,90 %; readquisición 3,09 % a 3,75 %. Por género: 2,61 % y 2,62 %.
- **No evalúa** color de ojos, uso de lentes ni la posición de los párpados.

### Implicaciones para NOVA
- [INF] Con ~81 px entre ojos (medido a 512 px en la webcam de Niko, sección 14; la estimación previa de 138 px era alta), 2,6 % ≈ 2,1 px ≈ 1,6 mm suponiendo 63 mm entre pupilas. Es una cota para el error medio de toda la malla, no para los párpados, pero supera el 0,37 mm de MRD2 de Chen 2021 (que usó otro método, deep learning). Conclusión de diseño: usar cambios de cada persona contra su línea base y medir el jitter, no milímetros absolutos.
- La ficha pide modo selfie. La cámara trasera sobre otra persona (modo supervisado) está menos cubierta: probar y registrar el desempeño por cámara.
- La cabeza libre en microgravedad puede superar el límite de 8° de inclinación: probar con la cabeza inclinada.
- Pupila y color de ojos oscuros no están evaluados en la ficha.

### Instalación usada
Python 3.13.12, mediapipe 1.2.3, opencv-python 5.0.0.93, numpy 2.5.4. Delegate CPU de MediaPipe Tasks con XNNPACK, modo VIDEO, `num_faces=1`. Medido en la webcam de Niko (14 nov): 478 puntos, iris presente, detección 90 de 90, latencia 7,76 ms de mediana y 8,97 ms p95.

### Links
- Página de la tarea: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
- Ficha FaceLandmarker-V2: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf
- Ficha BlazeFace short range: https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf
- Ficha Blendshape V2 (no leída): https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf
- Paquete del modelo: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task

## 13. Resultado de la prueba a 512 px (14 nov 2026)
Medido con la webcam de Niko, 90 cuadros, buena luz, cara a distancia normal. Ruta simulada: reducir a 512 px de ancho con INTER_AREA, codificar y decodificar JPEG calidad 80 (**la calidad real del escáner no se conoce: supuesto**), inferir. Detalle y tabla en `docs/spike-resultados.md`.

| Métrica | Completa | 512 px |
|---|---|---|
| Detección de cara | 90/90 | 90/90 |
| Iris OK (10 puntos) | 90/90 | 90/90 |
| Diámetro del iris, mediana | 21,2 px | 17,0 px |
| Jitter del centro del iris, mediana | 7,97 px | 6,35 px |
| Latencia de inferencia, mediana / p95 | 8,09 / 8,63 ms | 7,70 / 8,19 ms |

**Lectura** [V medido, salvo lo marcado]:
- La detección y la presencia del iris aguantan a 512 px en este caso: una persona, buena luz, cara cercana y de frente.
- El iris mide 17 px a 512 px. La estimación previa de 26 px (sección 11) era alta porque la cara ocupaba menos del cuadro. [INF] Con 17 px de iris y 11,7 mm de iris (valor del blog de Google, sin paper de origen), 1 px ≈ 0,69 mm y una pupila de 2 a 4 mm mediría 3 a 6 px: no es medible con puntos de landmarks a ese tamaño. Pupila requiere una imagen más grande o procesar en el teléfono.

**Advertencias sobre la propia prueba:**
- **El jitter está contaminado por el movimiento real de la cabeza.** Se define como la desviación estándar de la posición del centro del iris sobre 30 cuadros, así que incluye cuánto se movió la persona. 6 a 8 px no es ruido del modelo. Hay que repetirlo con la cabeza quieta o cambiar la métrica (por ejemplo la variación del diámetro del iris, o la posición del centro relativa a las comisuras del ojo).
- [INF] La razón entre los diámetros (17,0 / 21,2 ≈ 0,80) sugiere que la webcam entrega 640 px de ancho, es decir, la "resolución completa" de esta prueba es 640x480 y no una cámara de alta resolución. La resolución del cuadro no se imprime; hay que registrarla.
- No cubre lentes, poca luz, cabeza inclinada, ojos marrones ni la cámara trasera.
- La latencia es solo la inferencia, sin reducción ni JPEG.

## 14. Barrido de condiciones del spike v2 (14 nov 2026)
Medido con la webcam de Niko (frontal, luz de escritorio, sin lentes, ~50 cm, sujeto S01), 240 cuadros capturados una vez y procesados con las mismas condiciones, en modos IMAGE y VIDEO. Tablas completas en `docs/spike-resultados.md` ("Check v2 con barrido").

**Registro** [V medido]: cuadro de 640x480 (la resolución completa de la webcam es 640x480, lo que confirma la sospecha de la sección 13), 30 fps, backend MSMF, mediapipe 1.2.3, modelo con sha256 `64184e22...c9ff`.

| Dato | IMAGE | VIDEO |
|---|---|---|
| Detección e iris OK, en las 31 condiciones | 100 % | 100 % |
| Distancia entre ojos / diámetro del iris a 512 px | 80,6 / 15,2 px | 82,7 / 15,7 px |
| Distancia entre ojos / iris en 640 px nativo | ~101 / 19,0 px | ~103 / 19,7 px |
| Distancia entre ojos / iris a 256 px | ~41 / 7,6 px | ~41 / 7,7 px |
| Latencia a 512 px q80 (mediana / p95, con reducción y JPEG) | 10,96 / 12,36 ms | 9,64 / 10,93 ms |
| Latencia con roll compensado (doble inferencia) | ~22 a 24 ms | ~19 a 21 ms |

**Ruido de alta frecuencia** (σ_hf, ×1e-3, promedio de ambos ojos, referencia 512 px q80). Mide la variación cuadro a cuadro y no se contamina con el movimiento lento:

| Métrica | IMAGE (cada foto independiente, como en el escáner) | VIDEO (suavizado temporal) |
|---|---|---|
| EAR | 6,95 | 2,92 |
| Apertura A (en diámetros de iris) | 18,13 | 6,82 |
| MRD2n (proxy) | 9,24 | 3,91 |

[INF] Con iris de 11,7 mm: σ_hf de A ≈ 0,21 mm por foto en IMAGE y ≈ 0,08 mm en VIDEO. El modo IMAGE tiene unas 2,4 veces más ruido que VIDEO, y es el que corresponde a fotos sueltas.

**Robustez:** la detección y el iris no cayeron en ninguna condición, incluso a 256 px, JPEG q50, poca luz simulada, ruido σ=10, desenfoque σ=2 y roll de 45° sin compensar. El ruido de A subió solo moderadamente (256 px: 17 a 25; poca luz: 23,7; ruido σ=10: 20,3, frente a 18,1 de la referencia). Esto vale para una persona, de frente y en buena luz.

**Residuo de Procrustes** (RMS, % de IOD, referencia 512 px q80, IMAGE / VIDEO): iris 2,39 / 2,79, párpados 2,47 / 3,06, malla 2,86 / 2,84. Está en el mismo orden que el error medio de la ficha (2,06 % a 3,27 %), aunque no es la misma métrica.

**Problema encontrado: el gate de quietud aprobó 0 % de los cuadros** en la referencia (12 a 13 % en unas pocas condiciones), en IMAGE y VIDEO. El criterio de aceptación (≥ 80 %) NO se cumple. Consecuencia: todos los MDC salen con asterisco, es decir, calculados sin gate e incluyendo movimiento de cabeza y parpadeos. El valor de MDC de A (~0,17 diámetros de iris, ~2 mm [INF]) es una cota superior no usable. Qué criterio falla (velocidad, roll, IOD, yaw/pitch o falta de matriz de transformación) no se sabe; se está diagnosticando con un modo `--gate-diagnose`.

**Corrección:** la estimación de la sección 11 (distancia entre ojos ~138 px a 512 px) era alta; lo medido es ~81 px. La cota de 1,6 mm de error de landmarks (2,6 % de IOD) no cambia, pero equivale a ~2,1 px y no a 3,6 px.

**Suelo de ruido:** el primer intento falló porque `!` no tiene teclado interactivo (`input()` dio EOF). Corregido con `--start-delay` y pitidos al empezar y terminar cada bloque (commit `96e3282`). Pendiente hasta arreglar el gate, porque usa solo cuadros que pasan el gate.

## 15. Diagnóstico del gate de quietud (14 nov 2026, 15:56)
Medido con `--gate-diagnose` en la webcam de Niko: 150 cuadros a 30,6 FPS, 120 ventanas de 1 s, ruta 512 px q80, modo VIDEO, persona quieta y mirando al frente. Detalle en `docs/spike-resultados.md`.

| Criterio | Umbral | Mediana | p95 | Máx |
|---|---|---|---|---|
| Velocidad (mediana, % de IOD por cuadro) | < 0,5 | 0,124 | 0,272 | 0,272 |
| Rango de roll (°) | < 2 | 0,30 | 0,44 | 0,57 |
| Rango de IOD (%) | < 2 | 0,93 | 1,23 | 1,61 |
| Rango de yaw (°) | < 3 | 0,42 | 0,54 | 0,61 |
| Rango de pitch (°) | < 3 | 0,38 | 0,56 | 1,06 |
| Pérdida de cara | 0 | 0 | 0 | 0 |

- La matriz de transformación 4x4 llegó en el 100 % de los cuadros [V medido].
- Con los umbrales originales, **el 100 % de las ventanas pasa el gate** cuando la persona está quieta. No hace falta recalibrar. Los umbrales "sugeridos" (p80 observado) son circulares y no deben usarse.
- **La causa del 0 % del barrido anterior no está determinada.** Candidatos: (a) el barrido empezaba a capturar apenas se lanzaba el comando, sin cuenta regresiva, así que la persona probablemente aún se movía; (b) el rango de yaw y pitch no se envolvía alrededor de ±180° (corregido); (c) la velocidad se calculaba duplicada (corregido; pero la mediana corregida es 0,124, o 0,25 con el cálculo antiguo, por debajo de 0,5, así que por sí solo no explicaría el 0 %).
- Acciones: cuenta regresiva y pitidos en el barrido (hecho), vista en vivo con espera de quietud (en curso) y repetir el barrido.

### 15.1 Dos corridas con la vista en vivo (16:10 y 16:11)
| | Corrida 1 | Corrida 2 |
|---|---|---|
| Espera de quietud antes de grabar | lograda tras 2,0 s | lograda tras 1,6 s |
| Ventanas que pasan todos los criterios | **37,2 %** (45 de 121) | **100 %** (120 de 120) |
| Detección de cara / iris OK | 99,3 % / 99,3 % | 100 % / 100 % |
| Rango de IOD, mediana / máx | 2,12 % / 82,62 % | 0,78 % / 1,55 % |
| Rango de yaw, mediana / máx | 1,27° / 55,88° | 0,41° / 0,87° |
| Velocidad, mediana / máx (% de IOD por cuadro) | 0,426 / 6,341 | 0,115 / 0,308 |
| FPS medido | 30,1 | 30,6 |

- La espera de quietud funcionó en las dos corridas, pero **en la corrida 1 la persona se movió durante la grabación** (la distancia entre ojos llegó a variar 82 % y el yaw 56°, algo imposible por ruido del modelo). La corrida 2, quieta, pasó 100 %.
- Conclusión [V medido, una persona]: el gate distingue en los dos sentidos entre una captura quieta y una con movimiento. Los umbrales originales sirven; los "sugeridos" por la corrida 1 (p80: IOD < 48 %, yaw < 42°) serían absurdos y no deben usarse.
- Siguiente mejora: reintento automático de la captura cuando la quietud grabada es menor a 80 %.
- El FPS con la vista activa (30,1 y 30,6) no bajó frente a la corrida sin vista (30,6).

## 16. Barrido v2 con gate corregido (14 nov 2026, 16:22)
Webcam de Niko, 640x480, 30 fps, 240 cuadros, quietud durante la captura 100 % (1 intento). Tablas completas en `docs/spike-resultados.md`.

**Aceptación** [V medido]: detección e iris 100 % en las 31 condiciones y en ambos modos. Gate en la referencia 512 px q80: 84,6 % (IMAGE) y 100 % (VIDEO), cumple ≥ 80 %. Solo `dim` (poca luz simulada, IMAGE) baja a 70 %.

**Referencia 512 px q80, con gate (persona S01):**
| Métrica | IMAGE (fotos sueltas) | VIDEO |
|---|---|---|
| σ_hf de A (×1e-3 diám. de iris) | 12,96 | 1,21 |
| MDC95 de A (×1e-3 diám. de iris) | 28,35 | 20,54 |
| MDC95 de A en mm [INF, iris 11,7 mm] | 0,33 | 0,24 |
| MDC95 de MRD2n (×1e-3) | 12,30 | 8,08 |
| Residuo Procrustes iris / párpados / malla (% IOD) | 0,33 / 0,72 / 0,72 (iris/párp./malla: 0,33, 0,72, 0,78) | 0,24 / 0,41 / 0,36 |

**Lectura:**
- La apertura del párpado es medible con un cambio mínimo detectable del orden de 0,3 mm [INF] **dentro de una sesión, de una persona, quieta**. No incluye reposicionarse: eso lo mide el suelo de ruido (3 sesiones), pendiente.
- El ruido cuadro a cuadro de VIDEO es mucho menor por el suavizado temporal; el modo IMAGE es el que representa fotos sueltas.
- La degradación es moderada: a 256 px el MDC de A en IMAGE baja de 28 a ~10 (variación de muestreo, 8 bloques de 1 s: cota gruesa); con roll de 45° sin compensar el sesgo de A es +83e-3 frente a +32e-3 compensado, así que la contrarrotación mejora el sesgo a costa de doble latencia (~20 ms).
- Los sesgos pareados entre condiciones (hasta ±47e-3 en A) muestran que cambiar resolución, desenfoque o rotación **desplaza** la medida: la línea base debe tomarse con la misma ruta de imagen que la medición posterior.
- Límite: una persona, luz buena, 8 bloques de 1 s por condición.

## 17. Suelo de ruido con reposicionamiento (14 nov 2026, 17:39)
Webcam de Niko, 640x480, 30 fps, ruta 512 px q80, modo VIDEO, sujeto S01, mirando un punto rojo cerca de la cámara. **Sesiones 2, 3 y 4** (3 bloques de 20 s cada una; la sesión 1 se excluyó porque no parpadeó). Informe: `--noise-floor-report --exclude-sessions 1`. Tabla completa en `docs/spike-resultados.md`.

| Métrica | Ojo | σ_w | σ_b | MDC95 intra-sesión | MDC95 con reposicionamiento | en mm [INF] |
|---|---|---|---|---|---|---|
| EAR | R / L | 0,023 / 0,024 | 0,012 / 0,010 | 0,065 / 0,065 | 0,073 / 0,071 | - |
| Apertura A (diám. de iris) | R / L | 0,061 / 0,052 | 0,029 / 0,020 | 0,170 / 0,144 | 0,188 / 0,154 | 2,2 / 1,8 |
| MRD2n proxy | R / L | 0,035 / 0,026 | 0,026 / 0,023 | 0,098 / 0,071 | 0,121 / 0,095 | 1,4 / 1,1 |
| MRD1n proxy | R / L | 0,029 / 0,025 | 0,010 / 0,004 | 0,081 / 0,069 | 0,086 / 0,070 | 1,0 / 0,8 |
| D/IOD | - | 0,0032 | 0,0031 | 0,0087 | 0,0123 | - |

**Lectura** [V medido, una persona, 3 sesiones]:
- **El cambio mínimo detectable realista de la apertura del párpado es de ~1,8 a 2,2 mm [INF]**, no ~0,33 mm. El valor de la sección 16 salió de 8 s quietos en una sola sesión, sin parpadeos ni deriva de la mirada, y era demasiado optimista. Este incluye 60 s por sesión con parpadeos normales.
- **Reposicionarse suma poco:** σ_b es menor que σ_w en casi todas las métricas, y el MDC sube ~10 % (por ejemplo A derecho de 0,170 a 0,188). Lo que domina es el ruido dentro de la sesión.
- **MRD1n y MRD2n son más estables que A** (MDC con reposicionamiento ~0,8 a 1,4 mm [INF]).
- **Ojo derecho e izquierdo difieren** (A: 2,2 vs 1,8 mm), cosa esperable con una sola persona y una cámara no centrada.

**Límites** (importantes):
- **Solo 3 sesiones:** σ_b se estima con ddof=1 sobre 3 medias; es muy imprecisa.
- **La sesión 2 se grabó con el filtro de quietud anterior** (más estricto con el parpadeo); las 3 y 4, con el nuevo.
- **Es el MDC de un promedio de 1 s.** Promediar más tiempo lo baja, pero el modo VIDEO autocorrelaciona los cuadros: no se puede dividir por raíz de N.
- **Los parpadeos por bloque (7 a 15 en 20 s) son más de lo típico**; no se sabe si el detector sobrecuenta.
- Los mm suponen un iris de 11,7 mm. No hay verdad de referencia: no se puede afirmar precisión en mm.
- Una persona, luz buena, 640x480; no es el escáner ni microgravedad.

## 18. ¿Alcanza un cambio mínimo de ~1 a 2 mm? Evidencia clínica (14 nov 2026)
Fuentes: resúmenes vía Europe PMC REST (los textos completos de PubMed, PMC y Wiley estaban bloqueados). Certeza media-baja.

**Valores normales** (adultos, de pie):
| Dato | Valor | Fuente | Estado |
|---|---|---|---|
| MRD1 / MRD2 / fisura palpebral | 2,97 mm (IC95 2,70-3,24) / 5,57 (5,33-5,81) / 8,54 (8,19-8,90) | Wier et al., Ophthalmic Plast Reconstr Surg 2024;40(6):623-6, PMID 38534066 (43 pacientes, 86 ojos) | [V] solo IC, sin DE |
| MRD2 en 13 astronautas, en Tierra | 4,9 ± 0,7 mm | Ax et al. 2026 (retractado, ver abajo) | [V] con aviso |
| MRD1 con iPhone vs regla (ptosis) | sesgo -0,04 mm, límites de acuerdo -0,51 a 0,43 mm, ICC 0,968 | Tang et al., Medicine 2026;105(21), PMID 42175441 | [V] población con ptosis |
| Repetibilidad entre examinadores | ICC 0,913 a 0,980 en 11 rasgos incluidos MRD1, MRD2 y fisura | Chun et al., Acta Ophthalmol 2017;95:e625, PMID 28391655 | [P] |
Normas con desviación estándar para MRD2 y fisura, Boboridis 2001 y Bodnar: [NV].

**Cambios con la microgravedad y la postura** [V, resúmenes]:
| Condición | Cambio | Fuente |
|---|---|---|
| Vuelo parabólico (microgravedad) | **MRD2 −0,9 mm (p<0,001)**; MRD1 sin cambio (p=0,41); distancia pupila-ceja inferior +2,3 mm | Ax et al., Orbit 2025;44(5):535-543, PMID 40265683 |
| Hipergravedad (mismo estudio) | MRD1 −0,7 mm | ídem |
| Astronautas, fotos de la NASA | **MRD1 sin cambio significativo (p=0,21)**; distancia pupila-ceja +3,7 mm | Karlin et al., Ophthalmic Plast Reconstr Surg 2021;37(6):592-4, PMID 33710037 |
| Acostado vs de pie (no es cabeza abajo) | MRD1 −0,59 mm; MRD2 −0,56 mm; fisura −1,16 mm | Wier 2024 (diferencias calculadas a partir de las medias) |
- Un mismo cambio de postura mueve MRD1 y MRD2 en sentido distinto: acostado baja el párpado, microgravedad sube el inferior.
- Fatiga, sueño, ciclo del día y edema palpebral (alérgico o tiroideo) **en mm: sin datos hallados** [NV].
- **MCID, MDC o umbral clínico validado de MRD1, MRD2 o apertura: no se encontró ninguno** [NV]. En enfermedad ocular tiroidea se usó una respuesta de apertura ≥2 mm (Rymuza et al., Thyroid 2026, PMID 42117357), que es un criterio del estudio y no un MCID. Umbrales de ptosis, retracción y edema en mm: [NV]; verificar en BCSC o StatPearls (NBK539828).

**MRD2 en astronautas y la retractación:**
- Hay corroboración parcial independiente en vuelo parabólico (Ax 2025, −0,9 mm). En órbita real, para MRD2, solo existe Ax 2026 (4,9 → 3,9 mm).
- Ax 2026: la página de la revista dice "This article has been retracted" (nota: "updated to reflect reception of statements of disagreement from all authors"), sin fecha ni motivo. **Crossref no muestra retractación** (`relation` vacío, sin `updated-by`). Conflicto sin resolver; hay que abrir el aviso real en un navegador. No citar Ax 2026 como evidencia hasta entonces.

**Qué se podría y no se podría detectar con el MDC medido** [INF, ~1-2 mm]:
| Cambio | ¿Detectable en una persona? |
|---|---|
| Ptosis moderada o severa, retracción tiroidea franca | Sí |
| Respuesta de apertura ≥2 mm (EOT) | Límite |
| MRD2 −0,9 a −1,0 mm (microgravedad) | Límite; probablemente solo promediando varias medidas o en grupo |
| MRD1 en microgravedad | No hay cambio documentado: no hay señal que detectar |
| Acostado vs de pie (−0,6 mm) | No |
| Fatiga, ciclo del día, edema leve | Sin datos en mm: no se puede afirmar |
- **Corrección a lo dicho antes:** MRD1 es la medida más estable (MDC ~0,8-1,0 mm) pero **no cambia en microgravedad**, así que su estabilidad no ayuda a detectar hinchazón. MRD2 sí cambia (~1 mm) pero su MDC (~1,1-1,4 mm) está al límite. La candidata natural es MRD2 con varias medidas por sesión y comparada con la línea base individual.
- La DE poblacional de MRD2 (~0,7 mm [INF]) es del mismo orden que el MDC: comparar con una norma poblacional no sirve, solo contra la línea base de cada persona.

## 19. Síntesis: qué detectores se pueden sostener (14 nov 2026)
Fuentes: tres revisiones con Europe PMC (resúmenes; textos completos bloqueados). Certeza media-baja. Los números de la tabla de detectores combinan lo medido en nuestro spike con esas revisiones.

### 19.1 Somnolencia (PERCLOS y parpadeo)
- [V, abstract] PERCLOS P80 (% de tiempo con el ojo más de 80 % cerrado) se asocia con somnolencia por privación de sueño y por ritmo circadiano en laboratorio con equipos dedicados (Abe, Sleep Advances 2023, PMID 37193281; Ftouni, J Biol Rhythms 2013 y J Clin Sleep Med 2015). La definición varía entre estudios (80 %, 70 %, 25-30 % de apertura).
- [V, abstract] Metaanálisis de 61 estudios (1.441 participantes): pendiente de PERCLOS-80 frente al deterioro de conducción 0,02 (IC 0,01-0,04), certeza GRADE baja (Davin, Sleep Med Rev 2026, DOI 10.1016/j.smrv.2026.102380). "No single index is currently available as an optimal marker" (Abe 2023).
- [V, abstract] A 30 fps se pierde la dinámica del parpadeo: velocidades máximas subestimadas por debajo de 250 fps; amplitud y duración total, aceptables (Navascues-Cornago, Ocul Surf 2026, DOI 10.1016/j.jtos.2026.01.003).
- [NV] Sensibilidad y especificidad de PERCLOS con webcam/EAR; correlaciones de Dinges 1998 (el PDF original no se pudo leer; el r = 0,875 de secciones anteriores sale de un resumen); cualquier dato de parpadeo o PERCLOS en espacio o aislamiento.
- Formulación defendible: "indicador de apoyo, comparado con la línea base individual", no "detector de somnolencia".

### 19.2 Fatiga visual y ojo seco (parpadeo)
- [V] Parpadeo con pantalla: 11,6/min (DE 7,8; n=21; Portello 2013, DOI 10.1111/opo.12013 [NV el DOI exacto]) y 14,9/min en pantalla frente a 13,6/min en papel (Chu 2014, DOI 10.1097/opx.0000000000000157). Reposo ~17/min, lectura 4-5/min, conversación ~26/min [P, cita secundaria vía Brych 2021, DOI 10.1371/journal.pone.0258322].
- [V] Parpadeos incompletos en pantalla: 16,1 % (Portello 2013) y 7,0 % (Chu 2014). Los dos estudios discrepan sobre si se relacionan con síntomas (n=21 y n=25).
- [V] La tasa baja por carga cognitiva y no solo por pantallas (Chu 2014; Bend, J Eye Mov Res 2026, DOI 10.3390/jemr19020028).
- [P] Con webcam, un estudio exploratorio (n=13, 4 a 30 fps) halló que el puntaje de síntomas bajaba 1,26 por cada parpadeo adicional (Lapa, IJERPH 2023, DOI 10.3390/ijerph20054569). BlinkNet-Q (Xu, Transl Vis Sci Technol 2026, DOI 10.1167/tvst.15.9.4): ICC 0,973 para la tasa, ICC 0,937 y AUC 0,884 para parpadeos incompletos; prueba de concepto en condiciones estandarizadas.
- [V] TFOS DEWS II: el diagnóstico de ojo seco exige cuestionario (OSDI/DEQ-5) más pruebas de superficie ocular; el parpadeo no es una prueba diagnóstica. Una revisión de 2026 (Ong, Eye) concluye que las métricas de parpadeo con apps o webcam tienen "insufficient validation".
- [V] Astronautas: síntomas oculares post-vuelo en 257 astronautas: irritación 34 %, cuerpo extraño 21 %, ojo seco 14 % (autorreporte; Ong, Life Sci Space Res 2025, DOI 10.1016/j.lssr.2025.05.005). El parpadeo en vuelo no se había estudiado hasta 2023 (Ax, Front Physiol 2023, DOI 10.3389/fphys.2023.1281327).
- [INF] A 30 fps una fase de cierre de ~100 ms son ~3 cuadros: la amplitud parcial queda muy submuestreada. Mejor reportar un índice de apertura mínima con incertidumbre que un "% de incompletos" diagnóstico.
- Formulación defendible: "señal de riesgo de sequedad o fatiga visual, comparada con la línea base individual; no diagnostica".

### 19.3 Hinchazón de párpados como tendencia
- [V] Distancia pupila-ceja (PTB): +3,7 mm en 18 astronautas, 112 fotos (Karlin 2021, PMID 33710037) y +2,3 mm en vuelo parabólico (Ax, Orbit 2025, PMID 40265683). MRD1 no cambia en ninguno. En parabólico MRD2 baja (−0,9 mm [P: el abstract obtenido estaba truncado]).
- [V] Acostado frente a de pie: MRD1 2,97 a 2,38 mm, MRD2 5,57 a 5,01 mm, fisura 8,54 a 7,38 mm (Wier 2024, PMID 38534066).
- [V] Landmarks automáticos: diferencia media absoluta de 0,5 mm en MRD1 y MRD2 frente a humanos y 1,5 a 2 mm en la altura de la ceja (Van Brummen, PeriorbitAI, Am J Ophthalmol 2021, PMID 34010596); ICC > 0,90 (Rana 2025, PMID 38710195).
- [V] Asimetría de fisura ≥ 1 mm en ~6 % de sanos (Lam 1995, PMID 7573311) y en ~25 % (Song 2007, PMID 17293281): 1 mm de asimetría es frecuente, no sirve como alarma absoluta.
- [NV] mm de cambio por edema alérgico, tiroideo o por sueño; repetibilidad entre días de MRD; efecto de sal o alcohol; norma de la diferencia derecha-izquierda de MRD; aplicación de CUSUM o EWMA a medidas palpebrales.
- [INF] Número de medidas para detectar 1 mm contra una línea base conocida, con α=0,05 y potencia 80 %: ~8 con ruido de 1 mm y ~31 con 2 mm; el doble si la base también se estima. Deben ser de sesiones separadas, no cuadros seguidos.
- Formulación defendible: "NOVA mide y sigue la tendencia de la posición de párpados y ceja; no detecta edema".

### 19.4 Tabla de detectores
| Detector | Métrica que lo sostiene | Evidencia | ¿Alcanza nuestro ruido (~1 a 2 mm)? | Qué falta |
|---|---|---|---|---|
| Somnolencia (apoyo) | PERCLOS aprox., duración total del parpadeo | Laboratorio, equipos dedicados; certeza baja en conducción | Sí (es proporción de tiempo, no mm) | Umbral por persona; piloto contra KSS y PVT |
| Fatiga visual y ojo seco (riesgo) | Tasa de parpadeo, índice de apertura mínima | Asociaciones pequeñas y contradictorias | Sí (es conteo) | Validar el conteo; 30 fps limita incompletos |
| Distancia pupila-ceja | PTB | La señal más grande en microgravedad (+2 a +4 mm) | Sí, mayor que el ruido, pero la ceja tiene 1,5 a 2 mm de error | Medir ceja en el spike |
| Párpado inferior (MRD2) | MRD2 | −0,9 mm parabólico, −0,56 mm acostado | Límite (MDC 1,1-1,4 mm) | Varias medidas por sesión; línea base |
| Párpado superior (MRD1) | MRD1 | Sin cambio en microgravedad; −0,6 mm acostado, −0,7 mm en hipergravedad | MDC 0,8-1,0 mm | Sirve para ptosis o retracción, no para hinchazón en órbita |
| Asimetría entre ojos | A, MRD1, MRD2 (derecho menos izquierdo) | Asimetría de 1 mm frecuente en sanos | Solo cambios vs la propia base | Norma de asimetría |
| Estrés y emoción | Parpadeo, 52 puntajes de expresión | Débil con solo cámara; modelo entrenado para AR de entretenimiento | n/a | Solo opt-in, visible solo para la persona (decisión del 14 nov) |

## 20. Comprobación visual de los puntos de la ceja (14 nov 2026)
`--brow-check` con la webcam de Niko (sujeto S01). **Confirmado visualmente por el usuario:** la línea verde (borde superior) y la roja (borde inferior) caen sobre las dos cejas, cada una en la suya. Esto confirma [V, una persona] los índices de ceja usados (supuestos de memoria hasta ahora): R superior 70, 63, 105, 66, 107 e inferior 46, 53, 52, 65, 55; L superior 300, 293, 334, 296, 336 e inferior 276, 283, 282, 295, 285.

Valores en reposo (diámetros de iris; mm [INF] con iris de 11,7 mm): PTB_inf 1,5-1,7 (~18-20 mm), PTB_sup 2,0-2,2 (~23-26 mm), grosor de ceja 0,44-0,50 (~5-6 mm). Puntaje de ceja activa en reposo 0,06-0,11 y hasta 0,97 al mover las cejas: el filtro de expresión reacciona (umbral provisorio 0,30). PTB_inf varió ~0,2 diámetros (~2,3 mm) en unos segundos, en parte por cabeceo (hasta −13,7°). No es una medición del ruido: eso lo da el suelo de ruido.

## 21. Suelo de ruido con ceja: sesiones 5, 6 y 7 (14 nov 2026, 19:32)
Webcam de Niko, 640x480, ruta 512 px q80, modo VIDEO, sujeto S01, cejas relajadas, mirando el punto rojo. Tres sesiones con reposicionamiento (bloques con quietud de 92 a 100 %). Informe `--noise-floor-report --exclude-sessions 1,2,3,4`; tabla completa en `docs/spike-resultados.md`. Los mm son [INF] (iris 11,7 mm).

| Medida | σ_w | σ_b | MDC95 con reposicionamiento (R / L) | en mm [INF] |
|---|---|---|---|---|
| Apertura A | 0,041 / 0,041 | 0,038 / 0,016 | 0,155 / 0,123 | 1,8 / 1,4 |
| MRD2n | 0,024 / 0,021 | 0,010 / 0,008 | 0,073 / 0,062 | **0,85 / 0,72** |
| MRD1n | 0,021 / 0,025 | 0,030 / 0,014 | 0,101 / 0,080 | 1,2 / 0,9 |
| **PTB_inf (principal)** | 0,099 / 0,087 | 0,024 / 0,053 | 0,282 / 0,281 | **3,3 / 3,3** |
| PTB_sup | 0,097 / 0,087 | 0,044 / 0,065 | 0,295 / 0,301 | 3,5 / 3,5 |
| PTB_inf, punto lateral (46/276) | 0,060 / 0,050 | 0,037 / 0,037 | 0,195 / 0,171 | 2,3 / 2,0 |
| PTB_inf, punto medial (55/285) | 0,069 / 0,059 | 0,052 / 0,061 | 0,239 / 0,235 | 2,8 / 2,8 |
| Grosor de la ceja | 0,009 / 0,012 | 0,021 / 0,020 | 0,063 / 0,064 | 0,7 / 0,8 |

**Criterios de aceptación de PTB_inf** (umbrales provisorios del arquitecto):
- MDC95 con reposicionamiento ≤ 2,3 mm: **NO CUMPLE** (3,3 mm). Con 3,3 mm no se detectaría el +2,3 mm del vuelo parabólico (Ax 2025) y el +3,7 mm de astronautas (Karlin 2021) quedaría apenas por encima del límite.
- σ_w del grosor de la ceja comparable a MRD1n: **CUMPLE** (cociente 0,47).
- Pendiente de PTB con el cabeceo < 0,1 mm/°: **NO CUMPLE**: −0,38 mm/° entre bloques y −0,16 mm/° entre sesiones.
- Cuadros excluidos por ceja activa < 30 %: **CUMPLE** (0,3 a 1,1 %).
- Control positivo: **SIN DATOS** (no se ha corrido `--brow-control`).

**Lectura** [V medido, una persona, tres sesiones]:
- **PTB_inf es ~4 veces más ruidosa que MRD2n**, con σ_w de 0,09 contra 0,02 diámetros de iris. El grosor de la ceja casi no varía (σ 0,01): las dos líneas de la ceja se mueven juntas. **La ceja entera se desplaza respecto al ojo.**
- **Parte de esa variación depende del cabeceo** (pendiente −0,38 mm/° entre bloques), lo que coincide con el efecto de paralaje esperado: la ceja está por delante del iris. [INF] Con 1 a 2° de variación de cabeceo, eso son ~0,4 a 0,8 mm.
- **El filtro de expresión casi no interviene** (0,8 % de cuadros): las cejas estaban relajadas, y con y sin filtro los resultados coinciden.
- **El punto lateral de la ceja es el menos ruidoso** (MDC ~2,0 a 2,3 mm), pero sigue al límite.
- **MRD2n mejoró respecto a las sesiones 2 a 4** (0,72 a 0,85 mm frente a 1,1 a 1,4 mm): la medida del párpado inferior es la más estable de todas. [INF] La diferencia puede deberse a la mejor quietud con el filtro corregido y a cómo estabas ese día, no a una mejora del método.
- **σ_b se estima con tres números** y las sesiones 5 y 6 diferían mucho entre sí (PTB_inf σ_w 0,15 y 0,055): el cambio mínimo con reposicionamiento es impreciso.
- **Posibles mejoras sin medir aún:** corregir PTB por el cabeceo (regresión con la pendiente medida) y usar el punto lateral. Ninguna está probada.

## 22. Control positivo de ceja (14 nov 2026, 19:35)
`--brow-control` con la webcam de Niko: 10 s neutral, 10 s cejas alzadas, 4 s de descanso, 10 s ceño fruncido. Referencia: MDC95 de PTB_inf con reposicionamiento de las sesiones 5 a 7 (3,3 mm [INF]). Una persona, una corrida.

| Fase | Cambio de PTB_inf (R / L) | En mm [INF] | Veces el MDC | ¿Detectado (> 3 veces el MDC en ambos ojos)? |
|---|---|---|---|---|
| Cejas alzadas | +0,283 / +0,165 diám. de iris | +3,3 / +1,9 mm | 1,0 / 0,6 | **No** |
| Ceño fruncido | −0,767 / −0,814 | −9,0 / −9,5 mm | 2,7 / 2,9 | **No** (por poco) |

- El signo es el esperado en ambas fases, y los puntajes de expresión marcaron ceja activa en el 94 % (alzadas) y el 100 % (fruncido) de los cuadros: el filtro de expresión funciona.
- **Resultado: CONTROL POSITIVO NO DETECTADO.** Con el ruido medido (3,3 mm), ni un gesto grande de cejas alzadas supera el umbral. [INF] La malla de MediaPipe probablemente sigue poco el movimiento de la ceja hacia arriba (tiende a la forma media de la cara): un gesto voluntario grande movió el PTB solo 2 a 3 mm.
- **Aviso:** al fruncir el cabeceo cambió 7,7°, así que parte de los −9 mm es paralaje y no la ceja. Con las cejas alzadas el cabeceo cambió −0,8°.
- **Consecuencia:** con esta webcam y este modelo, PTB_inf no es una señal usable para detectar cambios **sutiles** como los +2 a +4 mm de la microgravedad: quedan dentro del ruido. **Eso no significa que la ceja no se detecte:** los puntos caen sobre las cejas (confirmado a ojo), los gestos grandes (alzar, fruncer) se detectan con los puntajes de expresión (94 % y 100 % de los cuadros) y el ceño fruncido movió la medida ~9 mm. La ceja sigue siendo útil para cambios grandes, gestos y como filtro de calidad. Usos posibles a investigar [NV]: ceja caída, asimetría, conteo de gestos (solo con permiso de la persona).
- No se corrigió PTB por el cabeceo: las sesiones no guardaron los puntos por cuadro (privacidad), así que no se puede recalcular sin repetir con `--save-landmarks`.
