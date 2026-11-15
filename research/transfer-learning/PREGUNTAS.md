# Preguntas abiertas · transfer learning Tierra → espacio

Fecha: 14-11-2026. Uso el mismo formato que el catálogo de datos NASA de Benja (`datos/catalogo_nasa/CATALOGO.md` en su
carpeta local del proyecto, que no está en este repo): cada pregunta dice qué decisión es, qué destraba y qué se hace si
no hay respuesta. No repito las 12 preguntas de ese catálogo.

**Respuestas del 14-11-2026.** Benja respondió las 22 y se sumaron 4 (de la 23 a la 26), que salieron de la auditoría
del tercer run. Cada pregunta lleva su **Respuesta**; el *Si no respondes* queda como registro de la opción por
defecto. Lo que se decidió para la próxima corrida está resumido en el README, en «Siguiente corrida (v4)».

Las cifras de LifeSnaps las medí hoy sobre su tabla diaria (`daily`, 7.410 filas).

## A. Las 8 variables y los datos de Tierra

> **Actualización (14-11, tarde).** Benja pidió sacar los datos de `datos/enviado_whatsapp/`. La tanda 3 trae signos
> vitales diarios de 29 sujetos de reposo en cama de la NASA, el análogo terrestre de la microgravedad. Con eso
> cambian las preguntas 1, 2, 4, 5 y 6. La versión anterior, que simulaba el espacio con las 8 variables de un reloj,
> se descartó.

1. **Resuelta: las 8 variables son las del reposo en cama.** Son `pulso`, `pa_sis`, `pa_dia`, `fr`, `temp`, `peso`,
   `diuresis` y `agua`, medidas cada mañana por enfermería. Las seis primeras están en el contrato y en
   `nave/docs/umbrales.md`. La SpO₂, la VFC, el sueño y el ánimo quedan fuera porque el reposo no los trae. Ojo: el
   agua sigue una meta diaria del protocolo, así que es la más débil de las 8. ¿La cambiamos? *Si no respondes:* se
   queda.

   **Respuesta:** por ahora, solo pulso y presión arterial (`pulso`, `pa_sis` y `pa_dia`), con los datos reales del
   reposo. La v4 deja fuera las otras cinco; sus resultados del tercer run siguen en el README como referencia.

2. **¿Qué aporta LifeSnaps?** Pre-entrena la dinámica diaria del modelo de pronóstico: 71 personas y 7.410 días de
   reloj (CC BY 4.0). Solo comparte con el reposo el pulso, la respiración y la temperatura, y medidos con otro
   instrumento: el reloj, no la enfermería. Por eso el control del gráfico 1 se hace dentro del reposo (pre-reposo
   contra reposo, mismas personas) y no contra LifeSnaps. La presión, el peso y los fluidos solo aparecen en Tierra a
   través del pre-reposo de cada sujeto. *Si no respondes:* queda así.

   **Respuesta:** se mantiene, y la v4 mide cuánto aporta. Sus ocho canales siguen en el pre-entrenamiento compartido;
   de las tres variables de la v4, solo el pulso (`resting_hr`) está también en LifeSnaps. La presión en Tierra sale
   del pre-reposo de cada sujeto.

3. **¿Granularidad diaria u horaria?** El reposo es diario (una toma por mañana), así que queda diaria: 14 días de
   contexto y 7 de horizonte.

## B. Datos del espacio

4. **Resuelta: el espacio es el reposo en cama a −6°, con datos reales.** Son las campañas 1 y 3 y el CFT70 de la UTMB
   (NLSP/LSDA, datos públicos de la NASA): 10 a 21 días de pre-reposo, 42 a 91 en cama (días con pulso medido) y hasta
   14 de post-reposo. Nada se simula salvo las anomalías inyectadas para medir la detección, y esas se declaran.

   **Respuesta:** los escalones sintéticos se mantienen, declarados.

5. **¿Hay datos de vuelo de verdad en el resto de la carpeta?** La tanda 2 (frecuencia cardíaca y presión de NLSP)
   trae sobre todo resúmenes: gráficos, medias y PDFs de Apollo, Shuttle y Mir, no series individuales diarias. En la
   tanda 1, `04_OSDR_astronautas_datanasa.zip` trae los análisis de sangre y orina de Inspiration4 (4 tripulantes, en
   L-92, L-44, L-3, R+1, R+45, R+82 y R+194) y estudios de hueso en roedores: tampoco hay signos vitales diarios en
   vuelo. Para validar con vuelo real habría que pedirlos a LSDA (pregunta 3 del catálogo). *Si no respondes:* el
   análogo queda como la única fuente de «espacio».

   **Respuesta:** no se piden; el reposo en cama basta como análogo.

6. **¿Cuánto dura la «misión»?** La que tenga cada campaña: 60 o 90 días en cama (42 a 70 en el CFT70). En la
   presentación se cuenta como los primeros 2 a 3 meses de una misión, no como un vuelo de 6 meses.

   **Respuesta:** los primeros 2 a 3 meses de una misión.

## C. Modelo y transfer learning

7. **Resuelta: PatchTST propio como base y Chronos-2 como referencia.** El PatchTST de `transformers` se entrena en
   Tierra (LifeSnaps y el pre-reposo) y se adapta al reposo. Chronos-2 (`amazon/chronos-2`) corre sin adaptar, solo
   como referencia. Los baselines son persistencia y media de los últimos 7 días. Si el baseline le gana a la red, se
   reporta tal cual (ver el README).

8. **¿Hasta dónde llega la adaptación?** Sigo el orden de NOVA_CONTEXT §6.2. Están hechos el corrector residual (el
   que va a la demo), la última capa con el backbone congelado y el ajuste completo. Falta LoRA (`peft`). *Si no
   respondes:* LoRA queda fuera, porque el ajuste completo no le gana a la media de 7 días.

   **Respuesta:** LoRA va después de la v4, y solo si el ajuste completo sigue ganándole al modelo desde cero con las
   3 semillas. Corrección: el motivo del *Si no respondes* estaba mal. El ajuste completo sí le gana a la media de
   7 días (−0,014 [−0,019; −0,008]); lo que falta saber es si le gana al modelo entrenado desde cero.

9. **¿Qué variable protagoniza la demo?** NOVA_CONTEXT sugería pulso + VFC, pero la VFC no está en el reposo. El peso es
   la que más se mueve (−1,3 kg, unas dos veces su variación de un día a otro). *Si no respondes:* peso + pulso.

   **Respuesta:** presión + pulso. Primero fue peso + pulso, pero el peso quedó fuera de la v4. Ojo: en el tercer run,
   el pulso y la presión cambian con el reposo bastante menos que el peso (ver la tabla del README).

10. **¿La radiación entra al corrector como covariable o solo como análisis de correlación?** Ya estaba abierta en
    NOVA_CONTEXT §11 y depende de lo que entregue Daniella (pregunta 20). En el reposo en cama no hay radiación ni CO₂
    de nave, así que con estos datos no se puede probar. *Si no respondes:* queda diseñada como covariable (dosis
    diaria) para cuando haya datos de la nave, sin construir.

    **Respuesta:** diseñada como entrada del corrector, sin construir.

## D. Kaggle y Hugging Face

11. **Resuelta por defecto: ¿cómo llega el token de Hugging Face a Kaggle?** Tu token de HF es de grano fino y puede escribir en los
    repos de `Benjjaman` (lo comprobé hoy). La CLI de Kaggle (2.2.4) no tiene ningún comando para secretos, así que hay
    dos caminos:
    - **a.** Agregas tú, una sola vez, un secreto `HF_TOKEN` en Kaggle (Add-ons → Secrets), y el notebook sube los pesos
      por su cuenta.
    - **b.** El notebook deja los pesos en su salida y yo los subo a HF desde el PC con `kaggle kernels output`. En el PC
      solo se copian archivos, no corre ninguna red.

    *Si no respondes:* (b).

12. **¿Los repos de HF son privados o públicos?** Son `Benjjaman/nova-tierra` (modelo base) y
    `Benjjaman/nova-espacio` (adaptado). Ya no hay dataset sintético. *Si no respondes:* privados.

    **Respuesta:** privados por ahora y públicos al final del hackatón, después de corregir sus fichas con lo que
    encontró la auditoría.

## E. Cómo encaja en NOVA

13. **¿Dónde corre el modelo a bordo?** NOVA funciona sin internet y ya levanta sus modelos como servicios locales:
    lenguaje en el :8081, voz en el :8082, oído en el :8083, búsqueda en el :8084 y visión en el :8792, todos vigilados
    por `servicios.rs`. Hay dos opciones:
    - **a.** Un servicio Python más, el de pronóstico (por ejemplo en el :8793), que lee `/v1/historia` y devuelve
      predicciones.
    - **b.** Exportar el modelo a ONNX y correrlo dentro del enlace, en Rust.

    Cualquiera de las dos cambia `nave/`, que integra Nicolás Moreno. *Si no respondes:* (a), diseñado y documentado en
    esta rama. El cambio en `nave/` va en un PR aparte, después de conversarlo con él.

    **Respuesta:** (a), un servicio Python local en el :8793.

14. **¿La adaptación se hace a bordo o en la Tierra?** El corrector residual son unos pocos coeficientes y se puede
    reajustar cada día a bordo, sin esperar a la Tierra. El modelo base se mejora en la Tierra con los reportes nocturnos
    y vuelve a la nave como paquete firmado con ed25519 (`aprende.rs`), que hoy solo trae notas y respuestas corregidas.
    Es la «destilación Tierra → nave» que tu carpeta y el pitch dejan como pendiente.
    *Si no respondes:* el corrector se reajusta a bordo cada día y los pesos del base llegan por paquete firmado. Esto
    último queda diseñado, no construido hoy.

    **Respuesta:** el corrector se reajusta a bordo y el modelo base llega desde la Tierra, como en la opción por
    defecto.

15. **¿El modelo adaptado define el rango `ESPERADO_VUELO`?** `umbrales.md` deja pendiente marcar cuándo un cambio es lo
    esperable en microgravedad. La «nueva normalidad» del modelo adaptado (la predicción con su intervalo) puede ser ese
    rango: si una variable sale del intervalo N días seguidos, se marca atención. Los umbrales fijos de emergencia no se
    tocan, porque la regla del repo dice que lo crítico vive en reglas fijas.
    *Si no respondes:* sí, como propuesta para revisar con Nicolás Moreno.

    **Respuesta:** no por ahora. El rango adaptado no se propone como `ESPERADO_VUELO`.

16. **¿El pronóstico reemplaza el cono de Vitals?** *Si no respondes:* no toco `vitals.js`. El pronóstico diario va
    aparte, como una tendencia a 7 días.

    **Respuesta:** no; va aparte.

17. **¿Qué le pasamos a Ask NOVA?** La capa de explicación de NOVA_CONTEXT §6.4 recibe un JSON con predicciones,
    anomalías y covariables. Ask NOVA ya existe (`nova.rs`, `cerebro.rs`). *Si no respondes:* dejo el formato del JSON en
    esta rama y Ask NOVA lo lee más adelante, sin tocar su código hoy.

    **Respuesta:** la conexión con Ask NOVA la hace Nicolás Moreno.

18. **¿Agregamos `diuresis` y `agua` al contrato?** El contrato no las tiene y dice que un sensor nuevo «se agrega a esta
    tabla antes de usarlo». Propuesta: `diuresis` (`g/dia`) y `agua` (`g/dia`), registradas por la tripulación en la
    app. *Si no respondes:* las uso con esos nombres en esta rama y las propongo a Nicolás Moreno en el PR, sin tocar el
    contrato.

    **Respuesta:** por ahora no hace falta. La v4 usa solo `pulso`, `pa_sis` y `pa_dia`, que ya están en el contrato.

## F. Equipo

19. **Luis: ¿cuáles de las 8 variables mide la estación física?** Decide qué llega por la estación (contrato NDJSON) y
    qué por el teléfono y el reloj. *Si no respondes:* lo que la estación ya mide (pulso y temperatura) llega por ella;
    presión, respiración, peso, diuresis y agua se registran en el teléfono.

    **Respuesta:** lo define Nicolás Moreno.

20. **Daniella: ¿qué serie de radiación usamos y en qué unidad?** Para la covariable hace falta la dosis diaria (mGy/día
    o mSv/día) y una marca de evento solar. *Si no respondes:* uso la dosis estimada que ya calcula la nave
    (`dosisMision()` en `vitals.js`) más los eventos de DONKI 2024 (pregunta 4 del catálogo).

    **Respuesta:** hay que preguntarle a Luis, que es quien ve la radiación. Queda pendiente; no frena la v4, porque la
    covariable está diseñada y no construida (pregunta 10).

21. **Ambar: ¿el ánimo puede entrar al modelo?** En NOVA el ánimo solo sale del teléfono si la persona comparte su día,
    así que el modelo tiene que funcionar sin él. LifeSnaps sí lo trae, con consentimiento de sus participantes; el
    reposo en cama no. *Si no respondes:* queda fuera de las 8 y se propone como variable opcional más adelante.

    **Respuesta:** fuera, como variable opcional más adelante.

## G. Entrega

22. **¿Subo la rama y abro el PR a `4mser/nova`?** El repo es de 4mser y lo integra Nicolás Moreno, así que yo no
    mergeo. *Si no respondes:* no subo nada hasta que me lo digas.

    **Respuesta:** la rama se subió el 14-11-2026 y el PR a `main` se abre con el README ya corregido. Lo integra
    Nicolás Moreno; yo no mergeo. La v4 va en un PR aparte.

## H. Lo que dejó la auditoría del tercer run

23. **¿Se repite el pronóstico con varias semillas?** Con una sola semilla, el ajuste completo le gana al modelo desde
    cero por −0,0038 [−0,0064; −0,0011], pero los modelos se entrenaron en condiciones distintas. Los de desde cero
    usaron lr 1e-3 y tope de 60 épocas. El ajuste completo usó lr 2e-4 y tope de 30, y «solo la cabeza», lr 1e-3 y tope
    de 30. A «solo la cabeza» la cortó el tope en 3 de 5 folds.

    **Respuesta:** sí, en la v4, con 3 semillas y todos los modelos en igualdad de condiciones: mismo lr y presupuesto,
    y un tope de 60 épocas o más para «solo la cabeza».

24. **¿«Solo la cabeza» congela de verdad el backbone?** `congelar_backbone` apaga los gradientes, pero el modelo
    entrena en modo `train()`: BatchNorm se recalcula con el reposo y el dropout sigue activo. Entre `nova-tierra` y
    `nova-espacio` cambian 20 de 71 tensores, 18 de ellos de BatchNorm.

    **Respuesta:** congelar de verdad (backbone en `eval()`) y compararlo con la versión actual.

25. **¿El pronóstico se adapta a cada persona?** Hoy se adapta al reposo de los sujetos de entrenamiento; el sujeto
    evaluado no aporta sus propios días.

    **Respuesta:** sí, con sus primeros k = 7, 14 y 28 días en cama.

26. **¿El ancho del rango es uno para toda la población o uno por persona?** Hoy el 5 % de falsas alarmas se cumple en
    promedio: en el peso, 18 de 29 personas no tienen ninguna y una llega a 40,7 %.

    **Respuesta:** probar un ancho por persona y compararlo con el poblacional.
