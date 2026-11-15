// ======================================================================
// Pantalla: puente entre el núcleo y la pantalla de la tripulación.
// Envía el estado (1 Hz) y las alertas como NDJSON por UDP y recibe
// las mediciones que la tripulación ingresa por teclado.
// ======================================================================

#ifndef Nova_Pantalla_HPP
#define Nova_Pantalla_HPP

#include "Nova/Components/Pantalla/PantallaComponentAc.hpp"
#include "Nova/Components/Salud/FppConstantsAc.hpp"

namespace Nova {

class Pantalla final : public PantallaComponentBase {
  public:
    static constexpr U16 PUERTO_ENVIO = 50051;      //!< la pantalla escucha aquí
    static constexpr U16 PUERTO_RECEPCION = 50052;  //!< el núcleo escucha aquí
    static constexpr FwSizeType MAX_SALIDA = 8192;
    static constexpr FwSizeType MAX_ENTRADA = 512;

    Pantalla(const char* const compName);
    ~Pantalla();

    //! Abre los sockets (solo en la máquina local: la pantalla es otro proceso de la nave)
    void configure(U16 envio = PUERTO_ENVIO, U16 recepcion = PUERTO_RECEPCION);

  private:
    void schedIn_handler(FwIndexType portNum, U32 context) override;
    void estadoIn_handler(FwIndexType portNum, const Nova::EstadoTripulacion& estado) override;
    void alertaIn_handler(FwIndexType portNum,
                          U8 trip,
                          const Nova::Sensor& sensor,
                          F32 valor,
                          const Nova::Nivel& nivel) override;

    void enviar(const char* msg, FwSizeType largo);
    bool interpretarIngreso(const char* msg, const char*& motivo);

    I32 m_envio;
    I32 m_recepcion;
    U16 m_puertoEnvio;
    U32 m_enviados;
    U32 m_ingresos;
    char m_buf[MAX_SALIDA];
};

}  // namespace Nova

#endif
