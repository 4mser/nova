// ======================================================================
// JsonPlano: lectura mínima de los mensajes NDJSON planos de NOVA
// (estación médica y pantalla de la tripulación) y nombres de sensores.
// Sin memoria dinámica ni dependencias externas.
// ======================================================================

#ifndef Nova_JsonPlano_HPP
#define Nova_JsonPlano_HPP

#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "Nova/Components/Salud/NivelEnumAc.hpp"
#include "Nova/Components/Salud/SensorEnumAc.hpp"

namespace Nova {
namespace Json {

//! Busca "clave": y devuelve el puntero al valor (sin espacios), o nullptr
inline const char* valorDe(const char* msg, const char* clave) {
    char patron[40];
    const int n = snprintf(patron, sizeof(patron), "\"%s\"", clave);
    if (n <= 0 || static_cast<size_t>(n) >= sizeof(patron)) {
        return nullptr;
    }
    const char* p = strstr(msg, patron);
    if (p == nullptr) {
        return nullptr;
    }
    p += n;
    while (*p == ' ' || *p == '\t') p++;
    if (*p != ':') return nullptr;
    p++;
    while (*p == ' ' || *p == '\t') p++;
    return p;
}

inline bool texto(const char* msg, const char* clave, char* out, size_t tam) {
    const char* p = valorDe(msg, clave);
    if (p == nullptr || *p != '"') return false;
    p++;
    size_t i = 0;
    while (*p != '\0' && *p != '"' && i + 1 < tam) {
        out[i++] = *p++;
    }
    out[i] = '\0';
    return *p == '"';
}

inline bool numero(const char* msg, const char* clave, double& out) {
    const char* p = valorDe(msg, clave);
    if (p == nullptr) return false;
    char* fin = nullptr;
    out = strtod(p, &fin);
    return fin != p;
}

//! "T1".."T9" -> 0..8; "CABINA" -> 0. Devuelve false si no es válido.
inline bool tripulante(const char* s, U8& idx, U8 max) {
    if (strcmp(s, "CABINA") == 0) {
        idx = 0;
        return true;
    }
    if (s[0] == 'T' && s[1] >= '1' && s[1] <= '9' && s[2] == '\0') {
        idx = static_cast<U8>(s[1] - '1');
        return idx < max;
    }
    return false;
}

struct DefSensor {
    const char* nombre;  //!< nombre en el contrato
    const char* unidad;  //!< unidad en el contrato
    Nova::Sensor::T sensor;
};

//! Sensores escalares del contrato (la presión llega como "pa" con extra.sis / extra.dia)
constexpr DefSensor SENSORES[] = {
    {"pulso", "lpm", Nova::Sensor::PULSO},
    {"spo2", "%", Nova::Sensor::SPO2},
    {"pa_sis", "mmHg", Nova::Sensor::PA_SIS},
    {"pa_dia", "mmHg", Nova::Sensor::PA_DIA},
    {"temp", "C", Nova::Sensor::TEMP},
    {"fr", "rpm", Nova::Sensor::FR},
    {"glucosa", "mg/dL", Nova::Sensor::GLUCOSA},
    {"vfc", "ms", Nova::Sensor::VFC},
    {"co2_cabina", "ppm", Nova::Sensor::CO2_CABINA},
    {"o2_cabina", "%", Nova::Sensor::O2_CABINA},
    {"temp_cabina", "C", Nova::Sensor::TEMP_CABINA},
    {"sueno_h", "h", Nova::Sensor::SUENO_H},
    {"animo", "1-5", Nova::Sensor::ANIMO},
    {"energia", "1-5", Nova::Sensor::ENERGIA},
    {"pasos", "pasos", Nova::Sensor::PASOS},
    {"fc_reposo", "lpm", Nova::Sensor::FC_REPOSO},
    {"luz", "lux", Nova::Sensor::LUZ},
    {"ruido", "dB", Nova::Sensor::RUIDO},
};

inline const DefSensor* sensorPorNombre(const char* nombre) {
    for (const DefSensor& d : SENSORES) {
        if (strcmp(nombre, d.nombre) == 0) return &d;
    }
    return nullptr;
}

inline const char* nombreSensor(Nova::Sensor::T s) {
    for (const DefSensor& d : SENSORES) {
        if (d.sensor == s) return d.nombre;
    }
    return "?";
}

inline const char* nombreNivel(Nova::Nivel::T n) {
    switch (n) {
        case Nova::Nivel::NORMAL:         return "normal";
        case Nova::Nivel::ESPERADO_VUELO: return "esperado_vuelo";
        case Nova::Nivel::ATENCION:       return "atencion";
        case Nova::Nivel::AVISO_TIERRA:   return "aviso_tierra";
        default:                          return "sin_dato";
    }
}

}  // namespace Json
}  // namespace Nova

#endif
