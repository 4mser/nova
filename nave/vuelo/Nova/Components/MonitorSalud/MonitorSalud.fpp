module Nova {

  @ Recibe los signos de cada tripulante, los compara con los umbrales y avisa.
  @ Los umbrales son parámetros: la actualización nocturna desde la Tierra los puede cambiar.
  active component MonitorSalud {

    # ------------------------------------------------------------------
    # Puertos
    # ------------------------------------------------------------------

    @ Mediciones que llegan de la estación, el simulador o los teléfonos
    async input port signoIn: Nova.Signo

    @ 1 Hz: publica la telemetría y revisa datos viejos
    sync input port schedIn: Svc.Sched

    @ Estado completo para la pantalla (1 Hz)
    output port estadoOut: Nova.Estado

    @ Cada cambio de nivel, en el momento
    output port alertaOut: Nova.Alerta

    time get port timeCaller
    param get port prmGetOut
    param set port prmSetOut

    import Fw.Event
    import Fw.Command
    import Fw.Channel

    # ------------------------------------------------------------------
    # Comandos
    # ------------------------------------------------------------------

    @ Ingresar a mano una medición (teclado de la tripulación o prueba desde Tierra)
    async command INGRESAR_SIGNO(
      trip: U8 @< 0..3
      sensor: Nova.Sensor
      valor: F32
    )

    # ------------------------------------------------------------------
    # Telemetría (un valor por tripulante)
    # ------------------------------------------------------------------

    telemetry Pulso: Nova.ValoresTripulacion
    telemetry SpO2: Nova.ValoresTripulacion
    telemetry PaSis: Nova.ValoresTripulacion
    telemetry PaDia: Nova.ValoresTripulacion
    telemetry Temp: Nova.ValoresTripulacion
    telemetry Fr: Nova.ValoresTripulacion
    telemetry Glucosa: Nova.ValoresTripulacion
    telemetry Vfc: Nova.ValoresTripulacion
    telemetry Sueno: Nova.ValoresTripulacion
    telemetry Animo: Nova.ValoresTripulacion
    telemetry Energia: Nova.ValoresTripulacion
    telemetry Nivel: Nova.NivelesTripulacion
    telemetry Co2Cabina: F32
    telemetry SignosRecibidos: U32

    # ------------------------------------------------------------------
    # Eventos: solo al cambiar de nivel, para no inundar el enlace
    # ------------------------------------------------------------------

    event ALERTA_ATENCION(trip: U8, sensor: Nova.Sensor, valor: F32) \
      severity warning low \
      format "T{}: {} = {.1f} pide atención de la tripulación"

    event ALERTA_TIERRA(trip: U8, sensor: Nova.Sensor, valor: F32) \
      severity warning high \
      format "T{}: {} = {.1f} — avisar al cirujano de vuelo"

    event VUELVE_NORMAL(trip: U8, sensor: Nova.Sensor, valor: F32) \
      severity activity high \
      format "T{}: {} = {.1f} vuelve a lo normal"

    event SIGNO_DESCARTADO(trip: U8, sensor: Nova.Sensor, valor: F32) \
      severity warning low \
      format "T{} (0 = cabina): {} = {.1f} fuera de rango físico, se descarta como error del sensor" \
      throttle 10

    event SIN_DATOS(trip: U8, sensor: Nova.Sensor, segundos: U32) \
      severity warning low \
      format "T{}: {} sin datos hace {} s"

    # ------------------------------------------------------------------
    # Umbrales (valores de partida; fuentes en docs/umbrales.md)
    # ------------------------------------------------------------------

    param PULSO_ALTO_ATENCION: F32 default 110.0
    param PULSO_ALTO_TIERRA: F32 default 140.0
    param PULSO_BAJO_ATENCION: F32 default 45.0
    param PULSO_BAJO_TIERRA: F32 default 35.0
    param SPO2_ATENCION: F32 default 94.0
    param SPO2_TIERRA: F32 default 90.0
    param PA_SIS_ALTA_ATENCION: F32 default 140.0
    param PA_SIS_ALTA_TIERRA: F32 default 180.0
    param PA_SIS_BAJA_ATENCION: F32 default 90.0
    param PA_SIS_BAJA_TIERRA: F32 default 80.0
    param PA_DIA_ALTA_ATENCION: F32 default 90.0
    param PA_DIA_ALTA_TIERRA: F32 default 120.0
    param TEMP_ALTA_ATENCION: F32 default 38.0
    param TEMP_ALTA_TIERRA: F32 default 39.5
    param TEMP_BAJA_ATENCION: F32 default 35.5
    param TEMP_BAJA_TIERRA: F32 default 35.0
    param FR_ALTA_ATENCION: F32 default 24.0
    param FR_ALTA_TIERRA: F32 default 30.0
    param FR_BAJA_ATENCION: F32 default 10.0
    param FR_BAJA_TIERRA: F32 default 8.0
    param GLUCOSA_BAJA_ATENCION: F32 default 70.0
    param GLUCOSA_BAJA_TIERRA: F32 default 54.0
    param GLUCOSA_ALTA_ATENCION: F32 default 180.0
    param GLUCOSA_ALTA_TIERRA: F32 default 250.0
    param CO2_ATENCION: F32 default 2600.0
    param CO2_TIERRA: F32 default 5000.0
    @ Check-in y sueño desde la app NOVA (mismas reglas prudentes que la app: dormir menos de 6 h, ánimo o energía ≤ 2)
    param SUENO_ATENCION: F32 default 5.9
    param SUENO_TIERRA: F32 default 3.5
    param ANIMO_ATENCION: F32 default 2.0
    param ENERGIA_ATENCION: F32 default 2.0
    @ Segundos sin datos de un sensor que ya había reportado antes de avisar
    param SEGUNDOS_SIN_DATOS: U32 default 120

  }

}
