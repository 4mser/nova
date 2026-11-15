module Nova {

  @ Recibe los mensajes de la estación médica (NDJSON por UDP, ver estacion/CONTRATO.md),
  @ los valida y los pasa al monitor de salud.
  passive component Estacion {

    @ 1 Hz: lee todos los mensajes pendientes y revisa el latido de la estación
    sync input port schedIn: Svc.Sched

    @ Mediciones validadas
    output port signoOut: Nova.Signo

    time get port timeCaller

    import Fw.Event
    import Fw.Channel

    telemetry MensajesRecibidos: U32
    telemetry MensajesInvalidos: U32
    telemetry Conectada: bool

    event ESCUCHANDO(puerto: U16) \
      severity activity high \
      format "Esperando a la estación médica en UDP {}"

    event SIN_SOCKET(puerto: U16, error: I32) \
      severity warning high \
      format "No se pudo abrir UDP {} (errno {})"

    event CONECTADA \
      severity activity high \
      format "Estación médica conectada"

    event PERDIDA(segundos: U32) \
      severity warning high \
      format "Estación médica sin latido hace {} s"

    event MENSAJE_INVALIDO(motivo: string size 64) \
      severity warning low \
      format "Mensaje de la estación descartado: {}" \
      throttle 10

  }

}
