# Tipos y puertos compartidos por los componentes de salud de NOVA

module Nova {

  @ Número de tripulantes que sigue esta versión del núcleo
  constant TRIPULANTES = 4

  @ Lo que puede medir la estación médica o el simulador (ver estacion/CONTRATO.md)
  enum Sensor {
    PULSO        @< latidos por minuto
    SPO2         @< saturación de oxígeno, %
    PA_SIS       @< presión sistólica, mmHg
    PA_DIA       @< presión diastólica, mmHg
    TEMP         @< temperatura corporal, °C
    FR           @< respiraciones por minuto
    GLUCOSA      @< mg/dL
    VFC          @< variabilidad de la frecuencia cardiaca (RMSSD), ms
    CO2_CABINA   @< ppm
    O2_CABINA    @< %
    TEMP_CABINA  @< °C
    SUENO_H      @< horas de sueño de la última noche (app NOVA)
    ANIMO        @< ánimo del check-in, 1..5 (app NOVA, si la persona lo comparte)
    ENERGIA      @< energía del check-in, 1..5 (app NOVA, si la persona lo comparte)
    PASOS        @< pasos de hoy (teléfono)
    FC_REPOSO    @< pulso en reposo, lpm (reloj / Health Connect)
    LUZ          @< luz ambiente, lux (teléfono)
    RUIDO        @< ruido aproximado, dB (teléfono)
  }

  @ Estado de un indicador. ESPERADO_VUELO = cambio explicado por el vuelo, no alarma
  enum Nivel {
    SIN_DATO
    NORMAL
    ESPERADO_VUELO
    ATENCION      @< lo resuelve la tripulación
    AVISO_TIERRA  @< hay que avisar al cirujano de vuelo
  }

  @ Un valor por tripulante (T1..T4)
  array ValoresTripulacion = [TRIPULANTES] F32 format "{.1f}"

  @ El peor nivel de cada tripulante
  array NivelesTripulacion = [TRIPULANTES] Nova.Nivel

  @ Nivel de cada sensor de un tripulante (en el orden de Nova.Sensor)
  array NivelesSensores = [18] Nova.Nivel

  @ Nivel de cada sensor de cada tripulante
  array MatrizNiveles = [TRIPULANTES] Nova.NivelesSensores

  @ Segundos desde la última medición de cada sensor de cada tripulante (0 = nunca)
  array EdadSensores = [18] U32
  array MatrizEdades = [TRIPULANTES] Nova.EdadSensores

  @ Umbrales vigentes de un sensor (valor ≤ 0 = no aplica). Vienen de los parámetros del monitor de salud:
  @ la actualización nocturna desde la Tierra los cambia y la pantalla los dibuja tal cual.
  struct Umbral {
    altoAtencion: F32
    altoTierra: F32
    bajoAtencion: F32
    bajoTierra: F32
  }
  array UmbralesSensores = [18] Nova.Umbral

  @ Foto completa del estado de la tripulación, una vez por segundo
  struct EstadoTripulacion {
    pulso: Nova.ValoresTripulacion
    spo2: Nova.ValoresTripulacion
    paSis: Nova.ValoresTripulacion
    paDia: Nova.ValoresTripulacion
    temp: Nova.ValoresTripulacion
    fr: Nova.ValoresTripulacion
    glucosa: Nova.ValoresTripulacion
    vfc: Nova.ValoresTripulacion
    sueno: Nova.ValoresTripulacion
    animo: Nova.ValoresTripulacion
    energia: Nova.ValoresTripulacion
    pasos: Nova.ValoresTripulacion
    fcReposo: Nova.ValoresTripulacion
    nivel: Nova.NivelesTripulacion
    niveles: Nova.MatrizNiveles
    edades: Nova.MatrizEdades
    co2Cabina: F32
    o2Cabina: F32
    tempCabina: F32
    nivelCo2: Nova.Nivel
    umbrales: Nova.UmbralesSensores
  }

  @ Estado completo para la pantalla de la tripulación
  port Estado(estado: Nova.EstadoTripulacion)

  @ Un cambio de nivel de un indicador (trip: 1..4, 0 = cabina)
  port Alerta(trip: U8, sensor: Nova.Sensor, valor: F32, nivel: Nova.Nivel)

  @ Una medición ya validada que llega al monitor de salud
  port Signo(
    trip: U8      @< 0..TRIPULANTES-1
    sensor: Nova.Sensor
    valor: F32
    calidad: F32  @< 0..1
  )

}
