# Active radiation detector for the ship

**Author:** Luis González · **Status:** conceptual design (not built)

[`Propuesta_Deteccion_radiacion.pdf`](Propuesta_Deteccion_radiacion.pdf) (9 pages, in Spanish): the original idea of
four channels (neutrons, betas, gammas and alphas/protons read through WLS fibers and SiPMs) and seven modifications
to make it feasible in flight:

1. Neutrons with ⁶LiF/ZnS:Ag screens instead of ³He (no pressurized gas, very insensitive to gammas).
2. A single Bonner sphere with detectors at six radii (~9–11 kg) instead of six spheres (~17–22 kg).
3. CsI(Tl) or GAGG:Ce instead of NaI(Tl) (not hygroscopic, robust to launch).
4. A ΔE-E telescope for protons from tens to hundreds of MeV.
5. A silicon LET spectrometer for heavy ions: without LET there is no equivalent dose (Sv).
6. A fast solar particle event (SPE) alert channel in the FPGA: a response within seconds to reach the shelter.
7. SiPM management under radiation: cooling, coincidences, redundancy and beam tests.

It includes a mass budget (~15–25 kg) and a power budget (10–25 W), a simulation and calibration plan
(Geant4/FLUKA/MCNP, Am-Be and Cf-252 sources, beams at NSRL or HIMAC), risks, and a four-phase roadmap up to a
demonstration flight in low Earth orbit. The figures are orders of magnitude, to be validated with simulation and
prototypes.

## How it connects to NOVA

The ship is ready to receive it. The detector sends its reading to `POST /v1/radiacion` on the ship link (contract in
[`nave/estacion/CONTRATO.md`](../../nave/estacion/CONTRATO.md), section "Radiation"; implementation in
[`nave/tripulacion/src-tauri/src/radiacion.rs`](../../nave/tripulacion/src-tauri/src/radiacion.rs)). Until the
detector exists, NOVA simulates the rate from MSL RAD measurements (cruise ~1.84 mSv/day, Zeitlin et al. 2013; Mars
surface ~0.64 mSv/day, Hassler et al. 2014) and says so. With the solar particle alert, or a rate of at least
500 µSv/h held for 30 s, NOVA warns every screen and guides the crew to the shelter (the `tormenta_solar` protocol,
with NASA sources), and logs the peak and the dose of the event against the 250 mSv per-event and 600 mSv career
limits of NASA-STD-3001. Suggested physics review: Daniella Mora.
