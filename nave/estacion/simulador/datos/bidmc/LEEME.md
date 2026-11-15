# BIDMC PPG and Respiration Dataset (extracto)

Cuatro registros numéricos (`bidmc_03`, `bidmc_12`, `bidmc_24`, `bidmc_41`: HR, PULSE, RESP, SpO2 a 1 Hz) del
BIDMC PPG and Respiration Dataset v1.0.0, publicado en PhysioNet bajo la Open Data Commons Attribution License v1.0.

- Pimentel MAF, Johnson AEW, Charlton PH, Birrenkott D, Watkinson PJ, Tarassenko L, Clifton DA. Toward a robust
  estimation of respiratory rate from pulse oximeters. IEEE Transactions on Biomedical Engineering, 2016.
- Goldberger A, et al. PhysioBank, PhysioToolkit, and PhysioNet. Circulation 101(23), 2000.
- https://physionet.org/content/bidmc/1.0.0/

El simulador usa solo la variabilidad (desvío respecto de la media de cada registro), montada sobre la línea base de
cada tripulante ficticio.
