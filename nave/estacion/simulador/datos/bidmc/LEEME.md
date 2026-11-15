# BIDMC PPG and Respiration Dataset (excerpt)

Four numeric records (`bidmc_03`, `bidmc_12`, `bidmc_24`, `bidmc_41`: HR, PULSE, RESP, SpO2 at 1 Hz) from the
BIDMC PPG and Respiration Dataset v1.0.0, published on PhysioNet under the Open Data Commons Attribution License v1.0.

- Pimentel MAF, Johnson AEW, Charlton PH, Birrenkott D, Watkinson PJ, Tarassenko L, Clifton DA. Toward a robust
  estimation of respiratory rate from pulse oximeters. IEEE Transactions on Biomedical Engineering, 2016.
- Goldberger A, et al. PhysioBank, PhysioToolkit, and PhysioNet. Circulation 101(23), 2000.
- https://physionet.org/content/bidmc/1.0.0/

The simulator uses only the variability (deviation from each record's mean), laid over the baseline of each fictional
crew member.
