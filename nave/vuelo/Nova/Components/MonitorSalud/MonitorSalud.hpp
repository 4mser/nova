// ======================================================================
// MonitorSalud: compara los signos de cada tripulante con los umbrales
// y avisa solo cuando cambia el nivel de un indicador.
// ======================================================================

#ifndef Nova_MonitorSalud_HPP
#define Nova_MonitorSalud_HPP

#include "Nova/Components/MonitorSalud/MonitorSaludComponentAc.hpp"
#include "Nova/Components/Salud/FppConstantsAc.hpp"

namespace Nova {

class MonitorSalud final : public MonitorSaludComponentBase {
  public:
    MonitorSalud(const char* const compName);
    ~MonitorSalud();

  private:
    void schedIn_handler(FwIndexType portNum, U32 context) override;

    void signoIn_handler(FwIndexType portNum,
                         U8 trip,
                         const Nova::Sensor& sensor,
                         F32 valor,
                         F32 calidad) override;

    void INGRESAR_SIGNO_cmdHandler(FwOpcodeType opCode,
                                   U32 cmdSeq,
                                   U8 trip,
                                   const Nova::Sensor& sensor,
                                   F32 valor) override;

    //! Valida, guarda y clasifica una medición. Devuelve false si se descartó.
    bool procesar(U8 trip, const Nova::Sensor& sensor, F32 valor, F32 calidad);

    //! Umbrales vigentes de un sensor, leídos de los parámetros (≤ 0 = no aplica)
    Nova::Umbral umbralDe(Nova::Sensor::T sensor);

    //! Nivel de un valor según los umbrales vigentes
    Nova::Nivel::T clasificar(Nova::Sensor::T sensor, F32 valor);

    //! Rango físico posible: fuera de él es error del sensor, no emergencia
    static bool plausible(Nova::Sensor::T sensor, F32 valor);

    static bool esCabina(Nova::Sensor::T sensor);

    static constexpr FwSizeType N_TRIP = Nova::TRIPULANTES;
    static constexpr FwSizeType N_SENSOR = Nova::Sensor::NUM_CONSTANTS;

    F32 m_valor[N_TRIP][N_SENSOR];
    Nova::Nivel::T m_nivel[N_TRIP][N_SENSOR];
    U32 m_ultimo[N_TRIP][N_SENSOR];  //!< segundo de la última medición (0 = nunca)
    bool m_avisadoSinDatos[N_TRIP][N_SENSOR];
    U32 m_bajaDesde[N_TRIP][N_SENSOR];  //!< segundo desde que el valor está en un nivel menor (0 = no)
    U32 m_recibidos;

    //! Segundos que un nivel menor tiene que mantenerse para bajar (histéresis)
    static constexpr U32 SEGUNDOS_PARA_BAJAR = 10;
};

}  // namespace Nova

#endif
