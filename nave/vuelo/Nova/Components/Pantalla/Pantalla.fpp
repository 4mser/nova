module Nova {

  @ Puente con la pantalla de la tripulación (otro proceso en la misma nave):
  @ manda el estado y las alertas como NDJSON por UDP y recibe lo que la tripulación ingresa a mano.
  passive component Pantalla {

    @ 1 Hz: lee lo que ingresó la tripulación
    guarded input port schedIn: Svc.Sched

    @ Estado completo desde el monitor de salud
    guarded input port estadoIn: Nova.Estado

    @ Cambios de nivel desde el monitor de salud
    guarded input port alertaIn: Nova.Alerta

    @ Mediciones ingresadas por teclado en la pantalla
    output port signoOut: Nova.Signo

    time get port timeCaller

    import Fw.Event
    import Fw.Channel

    telemetry MensajesEnviados: U32
    telemetry IngresosTripulacion: U32

    event LISTA(envio: U16, recepcion: U16) \
      severity activity high \
      format "Pantalla de la tripulación: envío a UDP {}, recepción en UDP {}"

    event SIN_SOCKET(puerto: U16, error: I32) \
      severity warning high \
      format "No se pudo abrir UDP {} para la pantalla (errno {})"

    event INGRESO(trip: U8, sensor: Nova.Sensor, valor: F32) \
      severity activity high \
      format "T{} ingresó a mano {} = {.1f}"

    event INGRESO_INVALIDO(motivo: string size 64) \
      severity warning low \
      format "Ingreso de la pantalla descartado: {}" \
      throttle 10

  }

}
