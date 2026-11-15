# Starting thresholds of the health monitor

These are F Prime parameters (`vuelo/Nova/Components/MonitorSalud/MonitorSalud.fpp`): the nightly update from Earth
can change them without recompiling. Two levels per indicator: **attention** (the crew handles it) and **Earth
notice** (notify the flight surgeon).

Status: starting values for the prototype. Every row has to carry a verified source before delivery, and a real
version must be validated by a physician.

| Indicator | Attention | Earth notice | Basis | Verified |
|---|---|---|---|---|
| Pulse (bpm) | ≥110 or ≤45 | ≥140 or ≤35 | Tachycardia >100 and bradycardia <50 in adults; margin for a trained crew | pending |
| SpO₂ (%) | <94 | <90 | Hypoxemia below 90 % | pending |
| Systolic pressure (mmHg) | ≥140 or ≤90 | ≥180 or ≤80 | Stage 2 hypertension (ACC/AHA 2017) and crisis ≥180; hypotension <90 | pending |
| Diastolic pressure (mmHg) | ≥90 | ≥120 | ACC/AHA 2017 | pending |
| Temperature (°C) | ≥38.0 or ≤35.5 | ≥39.5 or ≤35.0 | Fever ≥38; hypothermia <35 | pending |
| Respiratory rate (breaths/min) | ≥24 or ≤10 | ≥30 or ≤8 | Clinical early warning ranges | pending |
| Glucose (mg/dL) | <70 or ≥180 | <54 or ≥250 | ADA level 1 (<70) and level 2 (<54) hypoglycemia | pending |
| Cabin CO₂ (ppm) | ≥2600 | ≥5000 | NASA-STD-3001 Vol. 2 (cabin CO₂ limits) | pending: confirm current figures |

In the code the comparison is inclusive (`value >= high` or `value <= low`), so SpO₂ attention fires at 94 % and
Earth notice at 90 %; glucose attention at 70 mg/dL and Earth notice at 54 mg/dL.

Check-in and sleep from the NOVA app (the same cautious rules as the app: under 6 h of sleep, mood or energy ≤ 2):

| Indicator | Attention | Earth notice |
|---|---|---|
| Sleep last night (h) | ≤5.9 | ≤3.5 |
| Mood (1–5) | ≤2 | never escalated to Earth on its own |
| Energy (1–5) | ≤2 | — |

A sensor that has reported before and goes silent for `SEGUNDOS_SIN_DATOS` = 120 s is marked as having no data.

Pending:
- **Flight ranges** (OSDR / SOMA): mark `ESPERADO_VUELO` when the change is within what microgravity is expected to
  cause.
- **HRV:** compared with each person's baseline, not with a fixed threshold.
- **Trends:** detect sustained rises (e.g. resting heart rate +10 bpm over 3 days), not only threshold crossings.
