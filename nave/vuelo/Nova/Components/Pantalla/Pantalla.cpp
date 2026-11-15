// ======================================================================
// Pantalla
// ======================================================================

#include "Nova/Components/Pantalla/Pantalla.hpp"
#include "Nova/Components/Salud/JsonPlano.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#include <cerrno>
#include <cstdarg>

namespace Nova {

static_assert(Nova::Sensor::NUM_CONSTANTS == Nova::NivelesSensores::SIZE,
              "NivelesSensores y EdadSensores tienen que tener un elemento por sensor");

namespace {

//! Escritor acotado sobre un búfer fijo: si no cabe, marca el desborde y deja de escribir
struct Escritor {
    char* buf;
    FwSizeType cap;
    FwSizeType n;
    bool lleno;
    void f(const char* fmt, ...) {
        if (lleno) return;
        va_list ap;
        va_start(ap, fmt);
        const int k = vsnprintf(buf + n, cap - n, fmt, ap);
        va_end(ap);
        if (k < 0 || static_cast<FwSizeType>(k) >= cap - n) {
            lleno = true;
            return;
        }
        n += static_cast<FwSizeType>(k);
    }
};

}  // namespace

Pantalla::Pantalla(const char* const compName)
    : PantallaComponentBase(compName),
      m_envio(-1),
      m_recepcion(-1),
      m_puertoEnvio(PUERTO_ENVIO),
      m_enviados(0),
      m_ingresos(0) {
    m_buf[0] = '\0';
}

Pantalla::~Pantalla() {
    if (m_envio >= 0) close(m_envio);
    if (m_recepcion >= 0) close(m_recepcion);
}

void Pantalla::configure(U16 envio, U16 recepcion) {
    m_puertoEnvio = envio;
    m_envio = socket(AF_INET, SOCK_DGRAM, 0);
    if (m_envio < 0) {
        log_WARNING_HI_SIN_SOCKET(envio, errno);
    }

    m_recepcion = socket(AF_INET, SOCK_DGRAM, 0);
    if (m_recepcion < 0) {
        log_WARNING_HI_SIN_SOCKET(recepcion, errno);
        return;
    }
    const int si = 1;
    (void)setsockopt(m_recepcion, SOL_SOCKET, SO_REUSEADDR, &si, sizeof(si));
    sockaddr_in dir;
    memset(&dir, 0, sizeof(dir));
    dir.sin_family = AF_INET;
    dir.sin_port = htons(recepcion);
    dir.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(m_recepcion, reinterpret_cast<sockaddr*>(&dir), sizeof(dir)) != 0 ||
        fcntl(m_recepcion, F_SETFL, fcntl(m_recepcion, F_GETFL, 0) | O_NONBLOCK) != 0) {
        log_WARNING_HI_SIN_SOCKET(recepcion, errno);
        close(m_recepcion);
        m_recepcion = -1;
        return;
    }
    log_ACTIVITY_HI_LISTA(envio, recepcion);
}

void Pantalla::enviar(const char* msg, FwSizeType largo) {
    if (m_envio < 0) return;
    sockaddr_in dir;
    memset(&dir, 0, sizeof(dir));
    dir.sin_family = AF_INET;
    dir.sin_port = htons(m_puertoEnvio);
    dir.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    // Si la pantalla no está abierta, el datagrama se pierde: es lo esperado
    if (sendto(m_envio, msg, largo, 0, reinterpret_cast<sockaddr*>(&dir), sizeof(dir)) > 0) {
        m_enviados++;
    }
}

void Pantalla::estadoIn_handler(FwIndexType portNum, const Nova::EstadoTripulacion& e) {
    (void)portNum;
    Escritor w{m_buf, MAX_SALIDA, 0, false};
    w.f("{\"tipo\":\"estado\",\"t\":%u,\"trip\":[", getTime().getSeconds());
    for (FwSizeType t = 0; t < Nova::TRIPULANTES; t++) {
        w.f("%s{\"pulso\":%.1f,\"spo2\":%.1f,\"pa_sis\":%.1f,\"pa_dia\":%.1f,\"temp\":%.2f,\"fr\":%.1f,"
            "\"glucosa\":%.1f,\"vfc\":%.1f,\"sueno_h\":%.2f,\"animo\":%.0f,\"energia\":%.0f,\"pasos\":%.0f,"
            "\"fc_reposo\":%.1f,\"nivel\":\"%s\",\"niveles\":{",
            t ? "," : "", static_cast<double>(e.get_pulso()[t]), static_cast<double>(e.get_spo2()[t]),
            static_cast<double>(e.get_paSis()[t]), static_cast<double>(e.get_paDia()[t]),
            static_cast<double>(e.get_temp()[t]), static_cast<double>(e.get_fr()[t]),
            static_cast<double>(e.get_glucosa()[t]), static_cast<double>(e.get_vfc()[t]),
            static_cast<double>(e.get_sueno()[t]), static_cast<double>(e.get_animo()[t]),
            static_cast<double>(e.get_energia()[t]), static_cast<double>(e.get_pasos()[t]),
            static_cast<double>(e.get_fcReposo()[t]), Json::nombreNivel(e.get_nivel()[t].e));
        for (FwSizeType s = 0; s < Nova::Sensor::NUM_CONSTANTS; s++) {
            w.f("%s\"%s\":\"%s\"", s ? "," : "", Json::nombreSensor(static_cast<Nova::Sensor::T>(s)),
                Json::nombreNivel(e.get_niveles()[t][s].e));
        }
        w.f("},\"edades\":{");
        for (FwSizeType s = 0; s < Nova::Sensor::NUM_CONSTANTS; s++) {
            w.f("%s\"%s\":%u", s ? "," : "", Json::nombreSensor(static_cast<Nova::Sensor::T>(s)),
                e.get_edades()[t][s]);
        }
        w.f("}}");
    }
    w.f("],\"umbrales\":{");
    for (FwSizeType s = 0; s < Nova::Sensor::NUM_CONSTANTS; s++) {
        const Nova::Umbral& u = e.get_umbrales()[s];
        w.f("%s\"%s\":[%g,%g,%g,%g]", s ? "," : "", Json::nombreSensor(static_cast<Nova::Sensor::T>(s)),
            static_cast<double>(u.get_altoAtencion()), static_cast<double>(u.get_altoTierra()),
            static_cast<double>(u.get_bajoAtencion()), static_cast<double>(u.get_bajoTierra()));
    }
    w.f("},\"cabina\":{\"co2\":%.0f,\"o2\":%.2f,\"temp\":%.1f,\"nivel_co2\":\"%s\"}}\n",
        static_cast<double>(e.get_co2Cabina()), static_cast<double>(e.get_o2Cabina()),
        static_cast<double>(e.get_tempCabina()), Json::nombreNivel(e.get_nivelCo2()));
    if (!w.lleno) {
        enviar(m_buf, w.n);
    }
}

void Pantalla::alertaIn_handler(FwIndexType portNum,
                                U8 trip,
                                const Nova::Sensor& sensor,
                                F32 valor,
                                const Nova::Nivel& nivel) {
    (void)portNum;
    char msg[256];
    const int n = snprintf(msg, sizeof(msg),
                           "{\"tipo\":\"alerta\",\"t\":%u,\"trip\":%u,\"sensor\":\"%s\",\"valor\":%.1f,\"nivel\":\"%s\"}\n",
                           getTime().getSeconds(), static_cast<unsigned>(trip), Json::nombreSensor(sensor.e),
                           static_cast<double>(valor), Json::nombreNivel(nivel.e));
    if (n > 0 && static_cast<size_t>(n) < sizeof(msg)) {
        enviar(msg, static_cast<FwSizeType>(n));
    }
}

bool Pantalla::interpretarIngreso(const char* msg, const char*& motivo) {
    char tipo[16], trip[8], sensor[16];
    double valor = 0.0;
    if (!Json::texto(msg, "tipo", tipo, sizeof(tipo)) || strcmp(tipo, "ingreso") != 0) {
        motivo = "tipo distinto de ingreso";
        return false;
    }
    if (!Json::texto(msg, "trip", trip, sizeof(trip)) || !Json::texto(msg, "sensor", sensor, sizeof(sensor)) ||
        !Json::numero(msg, "valor", valor)) {
        motivo = "faltan trip, sensor o valor";
        return false;
    }
    U8 idx = 0;
    if (!Json::tripulante(trip, idx, Nova::TRIPULANTES)) {
        motivo = "tripulante invalido";
        return false;
    }
    const Json::DefSensor* d = Json::sensorPorNombre(sensor);
    if (d == nullptr) {
        motivo = "sensor desconocido";
        return false;
    }
    m_ingresos++;
    log_ACTIVITY_HI_INGRESO(static_cast<U8>(idx + 1), d->sensor, static_cast<F32>(valor));
    signoOut_out(0, idx, d->sensor, static_cast<F32>(valor), 1.0f);
    return true;
}

void Pantalla::schedIn_handler(FwIndexType portNum, U32 context) {
    (void)portNum;
    (void)context;
    if (m_recepcion >= 0) {
        char buf[MAX_ENTRADA + 1];
        for (U32 i = 0; i < 32; i++) {
            const ssize_t n = recv(m_recepcion, buf, MAX_ENTRADA, 0);
            if (n <= 0) break;
            buf[n] = '\0';
            const char* motivo = "";
            if (!interpretarIngreso(buf, motivo)) {
                Fw::LogStringArg arg(motivo);
                log_WARNING_LO_INGRESO_INVALIDO(arg);
            }
        }
    }
    tlmWrite_MensajesEnviados(m_enviados);
    tlmWrite_IngresosTripulacion(m_ingresos);
}

}  // namespace Nova
