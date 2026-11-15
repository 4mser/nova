# Detector activo de radiación para la nave

**Autor:** Luis González · **Estado:** diseño conceptual (no construido)

`Propuesta_Deteccion_radiacion.pdf` (9 páginas): idea original de cuatro canales (neutrones, betas, gammas y
alfas/protones leídos con fibras WLS y SiPM) y siete modificaciones para que sea factible en vuelo:

1. Neutrones con pantallas ⁶LiF/ZnS:Ag en lugar de ³He (sin gas a presión, muy insensible a gammas).
2. Una sola esfera de Bonner con detectores a seis radios (~9-11 kg) en lugar de seis esferas (~17-22 kg).
3. CsI(Tl) o GAGG:Ce en lugar de NaI(Tl) (no higroscópicos, robustos al lanzamiento).
4. Telescopio ΔE-E para protones de decenas a cientos de MeV.
5. Espectrómetro de LET en silicio para iones pesados: sin LET no hay dosis equivalente (Sv).
6. Canal rápido de alerta de partículas solares (SPE) en la FPGA: respuesta en segundos para ir al refugio.
7. Gestión de los SiPM en radiación: enfriamiento, coincidencias, redundancia y ensayos en haz.

Incluye presupuesto de masa (~15-25 kg) y potencia (10-25 W), plan de simulación y calibración (Geant4/FLUKA/MCNP,
fuentes Am-Be y Cf-252, haces en NSRL o HIMAC), riesgos y hoja de ruta en cuatro fases hasta un vuelo de
demostración en órbita baja. Las cifras son de orden de magnitud y se validan con simulación y prototipos.

## Cómo se conecta con NOVA

La nave ya está lista para recibirlo: el detector manda su lectura a `POST /v1/radiacion` (contrato en
`nave/estacion/CONTRATO.md`, sección «Radiación»). Mientras no exista, NOVA simula la tasa con las mediciones de MSL RAD
y lo dice. Con la alerta de partículas solares, NOVA avisa a todas las pantallas y guía a la tripulación al refugio
(protocolo «tormenta_solar», con fuentes de la NASA). Revisión física sugerida: Daniella Mora.
