// ======================================================================
// Estacion: recibe los mensajes NDJSON de la estación médica por UDP
// (contrato en estacion/CONTRATO.md) y los pasa al monitor de salud.
// ======================================================================

#ifndef Nova_Estacion_HPP
#define Nova_Estacion_HPP

#include "Nova/Components/Estacion/EstacionComponentAc.hpp"
#include "Nova/Components/Salud/FppConstantsAc.hpp"

namespace Nova {

class Estacion final : public EstacionComponentBase {
  public:
    static constexpr U16 PUERTO_DEFECTO = 50050;
    static constexpr U32 SEGUNDOS_SIN_LATIDO = 15;
    static constexpr FwSizeType MAX_MENSAJE = 1024;
    static constexpr U32 MAX_POR_CICLO = 256;

    Estacion(const char* const compName);
    ~Estacion();

    //! Abre el puerto UDP (llamar al configurar la topología)
    void configure(U16 puerto = PUERTO_DEFECTO);

  private:
    void schedIn_handler(FwIndexType portNum, U32 context) override;

    //! Interpreta un mensaje; devuelve false y el motivo si no cumple el contrato
    bool interpretar(const char* msg, const char*& motivo);

    void invalido(const char* motivo);

    I32 m_socket;
    U16 m_puerto;
    U32 m_recibidos;
    U32 m_invalidos;
    U32 m_ultimoMensaje;  //!< segundo del último mensaje (0 = nunca)
    bool m_conectada;
};

}  // namespace Nova

#endif
