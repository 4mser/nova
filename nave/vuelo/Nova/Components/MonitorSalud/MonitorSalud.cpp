// ======================================================================
// MonitorSalud
// ======================================================================

#include "Nova/Components/MonitorSalud/MonitorSalud.hpp"

namespace Nova {

MonitorSalud::MonitorSalud(const char* const compName) : MonitorSaludComponentBase(compName), m_recibidos(0) {
    for (FwSizeType t = 0; t < N_TRIP; t++) {
        for (FwSizeType s = 0; s < N_SENSOR; s++) {
            m_valor[t][s] = 0.0f;
            m_nivel[t][s] = Nova::Nivel::SIN_DATO;
            m_ultimo[t][s] = 0;
            m_avisadoSinDatos[t][s] = false;
            m_bajaDesde[t][s] = 0;
        }
    }
}

MonitorSalud::~MonitorSalud() {}

// ----------------------------------------------------------------------
// Reglas
// ----------------------------------------------------------------------

bool MonitorSalud::esCabina(Nova::Sensor::T sensor) {
    return sensor == Nova::Sensor::CO2_CABINA || sensor == Nova::Sensor::O2_CABINA ||
           sensor == Nova::Sensor::TEMP_CABINA;
}

bool MonitorSalud::plausible(Nova::Sensor::T sensor, F32 v) {
    switch (sensor) {
        case Nova::Sensor::PULSO:       return v >= 20.0f && v <= 250.0f;
        case Nova::Sensor::SPO2:        return v >= 50.0f && v <= 100.0f;
        case Nova::Sensor::PA_SIS:      return v >= 50.0f && v <= 250.0f;
        case Nova::Sensor::PA_DIA:      return v >= 30.0f && v <= 150.0f;
        case Nova::Sensor::TEMP:        return v >= 30.0f && v <= 43.0f;
        case Nova::Sensor::FR:          return v >= 4.0f && v <= 60.0f;
        case Nova::Sensor::GLUCOSA:     return v >= 20.0f && v <= 600.0f;
        case Nova::Sensor::VFC:         return v >= 5.0f && v <= 250.0f;
        case Nova::Sensor::CO2_CABINA:  return v >= 0.0f && v <= 10000.0f;
        case Nova::Sensor::O2_CABINA:   return v >= 0.0f && v <= 30.0f;
        case Nova::Sensor::TEMP_CABINA: return v >= 0.0f && v <= 50.0f;
        case Nova::Sensor::SUENO_H:     return v >= 0.0f && v <= 16.0f;
        case Nova::Sensor::ANIMO:       return v >= 1.0f && v <= 5.0f;
        case Nova::Sensor::ENERGIA:     return v >= 1.0f && v <= 5.0f;
        case Nova::Sensor::PASOS:       return v >= 0.0f && v <= 100000.0f;
        case Nova::Sensor::FC_REPOSO:   return v >= 25.0f && v <= 130.0f;
        case Nova::Sensor::LUZ:         return v >= 0.0f && v <= 150000.0f;
        case Nova::Sensor::RUIDO:       return v >= 0.0f && v <= 140.0f;
        default:                        return false;
    }
}

Nova::Umbral MonitorSalud::umbralDe(Nova::Sensor::T sensor) {
    Fw::ParamValid ok;
    // altoT/altoA: umbrales por arriba; bajoT/bajoA: por abajo (0 o negativo = no aplica)
    F32 altoT = -1.0f, altoA = -1.0f, bajoT = -1.0f, bajoA = -1.0f;
    switch (sensor) {
        case Nova::Sensor::PULSO:
            altoT = paramGet_PULSO_ALTO_TIERRA(ok);
            altoA = paramGet_PULSO_ALTO_ATENCION(ok);
            bajoT = paramGet_PULSO_BAJO_TIERRA(ok);
            bajoA = paramGet_PULSO_BAJO_ATENCION(ok);
            break;
        case Nova::Sensor::SPO2:
            bajoT = paramGet_SPO2_TIERRA(ok);
            bajoA = paramGet_SPO2_ATENCION(ok);
            break;
        case Nova::Sensor::PA_SIS:
            altoT = paramGet_PA_SIS_ALTA_TIERRA(ok);
            altoA = paramGet_PA_SIS_ALTA_ATENCION(ok);
            bajoT = paramGet_PA_SIS_BAJA_TIERRA(ok);
            bajoA = paramGet_PA_SIS_BAJA_ATENCION(ok);
            break;
        case Nova::Sensor::PA_DIA:
            altoT = paramGet_PA_DIA_ALTA_TIERRA(ok);
            altoA = paramGet_PA_DIA_ALTA_ATENCION(ok);
            break;
        case Nova::Sensor::TEMP:
            altoT = paramGet_TEMP_ALTA_TIERRA(ok);
            altoA = paramGet_TEMP_ALTA_ATENCION(ok);
            bajoT = paramGet_TEMP_BAJA_TIERRA(ok);
            bajoA = paramGet_TEMP_BAJA_ATENCION(ok);
            break;
        case Nova::Sensor::FR:
            altoT = paramGet_FR_ALTA_TIERRA(ok);
            altoA = paramGet_FR_ALTA_ATENCION(ok);
            bajoT = paramGet_FR_BAJA_TIERRA(ok);
            bajoA = paramGet_FR_BAJA_ATENCION(ok);
            break;
        case Nova::Sensor::GLUCOSA:
            altoT = paramGet_GLUCOSA_ALTA_TIERRA(ok);
            altoA = paramGet_GLUCOSA_ALTA_ATENCION(ok);
            bajoT = paramGet_GLUCOSA_BAJA_TIERRA(ok);
            bajoA = paramGet_GLUCOSA_BAJA_ATENCION(ok);
            break;
        case Nova::Sensor::CO2_CABINA:
            altoT = paramGet_CO2_TIERRA(ok);
            altoA = paramGet_CO2_ATENCION(ok);
            break;
        case Nova::Sensor::SUENO_H:
            bajoT = paramGet_SUENO_TIERRA(ok);
            bajoA = paramGet_SUENO_ATENCION(ok);
            break;
        case Nova::Sensor::ANIMO:
            // El ánimo nunca se escala solo a la Tierra: lo ve la tripulación si la persona lo comparte
            bajoA = paramGet_ANIMO_ATENCION(ok);
            break;
        case Nova::Sensor::ENERGIA:
            bajoA = paramGet_ENERGIA_ATENCION(ok);
            break;
        default:
            // VFC, pulso en reposo, pasos, luz, ruido, O2 y temperatura de cabina: sin umbral fijo todavía
            // (se miran contra la línea base de cada persona)
            break;
    }
    return Nova::Umbral(altoA, altoT, bajoA, bajoT);
}

Nova::Nivel::T MonitorSalud::clasificar(Nova::Sensor::T sensor, F32 v) {
    const Nova::Umbral u = umbralDe(sensor);
    const F32 altoA = u.get_altoAtencion(), altoT = u.get_altoTierra();
    const F32 bajoA = u.get_bajoAtencion(), bajoT = u.get_bajoTierra();
    if ((altoT > 0.0f && v >= altoT) || (bajoT > 0.0f && v <= bajoT)) {
        return Nova::Nivel::AVISO_TIERRA;
    }
    if ((altoA > 0.0f && v >= altoA) || (bajoA > 0.0f && v <= bajoA)) {
        return Nova::Nivel::ATENCION;
    }
    return Nova::Nivel::NORMAL;
}

bool MonitorSalud::procesar(U8 trip, const Nova::Sensor& sensor, F32 valor, F32 calidad) {
    const Nova::Sensor::T s = sensor.e;
    if (!sensor.isValid()) {
        return false;
    }
    // Los sensores de la cabina se guardan en la fila 0
    const U8 fila = esCabina(s) ? 0 : trip;
    if (fila >= N_TRIP) {
        return false;
    }
    // Número visible para la tripulación: T1..T4 (0 = cabina)
    const U8 num = esCabina(s) ? 0 : static_cast<U8>(trip + 1);
    if (!plausible(s, valor)) {
        log_WARNING_LO_SIGNO_DESCARTADO(num, sensor, valor);
        return false;
    }
    if (calidad < 0.5f) {
        // lectura con mal contacto o mucho movimiento: no se usa para alertar
        return false;
    }

    const U32 ahora = getTime().getSeconds();
    m_recibidos++;
    m_valor[fila][s] = valor;
    m_ultimo[fila][s] = ahora;
    m_avisadoSinDatos[fila][s] = false;

    const Nova::Nivel::T medido = clasificar(s, valor);
    const Nova::Nivel::T antes = m_nivel[fila][s];
    Nova::Nivel::T nuevo = medido;

    // Histéresis: subir de nivel es inmediato; bajar exige que el nivel menor se mantenga
    const bool hayAlerta = (antes == Nova::Nivel::ATENCION || antes == Nova::Nivel::AVISO_TIERRA);
    if (hayAlerta && medido < antes) {
        if (m_bajaDesde[fila][s] == 0) {
            m_bajaDesde[fila][s] = ahora;
        }
        if (ahora - m_bajaDesde[fila][s] < SEGUNDOS_PARA_BAJAR) {
            nuevo = antes;  // todavía no
        } else {
            m_bajaDesde[fila][s] = 0;
        }
    } else {
        m_bajaDesde[fila][s] = 0;
    }
    m_nivel[fila][s] = nuevo;

    // Solo cuentan las alertas y la vuelta a lo normal desde una alerta (no la primera lectura)
    const bool relevante = (nuevo == Nova::Nivel::ATENCION || nuevo == Nova::Nivel::AVISO_TIERRA ||
                            (nuevo == Nova::Nivel::NORMAL && hayAlerta));
    if (nuevo != antes && relevante) {
        if (nuevo == Nova::Nivel::AVISO_TIERRA) {
            log_WARNING_HI_ALERTA_TIERRA(num, sensor, valor);
        } else if (nuevo == Nova::Nivel::ATENCION) {
            log_WARNING_LO_ALERTA_ATENCION(num, sensor, valor);
        } else if (nuevo == Nova::Nivel::NORMAL &&
                   (antes == Nova::Nivel::ATENCION || antes == Nova::Nivel::AVISO_TIERRA)) {
            log_ACTIVITY_HI_VUELVE_NORMAL(num, sensor, valor);
        }
        if (isConnected_alertaOut_OutputPort(0)) {
            alertaOut_out(0, num, sensor, valor, nuevo);
        }
    }
    return true;
}

// ----------------------------------------------------------------------
// Puertos y comandos
// ----------------------------------------------------------------------

void MonitorSalud::signoIn_handler(FwIndexType portNum,
                                   U8 trip,
                                   const Nova::Sensor& sensor,
                                   F32 valor,
                                   F32 calidad) {
    (void)portNum;
    (void)procesar(trip, sensor, valor, calidad);
}

void MonitorSalud::INGRESAR_SIGNO_cmdHandler(FwOpcodeType opCode,
                                             U32 cmdSeq,
                                             U8 trip,
                                             const Nova::Sensor& sensor,
                                             F32 valor) {
    const bool cabina = esCabina(sensor.e);
    if ((!cabina && trip >= N_TRIP) || !sensor.isValid() || !plausible(sensor.e, valor)) {
        cmdResponse_out(opCode, cmdSeq, Fw::CmdResponse::VALIDATION_ERROR);
        return;
    }
    (void)procesar(trip, sensor, valor, 1.0f);
    cmdResponse_out(opCode, cmdSeq, Fw::CmdResponse::OK);
}

void MonitorSalud::schedIn_handler(FwIndexType portNum, U32 context) {
    (void)portNum;
    (void)context;

    // Datos viejos: un sensor que ya había reportado y dejó de hacerlo
    Fw::ParamValid ok;
    const U32 limite = paramGet_SEGUNDOS_SIN_DATOS(ok);
    const U32 ahora = getTime().getSeconds();
    for (FwSizeType t = 0; t < N_TRIP; t++) {
        for (FwSizeType s = 0; s < N_SENSOR; s++) {
            const bool cabina = esCabina(static_cast<Nova::Sensor::T>(s));
            // El sueño, el check-in y los datos diarios del teléfono llegan pocas veces al día: no se vigilan así
            const bool diario = s == Nova::Sensor::SUENO_H || s == Nova::Sensor::ANIMO || s == Nova::Sensor::ENERGIA ||
                                s == Nova::Sensor::PASOS || s == Nova::Sensor::FC_REPOSO;
            if ((cabina && t != 0) || diario || m_ultimo[t][s] == 0 || m_avisadoSinDatos[t][s]) {
                continue;
            }
            const U32 hace = ahora - m_ultimo[t][s];
            if (limite > 0 && hace >= limite) {
                m_avisadoSinDatos[t][s] = true;
                m_nivel[t][s] = Nova::Nivel::SIN_DATO;
                log_WARNING_LO_SIN_DATOS(cabina ? 0 : static_cast<U8>(t + 1), static_cast<Nova::Sensor::T>(s), hace);
            }
        }
    }

    // Telemetría: un valor por tripulante
    auto fila = [this](Nova::Sensor::T s) {
        Nova::ValoresTripulacion v;
        for (FwSizeType t = 0; t < N_TRIP; t++) {
            v[t] = m_valor[t][s];
        }
        return v;
    };
    tlmWrite_Pulso(fila(Nova::Sensor::PULSO));
    tlmWrite_SpO2(fila(Nova::Sensor::SPO2));
    tlmWrite_PaSis(fila(Nova::Sensor::PA_SIS));
    tlmWrite_PaDia(fila(Nova::Sensor::PA_DIA));
    tlmWrite_Temp(fila(Nova::Sensor::TEMP));
    tlmWrite_Fr(fila(Nova::Sensor::FR));
    tlmWrite_Glucosa(fila(Nova::Sensor::GLUCOSA));
    tlmWrite_Vfc(fila(Nova::Sensor::VFC));
    tlmWrite_Sueno(fila(Nova::Sensor::SUENO_H));
    tlmWrite_Animo(fila(Nova::Sensor::ANIMO));
    tlmWrite_Energia(fila(Nova::Sensor::ENERGIA));
    tlmWrite_Co2Cabina(m_valor[0][Nova::Sensor::CO2_CABINA]);
    tlmWrite_SignosRecibidos(m_recibidos);

    // El peor nivel de cada tripulante (sin contar la cabina)
    Nova::NivelesTripulacion niveles;
    for (FwSizeType t = 0; t < N_TRIP; t++) {
        Nova::Nivel::T peor = Nova::Nivel::SIN_DATO;
        for (FwSizeType s = 0; s < N_SENSOR; s++) {
            if (esCabina(static_cast<Nova::Sensor::T>(s))) {
                continue;
            }
            if (m_nivel[t][s] > peor) {
                peor = m_nivel[t][s];
            }
        }
        niveles[t] = peor;
    }
    tlmWrite_Nivel(niveles);

    // Foto completa para la pantalla de la tripulación
    if (isConnected_estadoOut_OutputPort(0)) {
        Nova::MatrizNiveles matriz;
        Nova::MatrizEdades edades;
        for (FwSizeType t = 0; t < N_TRIP; t++) {
            Nova::NivelesSensores fn;
            Nova::EdadSensores fe;
            for (FwSizeType s = 0; s < N_SENSOR; s++) {
                fn[s] = m_nivel[t][s];
                fe[s] = (m_ultimo[t][s] == 0) ? 0 : (ahora - m_ultimo[t][s] + 1);
            }
            matriz[t] = fn;
            edades[t] = fe;
        }
        Nova::EstadoTripulacion e;
        e.set_pulso(fila(Nova::Sensor::PULSO));
        e.set_spo2(fila(Nova::Sensor::SPO2));
        e.set_paSis(fila(Nova::Sensor::PA_SIS));
        e.set_paDia(fila(Nova::Sensor::PA_DIA));
        e.set_temp(fila(Nova::Sensor::TEMP));
        e.set_fr(fila(Nova::Sensor::FR));
        e.set_glucosa(fila(Nova::Sensor::GLUCOSA));
        e.set_vfc(fila(Nova::Sensor::VFC));
        e.set_sueno(fila(Nova::Sensor::SUENO_H));
        e.set_animo(fila(Nova::Sensor::ANIMO));
        e.set_energia(fila(Nova::Sensor::ENERGIA));
        e.set_pasos(fila(Nova::Sensor::PASOS));
        e.set_fcReposo(fila(Nova::Sensor::FC_REPOSO));
        e.set_nivel(niveles);
        e.set_niveles(matriz);
        e.set_edades(edades);
        e.set_co2Cabina(m_valor[0][Nova::Sensor::CO2_CABINA]);
        e.set_o2Cabina(m_valor[0][Nova::Sensor::O2_CABINA]);
        e.set_tempCabina(m_valor[0][Nova::Sensor::TEMP_CABINA]);
        e.set_nivelCo2(m_nivel[0][Nova::Sensor::CO2_CABINA]);
        Nova::UmbralesSensores us;
        for (FwSizeType k = 0; k < N_SENSOR; k++) {
            us[k] = umbralDe(static_cast<Nova::Sensor::T>(k));
        }
        e.set_umbrales(us);
        estadoOut_out(0, e);
    }
}

}  // namespace Nova
