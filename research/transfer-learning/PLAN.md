# Plan · Earth → space transfer learning

Status as of 14-11-2026, version 2: Benja gave the OK and asked to take the data from `datos/enviado_whatsapp/`, in his
local project folder. That is where NASA's bed-rest tables are. This version replaces the first one, which simulated
space and used the 8 variables of a watch.

## Goal

Build a model that knows what each astronaut is like on Earth and that learns, with a few days of data, their "new
normal" in microgravity. At the end it must be able to show the three plots of the project brief §8:

1. The Earth model fails in space.
2. Adaptation fixes it.
3. How many days NOVA needs to be reliable.

## Data

| Role | Source | What it provides |
|---|---|---|
| Space (analog) | NASA NLSP/LSDA, −6° head-down bed rest at UTMB: campaigns 1 and 3, CFT70 (batch 3 of `enviado_whatsapp`) | 29 subjects; morning vital signs for 10 to 21 pre-bed-rest days, 60 to 92 days in bed (42 to 91 with measured pulse) and up to 14 post-bed-rest days; daily urine output and water in 24 and 23 subjects |
| Earth | LifeSnaps (Yfantidou et al. 2022, doi:10.1038/s41597-022-01764-x, CC BY 4.0), 71 people | resting pulse, respiration and skin temperature from the watch, plus HRV, SpO₂, sleep, activity and stress |
| Personal Earth | each subject's pre-bed-rest period | their baseline before "launch" |

Bed rest is the standard Earth analog of microgravity and **is not a flight**. In the presentation it is presented as
"Earth analog (−6° bed rest)".

The 8 variables, with the name used in the ship's contract:

| Variable | Unit | In the contract? |
|---|---|---|
| `pulso` | bpm | yes |
| `pa_sis` | mmHg | yes |
| `pa_dia` | mmHg | yes |
| `fr` | rpm | yes |
| `temp` | °C | yes |
| `peso` | kg | yes |
| `diuresis` | g/day | no (question 18) |
| `agua` | g/day | no (question 18) |

Water intake follows a daily protocol target, so it is the weakest one as "physiology".

## What the check showed (pandas, on the PC)

- **There is a change.** Within the same people, and from day 28 in bed, pulse rises 2.6 bpm (±1.8) and weight drops
  1.3 kg (±0.5). The rest changes little. In post-bed-rest, pulse stays 7.8 bpm above baseline.
- **We did not find that short-term forecasting gets worse in bed rest.** A 7-day mean has a similar error in bed rest
  and in pre-bed-rest. That comparison is not paired: the pre-bed-rest windows fall in the first days after admission
  and have incomplete context. That is why plot 1 is not framed as forecast error but as **expected range**: the Earth
  monitor, built with the personal baseline, flags as abnormal what is normal in bed rest.

## Experiment

Validation is subject-wise, in 5 folds stratified by campaign: test subjects never enter the fitting. Results are
reported per variable, and campaign 3 contributes 23 of the 29 subjects. The numbers carry 95 % CIs from a subject
bootstrap (people are resampled, not days).

**Task 1 · Expected range** (`nova_tl/expectativa.py`; it is the residual model of the project brief §6.2):
- `tierra`: the pre-bed-rest mean ± 1.96 pre-bed-rest standard deviations.
- `tierra+poblacion`: adds a ridge corrector as a function of the day in bed, learned from OTHER subjects.
- `+personal(k)`: adds the shrunken mean of the residual of their first k days in bed, with k = 3, 7, 14, 21 and 28.
- Center and width are separated. The adapted models use a width calibrated to 5 % with out-of-sample residuals
  (subject-wise cross-validation within the training subjects). To avoid crediting the center with what is only
  calibration, there are two crossed models: `tierra (ancho calibrado)`, with the Earth center and the calibrated
  width, and `adaptado (ancho de Tierra)`, with the adapted center and ±1.96·sd.
- Placebo: the Earth rule applied within the pre-bed-rest period itself, leaving out the evaluated day. It is the
  false-alarm floor of that rule without any bed-rest effect.
- It is evaluated on the days in bed from day 28 onwards, with MAE, % false alarms, interval width and detection of
  injected 3-day steps (synthetic anomalies on real data, declared as such). The steps have random sign, and false
  alarms and detection are measured with the same rule ("≥ 2 of 3 consecutive days outside").
- Hand-set constants, with no sweep: day 28, KAPPA = 3, the ridge alpha and the step magnitude.

**Task 2 · 7-day forecast** (`nova_tl/modelo.py`): PatchTST from `transformers`, univariate and shared across
variables, with 14 days of context and a masked loss.
- It is trained on Earth with LifeSnaps and the pre-bed-rest data of the training subjects, one model per fold: the
  pre-bed-rest data of the test subjects never enters.
- It is compared against persistence, the 7-day mean, the non-adapted Earth model, a "space only" model from scratch, a
  "bed rest only" model from scratch with pre-bed-rest and bed data but without LifeSnaps (isolates the contribution
  of LifeSnaps), Earth→space tuning only the head or everything, and Chronos-2 not adapted.
- The metric is MAE relative to persistence (it is not Hyndman's MASE), averaged excluding water. Differences between
  models carry paired 95 % CIs from a subject bootstrap.
- Pressure, weight and fluids appear on Earth only through the pre-bed-rest period. LifeSnaps pulse, respiration and
  temperature come from a different instrument (the watch, not nursing staff).

## Where it runs

- **PC:** pandas, pytest and the task 1 ridge for the quick test. No neural network.
- **Kaggle:** the kernel `benjacampos/nova-transfer-learning` (T4 GPU) runs everything with the private dataset
  `benjacampos/nova-tl`, which contains the code and three parquet files.
- **Hugging Face:** the `nova-tierra` and `nova-espacio` weights are uploaded as private. The kernel can only upload
  them if it has the `HF_TOKEN` secret; otherwise, they are uploaded from the PC.

## What proves it is done

- pytest green.
- The kernel COMPLETE with `metricas.json`, `rango_esperado.csv`, `pronostico.csv` and plots 1 to 4.
- The weights on HF.
- The review by `ecc:python-reviewer` and `ecc:mle-reviewer`.

## Steps

1. ✅ `datos.py` with its tests: harmonizes the three forms, uses a single day axis, applies the contract ranges and
   adds up the fluids.
2. ✅ `ventanas.py`, `baselines.py` and `expectativa.py` with their tests.
3. ✅ `modelo.py` and `kaggle/correr.py`. Three runs on Kaggle: the first had a broken loss scale; the second went to
   `ecc:python-reviewer` and `ecc:mle-reviewer`; the third fixes what they found (pre-bed-rest leak in the forecast,
   width comparison, width calibrated in-sample, calendar days).
4. The results in the README, the weights on HF.
5. *(optional)* LoRA, seed rotation, the detection curve as a function of step size, and the variant with a moving
   window of the k days.
6. *(optional)* The PR to `4mser/nova`, with your OK.

## Reproduce

```
python -m nova_tl.datos --reposo <carpeta nlsp_tablas> --lifesnaps <daily .csv|.parquet> --salida <carpeta>
python -m pytest tests
kaggle datasets version -p <carpeta con nova_tl/ y los parquet> -m "..." --dir-mode zip
kaggle kernels push -p kaggle --accelerator NvidiaTeslaT4
```
