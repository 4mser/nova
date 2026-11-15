// ======================================================================
// Estacion
// ======================================================================

#include "Nova/Components/Estacion/Estacion.hpp"
#include "Nova/Components/Salud/JsonPlano.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace Nova {


Estacion::Estacion(const char* const compName)
    : EstacionComponentBase(compName),
      m_socket(-1),
      m_puerto(PUERTO_DEFECTO),
      m_recibidos(0),
      m_invalidos(0),
      m_ultimoMensaje(0),
      m_conectada(false) {}

Estacion::~Estacion() {
    if (m_socket >= 0) {
        close(m_socket);
    }
}

void Estacion::configure(U16 puerto) {
    m_puerto = puerto;
    m_socket = socket(AF_INET, SOCK_DGRAM, 0);
    if (m_socket < 0) {
        log_WARNING_HI_SIN_SOCKET(puerto, errno);
        return;
    }
    const int si = 1;
    (void)setsockopt(m_socket, SOL_SOCKET, SO_REUSEADDR, &si, sizeof(si));
    sockaddr_in dir;
    memset(&dir, 0, sizeof(dir));
    dir.sin_family = AF_INET;
    dir.sin_port = htons(puerto);
    dir.sin_addr.s_addr = htonl(INADDR_ANY);
    if (bind(m_socket, reinterpret_cast<sockaddr*>(&dir), sizeof(dir)) != 0 ||
        fcntl(m_socket, F_SETFL, fcntl(m_socket, F_GETFL, 0) | O_NONBLOCK) != 0) {
        log_WARNING_HI_SIN_SOCKET(puerto, errno);
        close(m_socket);
        m_socket = -1;
        return;
    }
    log_ACTIVITY_HI_ESCUCHANDO(puerto);
}

void Estacion::invalido(const char* motivo) {
    m_invalidos++;
    Fw::LogStringArg arg(motivo);
    log_WARNING_LO_MENSAJE_INVALIDO(arg);
}

bool Estacion::interpretar(const char* msg, const char*& motivo) {
    using Json::numero;
    using Json::texto;
    double v = 0.0;
    if (!numero(msg, "v", v) || static_cast<int>(v) != 1) {
        motivo = "version del contrato distinta de 1";
        return false;
    }
    char tipo[16];
    if (!texto(msg, "tipo", tipo, sizeof(tipo))) {
        motivo = "falta tipo";
        return false;
    }
    // latido, evento y onda solo cuentan como señal de vida por ahora
    if (strcmp(tipo, "latido") == 0 || strcmp(tipo, "evento") == 0 || strcmp(tipo, "onda") == 0) {
        return true;
    }
    if (strcmp(tipo, "medicion") != 0) {
        motivo = "tipo desconocido";
        return false;
    }

    char trip[8], sensor[16], unidad[12];
    if (!texto(msg, "trip", trip, sizeof(trip)) || !texto(msg, "sensor", sensor, sizeof(sensor)) ||
        !texto(msg, "unidad", unidad, sizeof(unidad))) {
        motivo = "faltan trip, sensor o unidad";
        return false;
    }

    U8 idx = 0;
    if (!Json::tripulante(trip, idx, Nova::TRIPULANTES)) {
        motivo = "trip invalido o fuera de la tripulacion";
        return false;
    }

    double calidad = 1.0;
    (void)numero(msg, "calidad", calidad);

    if (strcmp(sensor, "pa") == 0) {
        double sis = 0.0, dia = 0.0;
        if (strcmp(unidad, "mmHg") != 0) {
            motivo = "unidad de pa distinta de mmHg";
            return false;
        }
        if (!numero(msg, "sis", sis) || !numero(msg, "dia", dia)) {
            motivo = "pa sin extra.sis / extra.dia";
            return false;
        }
        signoOut_out(0, idx, Nova::Sensor::PA_SIS, static_cast<F32>(sis), static_cast<F32>(calidad));
        signoOut_out(0, idx, Nova::Sensor::PA_DIA, static_cast<F32>(dia), static_cast<F32>(calidad));
        return true;
    }

    const Json::DefSensor* d = Json::sensorPorNombre(sensor);
    if (d == nullptr) {
        motivo = "sensor desconocido";
        return false;
    }
    if (strcmp(unidad, d->unidad) != 0) {
        motivo = "unidad no coincide con el contrato";
        return false;
    }
    if (!numero(msg, "valor", v)) {
        motivo = "falta valor";
        return false;
    }
    signoOut_out(0, idx, d->sensor, static_cast<F32>(v), static_cast<F32>(calidad));
    return true;
}

void Estacion::schedIn_handler(FwIndexType portNum, U32 context) {
    (void)portNum;
    (void)context;
    const U32 ahora = getTime().getSeconds();

    if (m_socket >= 0) {
        char buf[MAX_MENSAJE + 1];
        for (U32 i = 0; i < MAX_POR_CICLO; i++) {
            const ssize_t n = recv(m_socket, buf, MAX_MENSAJE, 0);
            if (n <= 0) {
                break;  // EAGAIN: no hay más mensajes
            }
            // quitar el salto de línea final
            ssize_t largo = n;
            while (largo > 0 && (buf[largo - 1] == '\n' || buf[largo - 1] == '\r')) largo--;
            buf[largo] = '\0';

            m_recibidos++;
            m_ultimoMensaje = ahora;
            if (!m_conectada) {
                m_conectada = true;
                log_ACTIVITY_HI_CONECTADA();
            }
            const char* motivo = "";
            if (!interpretar(buf, motivo)) {
                invalido(motivo);
            }
        }
    }

    if (m_conectada && ahora - m_ultimoMensaje >= SEGUNDOS_SIN_LATIDO) {
        m_conectada = false;
        log_WARNING_HI_PERDIDA(ahora - m_ultimoMensaje);
    }

    tlmWrite_MensajesRecibidos(m_recibidos);
    tlmWrite_MensajesInvalidos(m_invalidos);
    tlmWrite_Conectada(m_conectada);
}

}  // namespace Nova
