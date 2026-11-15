# Background: eye assessment with computer vision, soft sensors, Earth→space transfer and data

Updated: 14 Nov 2026, after checking against primary sources (abstracts, official pages, arXiv).
Status: background only. There is no implementation and no new folders.
Visual design page: `Antecedentes/nova-vision-ocular.html`.

## How to read the tags
- **[V]** verified: the primary source was opened and the figure or fact appears there.
- **[P]** partial: the existence or part of the fact was confirmed; the full text, the denominator or another piece is missing.
- **[NV]** not verified: comes from search summaries, a blog or my own inference. **Do not cite in the pitch.**
- **[INF]** my own inference, without a source.

Limit of the verification: PubMed, PMC, Nature, NEJM and Wiley blocked automated reading. Abstracts were read via Europe PMC, E-utilities and Crossref; full texts were not.

## 1. Corrections to earlier versions
- **MRD2** is the distance from the center of the cornea to the **lower** eyelid margin. MRD1 is the one for the upper eyelid. I described it the other way around before.
- **The only MRD2 study in astronauts is listed as RETRACTED** on the journal page (see 5.6). Do not use it as evidence.
- **PPG-Distill** has arXiv ID **2509.19215**. 2511.18829 is a different paper (characterization of distillation for pulse estimation).
- **Costes 2024** is actually **Sanders et al. 2024** (Costes is the last author).
- **"Lee et al., *Lancet Neurology* 2020"** does not exist in what was found. The correct citation is Lee et al., *npj Microgravity* 2020;6:7.
- **Buller 2013:** the figures N=83 and ±0.58 °C **could not be verified**.
- **SANS prevalence ~1/3:** its source was not found. Only NASA's ~70 % is kept, without a denominator.
- **The "~50 mL" figure for displaced fluid** and the 1991 bed rest study: no primary source. Removed.

## 2. Proposed architecture

```
PHASE 1 (Earth)
 common sensors + phone camera (AR scanner)
   -> eye assessment by computer vision (no soft sensors)
   -> pretrained PPG encoder (PaPaGei, ~5 M parameters) + signal soft sensors
   -> quality gate + personal baseline (median/MAD, from this repo)
   -> small LLM (Qwen3 4B): ONLY verbalizes computed outputs, does not decide

PHASE 2 (space)
 Earth model (teacher) --distillation--> small model (student, on board)
   -> per-astronaut calibration with their pre-flight baseline
   -> forecasting with an uncertainty cone
   -> flight parameters from the literature, not from raw data
```

"Small data" = scarce data from space. The smaller model comes from **distillation** (teacher→student). Phase 2 is presented as a design: there are no astronaut data to validate it.

## 2.1 Design decisions (14 Nov)
- The software depends **only on a phone and a webcam**. If missions already use other ophthalmic instruments, they are **integrated as optional input** through the medical station contract (they are not part of the computer vision). According to NASA's SANS risk page [V], the ISS uses OCT, fundus imaging, tonometry, ocular ultrasound and acuity software.
- Visual acuity and the Amsler grid **are included**, assisted by the camera (distance and fixation). Amsler is marked as exploratory: no verified validation.
- The pupil is measured with **visible light**, as relative size, stating that there is bias and failures with brown eyes (see 3.2).
- The eye module runs **inside the `/v1/vision/ws` bridge** (port 8792, MediaPipe on the GPU).
- The camera is **switchable**: front (self-check, autonomous mode) and rear (another person scans, supervised mode). The baseline is stored per camera, the iris-based distance estimate is calibrated per camera, and the module records whether the image is mirrored and which camera was used. [INF: own design; the PDF does not specify which camera the scanner uses today]

## 3. Eye assessment with computer vision

### 3.1 CV tools
| Topic | Status | Evidence |
|---|---|---|
| MediaPipe Face Landmarker | [V] | "3D facial surface landmarks (478 points)", 52 blendshapes, BlazeFace detector. Google AI Edge docs. |
| That those 478 include the iris (468+10) | [V] measured | Spike of 14 Nov with Niko's webcam: 478 landmarks per face, indices 468-477 present with x and y between 0 and 1, face detected in 90 of 90 frames, latency 7.76 ms median and 8.97 ms p95 on CPU (`docs/spike-resultados.md`). One person, one session, good light: it does not measure iris accuracy. |
| License | [P] | MediaPipe repo: Apache 2.0. The Landmarker page does not state a license. |
| Attention Mesh | [V] | Grishchenko, Ablavatski, Kartynnik, Raveendran, Grundmann. CVPRW 2020. arXiv 2006.10962. |
| Real-time pupil | [V] | Ablavatski et al. 2020, arXiv 2006.11341: 7.16 % MAD/IED on ~4,000 images (human annotation 5.73-7.04 %). |
| Distance to screen from iris size | [P] | Google Research blog (not a paper): mean relative error 4.3 % (SD 2.4 %); with glasses 4.8 % (SD 3.1 %); under 10 %; ~50,000 images, >200 participants. |
| Iris ≈ 11.7 ± 0.5 mm | [NV] | Appears in the blog; the 4 source papers were not identified. |
| Eye Aspect Ratio | [V] | Soukupová and Čech, CVWW 2016. ZJU (80 videos, 20 subjects) and Eyeblink8, EAR threshold 0.2 and EAR+SVM. It is "relatively easy" on ZJU; the simple threshold falls behind the SVM on Eyeblink8. Fails with smiling, side view, long closures and IOD under 20 px. Results in curves, with no single figure. |

### 3.2 Eye signals
| Signal | Status | Evidence |
|---|---|---|
| PERCLOS | [V] concept, [NV] webcam | NHTSA DOT HS 808 762 (1998), Dinges, Mallis, Maislin, Powell: proportion of time per minute with eyes >80 % closed (concept by Wierwille 1994). Correlation with PVT attention lapses: r=0.875 (frequency) and r=0.919 (duration); sleepiness self-assessment r=0.626. **It was validated with human observers on low-light CCTV video**; the report calls for automating it. With a webcam there is only one unopened secondary review (heterogeneous thresholds). |
| Phone pupillometry | [P] | Table from Solyman et al., *Clin Ophthalmol* 2022: infrared camera, 12 patients (23 eyes), mean difference 0.03 ± 0.15 mm against a desktop pupillometer, LoA -0.27 to 0.32, ICC 0.982-0.986. PupilScreen (Mariakakis 2017, visible-light camera in a closed box): bias +0.24 mm (blue eyes), +0.27 (brown), +0.07 (mixed). Neice 2020 (visible): 6 of 26 eyes not identified. **The good figures use infrared or controlled conditions; brown eyes with a visible-light camera are the weak point.** |
| MRD1/MRD2 with a phone | [V] | Chen et al., *JMIR mHealth uHealth* 2021 (PMC8538024): iPhone 11 Pro Max, 822 eyes from 411 volunteers, mean absolute error 0.35 mm (MRD1) and 0.37 mm (MRD2), LoA MRD1 ±0.94 mm. It is deep learning, not pure landmarks. |
| Visual acuity with a phone | [V] | Peek Acuity, Bastawrous et al., *JAMA Ophthalmol* 2015, PMID 26022921: 300 adults ≥55 years, Kenya; test-retest ±0.033 logMAR; mean difference 0.07 logMAR against ETDRS (CI 0.05-0.09) and 0.08 against Snellen (0.06-0.10); 77 s vs 82 s. Uses an ETDRS "E" with an operator at a fixed distance: it is not CV-only estimation. |
| Digital Amsler grid | [NV] | Snippets only (PocDoc sensitivity 50 %, Checkup 93 %/92 %). Open the papers before citing. |
| Papilledema with AI, BONSAI | [P] | Milea et al., *NEJM* 2020, PMID 32286748: 15,846 photos (14,341 from 19 centers in 11 countries for training and validation; 1,505 from 5 centers for external testing). Validation AUC 0.99; external test AUC 0.96, sensitivity 96.4 %, specificity 84.7 %. Abstract read via E-utilities. |
| Papilledema with non-mydriatic photos, FOTO-ED | [V] | Biousse et al., *Am J Ophthalmol* 261:199-207, 2024, PMID 37926337: retrospective secondary analysis with modified BONSAI, 1,608 photos from 828 patients. Papilledema vs the rest: AUC 0.97 (CI 0.95-0.99), sensitivity 84.0 %, specificity 98.9 %. Normal vs abnormal: AUC 0.92, sensitivity 75.6 %, specificity 89.6 %. Fundus cameras, not a phone. |
| Papilledema with handheld cameras | [NV] | Gungor et al., *J Neuroophthalmol* 2026, PMID 40867029: only the title was read. |

### 3.3 Periorbital edema: state of the evidence
- Astronaut study: Ax, Bothe, Craig, Dean, Zimmermann, March de Ribot, Jensen, Millar, Seitz. "The Effect of Microgravity on Lower Eyelid Position in Astronauts". *Eye & ENT Research* 3(2):69-74, 2026. DOI 10.1002/eer3.70043.
  - Content [V on the journal page]: 115 NASA photos (52 on Earth, 63 in space) of 13 astronauts; MRD2 measured by hand in Photoshop, calibrated with the mean corneal diameter (11.60 mm men, 11.71 mm women); MRD2 went from 4.9 ± 0.7 mm on Earth to 3.9 ± 0.7 mm in space (p<0.001); 8 of 13 dropped ≥1 mm.
  - **Status: the journal page says "This article has been retracted" and "The Retraction Note was updated to reflect reception of statements of disagreement from all authors". It gives no date or reason.** Do not cite until the retraction notice has been reviewed (Wiley or Retraction Watch).
- There is no validated method to measure overall facial swelling with computer vision (none found).
- I found no in-flight eye monitoring with consumer cameras. A systematic review of 72 studies (Meer et al., *npj Microgravity* 2025, PMID 40890229) concludes "No single technology can independently track SANS progression".

## 4. SANS and in-flight surveillance
| Topic | Status | Evidence |
|---|---|---|
| Original description | [V] abstract | Mader, Gibson, Pass et al., *Ophthalmology* 118(10):2058-2069, 2011, PMID 21849212: 7 astronauts with ocular findings after long ISS missions, plus questionnaires from ~300. Disc edema in 5, globe flattening in 5, choroidal folds in 5; hyperopic shift of +0.50 D or more in 5 of 7 (up to +1.75 D). In the 4 with disc edema, lumbar puncture opening pressure of 21 to 28.5 cm H2O. Questionnaires: ~29 % (short mission) and ~60 % (long) with worse vision. |
| Review | [P] | Lee, Mader, Gibson et al., *npj Microgravity* 6:7, 2020, PMID 32047839 (PMC7005826). The abstract lists disc edema, globe flattening, choroidal and retinal folds, hyperopic shift and cotton wool spots. The body was not read: no verified N or prevalence. |
| Prevalence | [P] | NASA HRP: "About 70% of crewmembers show at least one hallmark sign". No denominator or year. The ~1/3 has no source found. Mader 2011 is not clinical prevalence. |
| Recent cohort | [V] | Brunstetter et al., *JAMA Ophthalmol* 2025, PMID 41066117: 16 astronauts with two ISS missions; SANS status on one mission predicted that on the next. Small N. |
| Mechanism | [P] | Review abstracts only: Rodrigues et al., *npj Microgravity* 2025 (PMID 40456790), 20 studies: increased intracranial pressure from CSF shift vs CSF compartmentalization; "not mutually exclusive". Martin Paez et al., *Eye Brain* 2020 (PMID 33117025). Mampre et al., 2025 (PMID 40643392): venous hypothesis. The primary studies (Marshall-Goebel, Laurie, Lawley) were not opened. |
| ISS surveillance | [V] | NASA HRP SANS risk page: visual acuity software, ocular ultrasound, ophthalmic imaging and OCT. "Ocular Health" task: in-flight measurements every ~30 days (tonometry, ocular ultrasound, fundoscopy, acuity, OCT, blood pressure, cardiac output, transcranial Doppler), from 1 year before to 1 year after. Visual fields before and immediately after flight; brain and eye MRI before and within the first 3 days after return. MiniOCT Demo-ISS (4 subjects) intended for Artemis. |
| In-flight Amsler | [NV] | Does not appear in the part of the NASA page that was read. |
| Countermeasures | [P] | Nguyen et al., *Prog Retin Eye Res* 2025 (PMID 39971096): goggles, lower body negative pressure, thigh cuffs, centrifugation. |

**What CANNOT be said without OCT:** diagnose, rule out or grade disc edema; see choroidal folds or globe flattening; infer intracranial pressure; quantify edema in mL. A change in acuity, pupil or blinking is not specific to SANS. Allowed wording: "follow-up alert", never "SANS". [INF, consistent with the sources]

## 5. Fundus datasets
| Dataset | Status | Finding |
|---|---|---|
| REFUGE | [P] | 1,200 color photos, 1:1:1 into 400 training, 400 validation and 400 test. No declared license, only general Grand Challenge terms. |
| G1020 | [P] | Bajwa et al., arXiv 2006.09158, IJCNN 2020: 1,020 images. No license declared on the page. |
| PAPILA | [P] | Kovalyk et al., *Sci Data* 9:291, 2022, DOI 10.1038/s41597-022-01388-1. Only the citation was confirmed; size and license not opened. |
| ORIGA | [NV] | No source was opened. |
| Public papilledema | [NV] | None was found; the search was not exhaustive. |

## 6. Soft sensors and signal models (outside the vision module)
| Topic | Status | Evidence |
|---|---|---|
| PaPaGei | [V] | Pillai, Spathis, Kawsar, Malekzadeh. ICLR 2025, arXiv 2410.20542. PaPaGei-P 5 M and PaPaGei-S 5.7 M parameters; >57,000 h and 20 M segments; 20 tasks on 10 datasets; +6.3 % on classification metrics and +2.9 % on regression in at least 14 tasks. That the metric is AUROC is [INF]. BSD-3 code. **Weights (Zenodo 13983110): no license declared** (confirmed in the API); they only cite VitalDB CC BY 4.0 and MIMIC-III Matched ODbL. CPU: plausible, not measured [INF]. |
| Pulse-PPG | [P] | Saha, Xu, Mao, Neupane, Rehg, Kumar. arXiv 2502.01108, 2025, preprint. Field study of 100 days and 120 participants [V]. "Outperforms PaPaGei on 10 of 11 tasks" is the authors' own claim [NV in text]. MIT code [NV recheck]. |
| PPG-Distill | [V] | Ni, Kataria, Tang, Yang, Hu, Jin. arXiv 2509.19215, NeurIPS 2025 TS4H workshop. Up to +21.8 % over the student, 7x faster inference, 19x less memory (HR and atrial fibrillation). |
| Distillation for pulse estimation | [V] exists | Arora, Narayanswamy, Patel, Li. arXiv 2511.18829, NeurIPS 2025 workshop. Compares 4 distillation strategies; the abstract gives no metrics. |
| UNIPHY+ | [V] exists | Wang et al. (Xiao Hu last author). arXiv 2509.16348, preprint. No metrics in the abstract. |
| Blood pressure from PPG, NBPDB | [V] | Mathew, Shen, Hu, Rahimi, Zouridakis. arXiv 2602.04725, 2026, preprint. 101,453 segments from 1,103 healthy adults (MIMIC-III and VitalDB). No model met AAMI/ISO 81060-2 before the improvement; MInception with age, sex and BMI: MAE 4.75 mmHg (SBP) and 2.90 (DBP). |
| Stress, generalization | [P] | Prajod, Mahesh, André. arXiv 2405.09563, 2024: 4 datasets (WESAD, SWELL-KW, ForDigitStress, VerBIO). The abstract does not give the percentage drop: the "15-40 %" figure is [NV]. |
| LLM + wearables | [V] | Health-LLM (Kim et al., arXiv 2401.06866): 12 LLMs, 4 datasets, 10 tasks; HealthAlpaca best on 8 of 10; up to +23.8 % with context. PH-LLM (Cosentino et al., arXiv 2406.06474): 79 % on sleep and 88 % on fitness, 857 cases. HealthSLM-Bench (arXiv 2509.07260, NeurIPS 2025 GenAI4Health workshop): no figures in the abstract. WearableQA and SensorQA: [NV]. |
| Time series models | [P] | They exist: SensorLM (arXiv 2506.09108; 59.7 M hours, >103,000 people), MIRA (arXiv 2506.07584, NeurIPS 2025), SOTER (arXiv 2609.16804), zero-shot HRV (arXiv 2607.20027, CinC 2026), arXiv 2510.14254 (generalist vs specialist benchmark on PPG) and arXiv 2412.03427. **The claim "a simple baseline (LOCF) wins on several tasks" was not verified and its attribution to 2510.14254 is doubtful.** Licenses of Chronos, MOMENT and TimesFM [NV recheck]. |
| Core temperature from pulse (Kalman) | [P] | Buller et al., *Physiol Meas* 34:781-798, 2013, DOI 10.1088/0967-3334/34/7/781. The abstract was not opened. N=83 and ±0.58 °C: [NV]. The USARIEM page gives bias -0.03 °C, SD 0.32, RMSE 0.30 °C, limits ±0.63 °C, without saying which dataset. |
| Core temperature with skin + heat flux + pulse | [P] | Welles et al., *Comput Biol Med* 99:1-6, 2018, PMID 29803944. RMSE 0.18 °C (pectoral 0.18 ± 0.04; rib 0.18 ± 0.09) only in search results. Uses 3 signals, not only pulse. |
| Systolic pressure on the ISS (Waterloo/CSA) | [NV] | EurekAlert press release (649440): Bio-Monitor shirt (Hexoskin), first author Carmelo Mastrandrea, ~72 h before and ~72 h in orbit, "continuous estimation" of systolic pressure. No values or metrics; no peer-reviewed paper found. |
| Bio-Monitor / Astroskin (CSA) | [NV recheck] | CSA page cited by an earlier search; not reopened. |
| Thermolab / Double Sensor (DLR/ESA) | [P] | Flew to the ISS in 2009 (DLR). Ground validation of -0.16 to 0.1 °C vs rectal in 20 subjects (Physiological Society abstract). ESA reports 10 astronauts and the IAC-18 abstract, 11. Do not use the "+1 °C in 2 months" figure (press only). |

## 7. Physiological signal data
Conclusion: **no open raw signals were found from spaceflight, Mars-500, HI-SEAS or SIRIUS** (non-exhaustive search).

| Dataset | Status | Signals | N | License | Access |
|---|---|---|---|---|---|
| BIDMC | [V] | PPG, impedance resp., ECG at 125 Hz; HR, RR, SpO2 at 1 Hz | 53 recordings of 8 min (not unique subjects); 207.7 MB | ODC-By 1.0 | open download |
| PPG-DaLiA | [P] | BVP 64 Hz, EDA, temp., accel., reference ECG | 15; 2.7 GB | CC BY 4.0 | UCI |
| MMASH | [V] | IBI/RR, HR, ACC, steps, sleep, questionnaires, cortisol and melatonin; 23.5 MB | 22 healthy males | ODbL 1.0 | open |
| LifeSnaps (Zenodo 6826682, v4) | [V] | Fitbit Sense + surveys, 35+ types, >4 months; 615 MB | 71 | CC BY 4.0 | open. v2 (6832186) is restricted and obsolete |
| WESAD | [P] | RespiBAN 700 Hz: ECG, EDA, EMG, resp., temp., ACC. Empatica E4: BVP 64 Hz, EDA 4 Hz, temp. 4 Hz, ACC 32 Hz | 15 | UCI does not declare a license; "non-commercial + credit" [NV] | Siegen or `ucimlrepo` id=465 |
| MIMIC-III waveform matched | [P] | ICU waveforms | 10,282 patients | PhysioNet (terms [NV]) | download; not a healthy population |
| Sleep-EDF Expanded | [NV recheck] | EEG/EOG/EMG | 197 PSG | ODC-BY according to PhysioNet; a mirror says ODbL | PhysioNet |
| LunAres (2 wk, 2018) | [NV] | daily logs (weight, HR, blood pressure, sleep, nutrition, exercise) | no data | no data | PDF and author page returned 404; data not located |
| OSDR / Inspiration4 | [P] | omics and clinical | 4 | public (processed) | OSDR; raw via committee. Correct citation: Sanders et al., *npj Microgravity* 10:56, 2024 (data access article) |
| LSAH / LSDA | [P] | clinical and research | n/a | n/a | request with IRB; timelines from 2012-2017 presentations; not feasible today |
| Bed rest HDT (Solbiati and Caiani 2025) | [P] | HRV from bed rest campaigns | "66 men, 6 campaigns" [NV] | n/a | no verified repository. **It is bed rest, not flight** |

## 8. Limits to state in the pitch
- Everything validated on Earth; nothing in astronauts. It is not a medical device.
- No access to LSAH/LSDA. Phase 2 is a design.
- The anatomical overlay of the AR scanner is generic, not the patient's; it is not diagnostic.
- Vision: the evidence with a phone camera is moderate; the good pupil figures use infrared. The only MRD2 study in astronauts is listed as retracted.
- No verified evidence of rPPG in astronauts.

## 9. Pending items
- Retraction notice for the astronaut study (Wiley or Retraction Watch).
- Full text of Lee 2020 and Mader 2011 (institutional access): settle the SANS prevalence.
- Abstract of Buller 2013 and text of Welles 2018.
- Source papers for the 11.7 mm iris; digital Amsler papers; PMC10108649 (PERCLOS with webcam); Annals of Medicine 2021 (MRD).
- Confirm the iris in the Face Landmarker model card; model licenses.
- Licenses of PAPILA, ORIGA, REFUGE and G1020; WESAD on the Siegen page.
- Measure real CPU/edge performance (PaPaGei, time series models).
- Primary studies on the SANS mechanism (Marshall-Goebel 2019, Laurie 2020, Lawley 2017).
- Origin of the ~50 mL figure and the 1991 study, if they exist.
- Data from LunAres, Mars-500, HI-SEAS and SIRIUS by name on Zenodo, PhysioNet and OSDR.

## 10. Sources with direct links
The links come from the verifications. Those marked ⚠ could not be opened or have a discrepancy.

### Computer vision
- MediaPipe Face Landmarker: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
- Google blog, iris and depth: https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation
- Attention Mesh: https://arxiv.org/abs/2006.10962
- Real-time pupil: https://arxiv.org/abs/2006.11341
- Soukupová and Čech 2016 (EAR): search for "Real-Time Eye Blink Detection using Facial Landmarks", CVWW 2016
- PERCLOS, NHTSA DOT HS 808 762 (1998): search for the report by number
- Phone pupillometry, Solyman et al. 2022 (Clin Ophthalmol, Dovepress): search for the title on Dovepress
- MRD with iPhone, Chen et al. 2021: https://pmc.ncbi.nlm.nih.gov/articles/PMC8538024/
- Peek Acuity, JAMA Ophthalmol 2015: https://pubmed.ncbi.nlm.nih.gov/26022921/
- rPPG-Toolbox: https://arxiv.org/abs/2210.00716

### Ocular and SANS
- Mader 2011: https://pubmed.ncbi.nlm.nih.gov/21849212/
- Lee 2020 (npj Microgravity): https://pmc.ncbi.nlm.nih.gov/articles/PMC7005826/
- NASA HRP, SANS risk: https://humanresearchroadmap.nasa.gov/Risks/risk.aspx?i=105
- Brunstetter 2025: https://pubmed.ncbi.nlm.nih.gov/41066117/
- Rodrigues 2025 (mechanism): https://pubmed.ncbi.nlm.nih.gov/40456790/
- Martin Paez 2020: https://pubmed.ncbi.nlm.nih.gov/33117025/
- Mampre 2025: https://pubmed.ncbi.nlm.nih.gov/40643392/
- Nguyen 2025 (countermeasures): https://pubmed.ncbi.nlm.nih.gov/39971096/
- Meer 2025 (72 studies): https://pubmed.ncbi.nlm.nih.gov/40890229/
- BONSAI, NEJM 2020: https://pubmed.ncbi.nlm.nih.gov/32286748/
- FOTO-ED, 2024: https://pubmed.ncbi.nlm.nih.gov/37926337/
- Gungor 2026 (⚠ title only): https://pubmed.ncbi.nlm.nih.gov/40867029/
- Astronaut study, MRD2 (⚠ RETRACTED according to the page): https://journal.hep.com.cn/eer/EN/10.1002/eer3.70043
- REFUGE: https://refuge.grand-challenge.org/Details/
- G1020: https://arxiv.org/abs/2006.09158
- PAPILA: https://doi.org/10.1038/s41597-022-01388-1
- Glaucoma dataset catalog: https://github.com/TheBeastCoding/glaucoma-dataset-metadata

### Models and soft sensors
- PaPaGei: https://arxiv.org/abs/2410.20542 · code: https://github.com/Nokia-Bell-Labs/papagei-foundation-model · weights (no license declared): https://zenodo.org/records/13983110
- Pulse-PPG: https://arxiv.org/abs/2502.01108
- PPG-Distill: https://arxiv.org/abs/2509.19215
- Distillation for pulse estimation: https://arxiv.org/abs/2511.18829
- UNIPHY+: https://arxiv.org/abs/2509.16348
- NBPDB: https://arxiv.org/abs/2602.04725
- Stress: https://arxiv.org/abs/2405.09563
- Health-LLM: https://arxiv.org/abs/2401.06866 · PH-LLM: https://arxiv.org/abs/2406.06474 · HealthSLM-Bench: https://arxiv.org/abs/2509.07260
- SensorLM: https://arxiv.org/abs/2506.09108 · MIRA: https://arxiv.org/abs/2506.07584 · SOTER: https://arxiv.org/abs/2609.16804 · Zero-shot HRV: https://arxiv.org/abs/2607.20027 · PPG benchmark: https://arxiv.org/abs/2510.14254 · https://arxiv.org/abs/2412.03427
- Chronos: https://github.com/amazon-science/chronos-forecasting · MOMENT: https://github.com/moment-timeseries-foundation-model/moment (arXiv 2402.03885) · TimesFM: https://github.com/google-research/timesfm
- Buller 2013: https://doi.org/10.1088/0967-3334/34/7/781 · USARIEM: https://usariem.health.mil/index.cfm/research/products/cbt_algorithm
- Welles 2018: https://pubmed.ncbi.nlm.nih.gov/29803944/
- Waterloo/CSA (press release): https://www.eurekalert.org/news-releases/649440
- Thermolab (DLR 2009): https://www.dlr.de/en/latest/news/2009/20091015_from-charit-into-space-thermolab-experiment-starts-on-the-iss_20458/@@download/file
- Double Sensor (Physiological Society): https://www.physoc.org/abstracts/core-body-temperature-changes-under-different-physical-and-environmental-conditions-on-earth-and-in-space/
- ESA, circadian rhythm: https://www.esa.int/Our_Activities/Human_Spaceflight/Research/Keeping_the_rhythm_in_space · IAC-18: https://iafastro.directory/iac/archive/browse/IAC-18/A1/2/43234/

### Data
- BIDMC: https://physionet.org/content/bidmc/1.0.0/ · MMASH: https://physionet.org/content/mmash/1.0.0/ · PPG-DaLiA: https://archive.ics.uci.edu/dataset/495/ppg+dalia · WESAD: https://archive.ics.uci.edu/dataset/465/wesad
- LifeSnaps: https://zenodo.org/records/6826682 · paper: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9622868/
- MIMIC-III waveform matched: https://www.physionet.org/content/mimic3wdb-matched/1.0/p03 · Sleep-EDF: https://physionet.org/content/sleep-edfx/
- NASA LSDA/LSAH: https://lsda.jsc.nasa.gov/explore/lsdahome/datarequest
- OSDR: https://science.data.nasa.gov/features-events/osdr-spotlight · Sanders et al. 2024: https://doi.org/10.1038/s41526-024-00393-5
- Bed rest, Solbiati and Caiani 2025: https://doi.org/10.1038/s41526-025-00509-5 · ESA Bedrest Core Data: https://explorationscience.esa.int/?p=889
- LunAres (⚠ 404): https://simonbouriat.github.io/files/Bouriat_2021_physiological_inventory_data_lunares.pdf
- NASA DAP (digital twin): https://ntrs.nasa.gov/citations/20170007202

## 11. AR scanner verification (14 Nov 2026)
Source: `Antecedentes/NOVA-arquitectura.pdf` (13 Nov), reviewed with `pdftotext`, and BodyParts3D v4.0 (official DBCLS download).

| Question | Result | Status |
|---|---|---|
| Do the 689 structures include the eye? | The PDF: "689 structures, BodyParts3D and HuBMAP (CC BY 4.0). Full skeleton and organs animated by the twin". It does not mention the eye anywhere. The `partof_parts_list_e.txt` list from BodyParts3D v4.0 contains eyeball, iris, cornea, lens, sclera, choroid, vitreous body, upper and lower eyelids, orbit and the extraocular muscles (recti, obliques, levator palpebrae). It **does not contain** "retina" or "optic nerve". What went into the 689 cannot be known without the `nova-pc` data. | [P] |
| BodyParts3D license | The PDF says CC BY 4.0. The BodyParts3D README says "Creative Commons Attribution-Share Alike 2.1 Japan" (CC BY-SA, with share-alike). To be reviewed. | [V] discrepancy |
| Rear or front camera? | The PDF does not specify it. It says: the phone sends 512 px JPEGs, draws the fitted anatomy, predicts movement with the gyroscope (0.7 Hz filter and maximum prediction of 60 ms); with no response within 2.5 s it uses its own vision; the server returns 33 pose points, 21 per hand and a patient mask; "patient = the most horizontal torso in view". That the body uses the rear camera was my own assumption. | [V] not specified |
| Is a 512 px photo enough? | Own estimate with assumptions (face ≈ 60 % of the width; distance between eyes ≈ 45 % of the face width; iris 11.7 mm over ~63 mm between pupils): distance between eyes ≈ 138 px, iris ≈ 26 px, pupil ≈ 8 px; 1 px ≈ 0.46 mm. The 0.37 mm MRD2 error (Chen 2021) is less than 1 px. The EAR detector "fails with IOD under 20 px" (Soukupová and Čech): at ~138 px that is not the limit. Pupil and MRD2 will need higher resolution or processing on the phone. | [INF] |
| Latency through `/v1/vision/ws`? | The PDF: MediaPipe Pose + Hands on the GPU, "about 15 ms per frame". `/v1/vision/ws` is listed as a local WebSocket of the vision bridge on the computer, not as the phone link. The latency of the eye module cannot be measured without `nova-pc`; the spike measures only local Face Landmarker (the CPU smoke test gave 1.56 ms median on a black frame; the real measurement with a face is pending). | [P] |
| Is there an eye injury protocol? | No. The 12 protocols in the PDF: cardiac arrest, fainting (syncope), hypoglycemia, low oxygen, high cabin CO2, anaphylaxis, choking, fever, seizure, decompression, sleep and mood, hemorrhage. Ten have AR steps (the PDF does not say which). None of the 5 PDFs in `Antecedentes/` mentions the eye, except for a note about an LED on the board. | [V] |

## 12. Model used: MediaPipe Face Landmarker (technical sheet)
Sources: file `models/face_landmarker.task` inspected locally [V measured]; official Google AI Edge page (`developers.google.com/edge/mediapipe/solutions/vision/face_landmarker`) [V]; Google model cards, read with `pdftotext` [V].

### What the file is
A package (`.task`, zip format) of 3,758,596 bytes, sha256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`, downloaded from `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`. It contains [V measured]:

| Internal file | Size | Function |
|---|---|---|
| `face_detector.tflite` | 229,746 B | Face detector (BlazeFace, short range) |
| `face_landmarks_detector.tflite` | 2,553,590 B | 3D face landmark model (FaceLandmarker-V2) |
| `face_blendshapes.tflite` | 955,312 B | Model for 52 expression scores |
| `geometry_pipeline_metadata_landmarks.binarypb` | 19,376 B | Geometry metadata (4x4 transformation matrix) |

### Specifications
| Model | Detail | Source |
|---|---|---|
| Detector (BlazeFace short range) | SSD-type convolutional network with its own encoder; 224 KB; "~275 FPS on a single Pixel 2 CPU core with XNNPACK"; Apache 2.0; input 128x128 according to its card, 192x192 according to the task page (discrepancy between sources); returns a box and 6 keypoints | [V] card and page |
| Landmarks (FaceLandmarker-V2) | Convolutional network "MobileNetV2-like with customized blocks"; input: face cropped with a 25 % margin and scaled to 256x256; output: 478 flattened 3D points (x, y in image pixels; z relative to the face's center of mass and scaled to its width), a face presence flag (threshold 0.5 by default) and a subset of blendshapes; Apache 2.0 license; authors Geng Yan and Ivan Grishchenko (Google); date 15 Sep 2022 | [V] card |
| Blendshapes | Input 1x146x2, output 52 scores; float16 data in the package | [V] page (its card was not read) |
| Task output | 478 3D points, 52 blendshapes (optional), 4x4 transformation matrix (optional) | [V] page |
| Iris | The page and the card say "478 points" without naming the iris. That indices 468-477 are the iris was confirmed by measurement (spike of 14 Nov). | [V] measured |
| Relation to the papers | Attention Mesh (arXiv 2006.10962) and real-time pupil (arXiv 2006.11341) exist; that FaceLandmarker-V2 is exactly that architecture is not stated. | [NV] |

### Intended use and limits (FaceLandmarker-V2 card)
- **Intended use:** facial landmark detection in monocular video, "optimized for videos captured on front-facing phone cameras"; main application: entertainment augmented reality.
- **Out of scope:** "not intended for life-critical decisions". NOVA respects this by issuing only a "follow-up alert" and not diagnosing.
- **Input:** the video must be captured in selfie mode. It is not suitable with the face turned more than 80°, tilted more than 8° from vertical, less than 50 % visible, or too far away. Tolerance: 10 % shift and scale, 8° of roll. The image must be rotated so that a horizontal line joins the centers of the eyes.
- **Environment:** with low light, noise, motion or a partially covered face, quality drops and "jitter" (frame-to-frame noise) increases.
- **Training data:** images from various phone cameras, front and rear, in real environments, via an AR application. Dataset size: not stated.

### Accuracy (card)
- Metric: mean absolute error normalized by interocular distance (IOD MAE).
- Tracking mode: from **2.06 % to 3.27 %** across 17 geographic subregions (1,700 images, 100 per region); reacquisition mode (first frame): from 2.67 % to 3.85 %.
- Human reference: 2.56 % IOD MAE of disagreement among 11 annotators on 58 samples.
- By skin tone (Fitzpatrick 1 to 6): tracking 2.49 % to 2.90 %; reacquisition 3.09 % to 3.75 %. By gender: 2.61 % and 2.62 %.
- **It does not evaluate** eye color, use of glasses or eyelid position.

### Implications for NOVA
- [INF] With ~81 px between the eyes (measured at 512 px on Niko's webcam, section 14; the earlier estimate of 138 px was high), 2.6 % ≈ 2.1 px ≈ 1.6 mm assuming 63 mm between pupils. This is a bound for the mean error of the whole mesh, not for the eyelids, but it exceeds the 0.37 mm MRD2 of Chen 2021 (which used another method, deep learning). Design conclusion: use each person's changes against their baseline and measure jitter, not absolute millimeters.
- The card calls for selfie mode. The rear camera on another person (supervised mode) is less covered: test and record performance per camera.
- A free-floating head in microgravity can exceed the 8° tilt limit: test with the head tilted.
- Pupil and dark eye color are not evaluated in the card.

### Installation used
Python 3.13.12, mediapipe 1.2.3, opencv-python 5.0.0.93, numpy 2.5.4. MediaPipe Tasks CPU delegate with XNNPACK, VIDEO mode, `num_faces=1`. Measured on Niko's webcam (14 Nov): 478 points, iris present, detection 90 of 90, latency 7.76 ms median and 8.97 ms p95.

### Links
- Task page: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
- FaceLandmarker-V2 card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf
- BlazeFace short range card: https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf
- Blendshape V2 card (not read): https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf
- Model package: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task

## 13. Result of the 512 px test (14 Nov 2026)
Measured with Niko's webcam, 90 frames, good light, face at normal distance. Simulated path: downscale to 512 px width with INTER_AREA, encode and decode JPEG quality 80 (**the scanner's real quality is unknown: assumption**), infer. Details and table in `docs/spike-resultados.md`.

| Metric | Full | 512 px |
|---|---|---|
| Face detection | 90/90 | 90/90 |
| Iris OK (10 points) | 90/90 | 90/90 |
| Iris diameter, median | 21.2 px | 17.0 px |
| Iris center jitter, median | 7.97 px | 6.35 px |
| Inference latency, median / p95 | 8.09 / 8.63 ms | 7.70 / 8.19 ms |

**Reading** [V measured, except where marked]:
- Detection and iris presence hold at 512 px in this case: one person, good light, face close and frontal.
- The iris measures 17 px at 512 px. The earlier estimate of 26 px (section 11) was high because the face took up less of the frame. [INF] With a 17 px iris and an 11.7 mm iris (value from the Google blog, with no source paper), 1 px ≈ 0.69 mm and a 2 to 4 mm pupil would measure 3 to 6 px: it cannot be measured with landmark points at that size. The pupil requires a larger image or processing on the phone.

**Caveats about the test itself:**
- **The jitter is contaminated by real head movement.** It is defined as the standard deviation of the iris center position over 30 frames, so it includes how much the person moved. 6 to 8 px is not model noise. It has to be repeated with the head still, or the metric has to change (for example the variation of the iris diameter, or the position of the center relative to the eye corners).
- [INF] The ratio between the diameters (17.0 / 21.2 ≈ 0.80) suggests that the webcam delivers 640 px width, that is, the "full resolution" of this test is 640x480 and not a high-resolution camera. The frame resolution is not printed; it needs to be logged.
- It does not cover glasses, low light, tilted head, brown eyes or the rear camera.
- The latency is inference only, without downscaling or JPEG.

## 14. Spike v2 condition sweep (14 Nov 2026)
Measured with Niko's webcam (front, desk light, no glasses, ~50 cm, subject S01), 240 frames captured once and processed under the same conditions, in IMAGE and VIDEO modes. Full tables in `docs/spike-resultados.md` ("Check v2 with sweep").

**Log** [V measured]: 640x480 frame (the webcam's full resolution is 640x480, which confirms the suspicion in section 13), 30 fps, MSMF backend, mediapipe 1.2.3, model with sha256 `64184e22...c9ff`.

| Item | IMAGE | VIDEO |
|---|---|---|
| Detection and iris OK, across the 31 conditions | 100 % | 100 % |
| Distance between eyes / iris diameter at 512 px | 80.6 / 15.2 px | 82.7 / 15.7 px |
| Distance between eyes / iris at native 640 px | ~101 / 19.0 px | ~103 / 19.7 px |
| Distance between eyes / iris at 256 px | ~41 / 7.6 px | ~41 / 7.7 px |
| Latency at 512 px q80 (median / p95, with downscaling and JPEG) | 10.96 / 12.36 ms | 9.64 / 10.93 ms |
| Latency with roll compensated (double inference) | ~22 to 24 ms | ~19 to 21 ms |

**High-frequency noise** (σ_hf, ×1e-3, average of both eyes, reference 512 px q80). It measures frame-to-frame variation and is not contaminated by slow movement:

| Metric | IMAGE (each photo independent, as in the scanner) | VIDEO (temporal smoothing) |
|---|---|---|
| EAR | 6.95 | 2.92 |
| Opening A (in iris diameters) | 18.13 | 6.82 |
| MRD2n (proxy) | 9.24 | 3.91 |

[INF] With an 11.7 mm iris: σ_hf of A ≈ 0.21 mm per photo in IMAGE and ≈ 0.08 mm in VIDEO. IMAGE mode has about 2.4 times more noise than VIDEO, and it is the one that corresponds to single photos.

**Robustness:** detection and iris did not drop under any condition, even at 256 px, JPEG q50, simulated low light, noise σ=10, blur σ=2 and uncompensated 45° roll. The noise of A rose only moderately (256 px: 17 to 25; low light: 23.7; noise σ=10: 20.3, versus 18.1 for the reference). This holds for one person, frontal and in good light.

**Procrustes residual** (RMS, % of IOD, reference 512 px q80, IMAGE / VIDEO): iris 2.39 / 2.79, eyelids 2.47 / 3.06, mesh 2.86 / 2.84. It is in the same range as the mean error on the card (2.06 % to 3.27 %), although it is not the same metric.

**Problem found: the stillness gate passed 0 % of the frames** in the reference (12 to 13 % in a few conditions), in IMAGE and VIDEO. The acceptance criterion (≥ 80 %) is NOT met. Consequence: all MDCs come out with an asterisk, that is, computed without the gate and including head movement and blinks. The MDC value of A (~0.17 iris diameters, ~2 mm [INF]) is an upper bound that cannot be used. Which criterion fails (speed, roll, IOD, yaw/pitch or missing transformation matrix) is unknown; it is being diagnosed with a `--gate-diagnose` mode.

**Correction:** the estimate in section 11 (distance between eyes ~138 px at 512 px) was high; the measured value is ~81 px. The 1.6 mm bound on landmark error (2.6 % of IOD) does not change, but it corresponds to ~2.1 px and not 3.6 px.

**Noise floor:** the first attempt failed because `!` has no interactive keyboard (`input()` returned EOF). Fixed with `--start-delay` and beeps at the start and end of each block (commit `96e3282`). On hold until the gate is fixed, because it uses only frames that pass the gate.

## 15. Stillness gate diagnosis (14 Nov 2026, 15:56)
Measured with `--gate-diagnose` on Niko's webcam: 150 frames at 30.6 FPS, 120 windows of 1 s, 512 px q80 path, VIDEO mode, person still and looking straight ahead. Details in `docs/spike-resultados.md`.

| Criterion | Threshold | Median | p95 | Max |
|---|---|---|---|---|
| Speed (median, % of IOD per frame) | < 0.5 | 0.124 | 0.272 | 0.272 |
| Roll range (°) | < 2 | 0.30 | 0.44 | 0.57 |
| IOD range (%) | < 2 | 0.93 | 1.23 | 1.61 |
| Yaw range (°) | < 3 | 0.42 | 0.54 | 0.61 |
| Pitch range (°) | < 3 | 0.38 | 0.56 | 1.06 |
| Face loss | 0 | 0 | 0 | 0 |

- The 4x4 transformation matrix arrived in 100 % of the frames [V measured].
- With the original thresholds, **100 % of the windows pass the gate** when the person is still. No recalibration is needed. The "suggested" thresholds (observed p80) are circular and must not be used.
- **The cause of the 0 % in the earlier sweep has not been determined.** Candidates: (a) the sweep started capturing as soon as the command was launched, with no countdown, so the person was probably still moving; (b) the yaw and pitch range did not wrap around ±180° (fixed); (c) speed was being computed twice (fixed; but the corrected median is 0.124, or 0.25 with the old calculation, below 0.5, so on its own it would not explain the 0 %).
- Actions: countdown and beeps in the sweep (done), live view with a wait for stillness (in progress) and repeat the sweep.

### 15.1 Two runs with the live view (16:10 and 16:11)
| | Run 1 | Run 2 |
|---|---|---|
| Wait for stillness before recording | achieved after 2.0 s | achieved after 1.6 s |
| Windows that pass all criteria | **37.2 %** (45 of 121) | **100 %** (120 of 120) |
| Face detection / iris OK | 99.3 % / 99.3 % | 100 % / 100 % |
| IOD range, median / max | 2.12 % / 82.62 % | 0.78 % / 1.55 % |
| Yaw range, median / max | 1.27° / 55.88° | 0.41° / 0.87° |
| Speed, median / max (% of IOD per frame) | 0.426 / 6.341 | 0.115 / 0.308 |
| Measured FPS | 30.1 | 30.6 |

- The wait for stillness worked in both runs, but **in run 1 the person moved during the recording** (the distance between the eyes varied by as much as 82 % and the yaw by 56°, which is impossible from model noise). Run 2, still, passed 100 %.
- Conclusion [V measured, one person]: the gate distinguishes in both directions between a still capture and one with movement. The original thresholds work; the ones "suggested" by run 1 (p80: IOD < 48 %, yaw < 42°) would be absurd and must not be used.
- Next improvement: automatic retry of the capture when the recorded stillness is below 80 %.
- The FPS with the view active (30.1 and 30.6) did not drop compared with the run without the view (30.6).

## 16. Sweep v2 with corrected gate (14 Nov 2026, 16:22)
Niko's webcam, 640x480, 30 fps, 240 frames, stillness during capture 100 % (1 attempt). Full tables in `docs/spike-resultados.md`.

**Acceptance** [V measured]: detection and iris 100 % across the 31 conditions and in both modes. Gate at the 512 px q80 reference: 84.6 % (IMAGE) and 100 % (VIDEO), meets ≥ 80 %. Only `dim` (simulated low light, IMAGE) drops to 70 %.

**Reference 512 px q80, with gate (person S01):**
| Metric | IMAGE (single photos) | VIDEO |
|---|---|---|
| σ_hf of A (×1e-3 iris diam.) | 12.96 | 1.21 |
| MDC95 of A (×1e-3 iris diam.) | 28.35 | 20.54 |
| MDC95 of A in mm [INF, iris 11.7 mm] | 0.33 | 0.24 |
| MDC95 of MRD2n (×1e-3) | 12.30 | 8.08 |
| Procrustes residual iris / eyelids / mesh (% IOD) | 0.33 / 0.72 / 0.72 (iris/eyel./mesh: 0.33, 0.72, 0.78) | 0.24 / 0.41 / 0.36 |

**Reading:**
- The eyelid opening is measurable with a minimal detectable change on the order of 0.3 mm [INF] **within one session, for one person, still**. It does not include repositioning: that is measured by the noise floor (3 sessions), pending.
- The frame-to-frame noise in VIDEO is much lower because of temporal smoothing; IMAGE mode is the one that represents single photos.
- The degradation is moderate: at 256 px the MDC of A in IMAGE goes down from 28 to ~10 (sampling variation, 8 blocks of 1 s: rough bound); with uncompensated 45° roll the bias of A is +83e-3 versus +32e-3 compensated, so counter-rotation improves the bias at the cost of double latency (~20 ms).
- The paired biases between conditions (up to ±47e-3 in A) show that changing resolution, blur or rotation **shifts** the measurement: the baseline must be taken with the same image path as the later measurement.
- Limit: one person, good light, 8 blocks of 1 s per condition.

## 17. Noise floor with repositioning (14 Nov 2026, 17:39)
Niko's webcam, 640x480, 30 fps, 512 px q80 path, VIDEO mode, subject S01, looking at a red dot near the camera. **Sessions 2, 3 and 4** (3 blocks of 20 s each; session 1 was excluded because the subject did not blink). Report: `--noise-floor-report --exclude-sessions 1`. Full table in `docs/spike-resultados.md`.

| Metric | Eye | σ_w | σ_b | Within-session MDC95 | MDC95 with repositioning | in mm [INF] |
|---|---|---|---|---|---|---|
| EAR | R / L | 0.023 / 0.024 | 0.012 / 0.010 | 0.065 / 0.065 | 0.073 / 0.071 | - |
| Opening A (iris diam.) | R / L | 0.061 / 0.052 | 0.029 / 0.020 | 0.170 / 0.144 | 0.188 / 0.154 | 2.2 / 1.8 |
| MRD2n proxy | R / L | 0.035 / 0.026 | 0.026 / 0.023 | 0.098 / 0.071 | 0.121 / 0.095 | 1.4 / 1.1 |
| MRD1n proxy | R / L | 0.029 / 0.025 | 0.010 / 0.004 | 0.081 / 0.069 | 0.086 / 0.070 | 1.0 / 0.8 |
| D/IOD | - | 0.0032 | 0.0031 | 0.0087 | 0.0123 | - |

**Reading** [V measured, one person, 3 sessions]:
- **The realistic minimal detectable change of the eyelid opening is ~1.8 to 2.2 mm [INF]**, not ~0.33 mm. The value in section 16 came from 8 s of stillness in a single session, without blinks or gaze drift, and was too optimistic. This one includes 60 s per session with normal blinking.
- **Repositioning adds little:** σ_b is lower than σ_w in almost all metrics, and the MDC rises ~10 % (for example right A from 0.170 to 0.188). What dominates is within-session noise.
- **MRD1n and MRD2n are more stable than A** (MDC with repositioning ~0.8 to 1.4 mm [INF]).
- **Right and left eye differ** (A: 2.2 vs 1.8 mm), which is expected with a single person and an off-center camera.

**Limits** (important):
- **Only 3 sessions:** σ_b is estimated with ddof=1 over 3 means; it is very imprecise.
- **Session 2 was recorded with the previous stillness filter** (stricter with blinking); sessions 3 and 4, with the new one.
- **It is the MDC of a 1 s average.** Averaging over a longer time lowers it, but VIDEO mode autocorrelates the frames: you cannot divide by the square root of N.
- **The blinks per block (7 to 15 in 20 s) are more than typical**; it is unknown whether the detector overcounts.
- The mm values assume an 11.7 mm iris. There is no ground truth: accuracy in mm cannot be claimed.
- One person, good light, 640x480; it is not the scanner or microgravity.

## 18. Is a minimal change of ~1 to 2 mm enough? Clinical evidence (14 Nov 2026)
Sources: abstracts via Europe PMC REST (the full texts on PubMed, PMC and Wiley were blocked). Medium-low certainty.

**Normal values** (adults, standing):
| Item | Value | Source | Status |
|---|---|---|---|
| MRD1 / MRD2 / palpebral fissure | 2.97 mm (95% CI 2.70-3.24) / 5.57 (5.33-5.81) / 8.54 (8.19-8.90) | Wier et al., Ophthalmic Plast Reconstr Surg 2024;40(6):623-6, PMID 38534066 (43 patients, 86 eyes) | [V] CI only, no SD |
| MRD2 in 13 astronauts, on Earth | 4.9 ± 0.7 mm | Ax et al. 2026 (retracted, see below) | [V] with caveat |
| MRD1 with iPhone vs ruler (ptosis) | bias -0.04 mm, limits of agreement -0.51 to 0.43 mm, ICC 0.968 | Tang et al., Medicine 2026;105(21), PMID 42175441 | [V] population with ptosis |
| Inter-examiner repeatability | ICC 0.913 to 0.980 across 11 features including MRD1, MRD2 and fissure | Chun et al., Acta Ophthalmol 2017;95:e625, PMID 28391655 | [P] |
Norms with standard deviation for MRD2 and fissure, Boboridis 2001 and Bodnar: [NV].

**Changes with microgravity and posture** [V, abstracts]:
| Condition | Change | Source |
|---|---|---|
| Parabolic flight (microgravity) | **MRD2 −0.9 mm (p<0.001)**; MRD1 unchanged (p=0.41); pupil to lower brow distance +2.3 mm | Ax et al., Orbit 2025;44(5):535-543, PMID 40265683 |
| Hypergravity (same study) | MRD1 −0.7 mm | ibid. |
| Astronauts, NASA photos | **MRD1 with no significant change (p=0.21)**; pupil-to-brow distance +3.7 mm | Karlin et al., Ophthalmic Plast Reconstr Surg 2021;37(6):592-4, PMID 33710037 |
| Lying down vs standing (not head-down) | MRD1 −0.59 mm; MRD2 −0.56 mm; fissure −1.16 mm | Wier 2024 (differences calculated from the means) |
- The same change in posture moves MRD1 and MRD2 in different directions: lying down lowers the eyelid, microgravity raises the lower one.
- Fatigue, sleep, time of day and eyelid edema (allergic or thyroid) **in mm: no data found** [NV].
- **MCID, MDC or validated clinical threshold for MRD1, MRD2 or opening: none was found** [NV]. In thyroid eye disease an opening response of ≥2 mm was used (Rymuza et al., Thyroid 2026, PMID 42117357), which is a study criterion and not an MCID. Thresholds for ptosis, retraction and edema in mm: [NV]; verify in BCSC or StatPearls (NBK539828).

**MRD2 in astronauts and the retraction:**
- There is partial independent corroboration in parabolic flight (Ax 2025, −0.9 mm). In actual orbit, for MRD2, only Ax 2026 exists (4.9 → 3.9 mm).
- Ax 2026: the journal page says "This article has been retracted" (note: "updated to reflect reception of statements of disagreement from all authors"), with no date or reason. **Crossref shows no retraction** (empty `relation`, no `updated-by`). Unresolved conflict; the actual notice has to be opened in a browser. Do not cite Ax 2026 as evidence until then.

**What could and could not be detected with the measured MDC** [INF, ~1-2 mm]:
| Change | Detectable in one person? |
|---|---|
| Moderate or severe ptosis, clear thyroid retraction | Yes |
| Opening response ≥2 mm (TED) | Borderline |
| MRD2 −0.9 to −1.0 mm (microgravity) | Borderline; probably only by averaging several measurements or at group level |
| MRD1 in microgravity | No documented change: there is no signal to detect |
| Lying down vs standing (−0.6 mm) | No |
| Fatigue, time of day, mild edema | No data in mm: cannot be claimed |
- **Correction to what was said before:** MRD1 is the most stable measurement (MDC ~0.8-1.0 mm) but **does not change in microgravity**, so its stability does not help detect swelling. MRD2 does change (~1 mm) but its MDC (~1.1-1.4 mm) is borderline. The natural candidate is MRD2 with several measurements per session, compared with the individual baseline.
- The population SD of MRD2 (~0.7 mm [INF]) is of the same order as the MDC: comparing with a population norm does not work, only against each person's baseline.

## 19. Synthesis: which detectors can be supported (14 Nov 2026)
Sources: three reviews with Europe PMC (abstracts; full texts blocked). Medium-low certainty. The numbers in the detector table combine what was measured in our spike with those reviews.

### 19.1 Drowsiness (PERCLOS and blinking)
- [V, abstract] PERCLOS P80 (% of time with the eye more than 80 % closed) is associated with drowsiness from sleep deprivation and from circadian rhythm in the laboratory with dedicated equipment (Abe, Sleep Advances 2023, PMID 37193281; Ftouni, J Biol Rhythms 2013 and J Clin Sleep Med 2015). The definition varies between studies (80 %, 70 %, 25-30 % opening).
- [V, abstract] Meta-analysis of 61 studies (1,441 participants): slope of PERCLOS-80 against driving impairment 0.02 (CI 0.01-0.04), low GRADE certainty (Davin, Sleep Med Rev 2026, DOI 10.1016/j.smrv.2026.102380). "No single index is currently available as an optimal marker" (Abe 2023).
- [V, abstract] At 30 fps blink dynamics are lost: peak velocities underestimated below 250 fps; amplitude and total duration, acceptable (Navascues-Cornago, Ocul Surf 2026, DOI 10.1016/j.jtos.2026.01.003).
- [NV] Sensitivity and specificity of PERCLOS with webcam/EAR; correlations from Dinges 1998 (the original PDF could not be read; the r = 0.875 in earlier sections comes from a summary); any blink or PERCLOS data in space or isolation.
- Defensible wording: "supporting indicator, compared with the individual baseline", not "drowsiness detector".

### 19.2 Visual fatigue and dry eye (blinking)
- [V] Blinking with a screen: 11.6/min (SD 7.8; n=21; Portello 2013, DOI 10.1111/opo.12013 [NV the exact DOI]) and 14.9/min on screen versus 13.6/min on paper (Chu 2014, DOI 10.1097/opx.0000000000000157). Rest ~17/min, reading 4-5/min, conversation ~26/min [P, secondary citation via Brych 2021, DOI 10.1371/journal.pone.0258322].
- [V] Incomplete blinks on screen: 16.1 % (Portello 2013) and 7.0 % (Chu 2014). The two studies disagree on whether they relate to symptoms (n=21 and n=25).
- [V] The rate drops with cognitive load and not only with screens (Chu 2014; Bend, J Eye Mov Res 2026, DOI 10.3390/jemr19020028).
- [P] With a webcam, an exploratory study (n=13, 4 to 30 fps) found that the symptom score dropped 1.26 for each additional blink (Lapa, IJERPH 2023, DOI 10.3390/ijerph20054569). BlinkNet-Q (Xu, Transl Vis Sci Technol 2026, DOI 10.1167/tvst.15.9.4): ICC 0.973 for the rate, ICC 0.937 and AUC 0.884 for incomplete blinks; proof of concept under standardized conditions.
- [V] TFOS DEWS II: dry eye diagnosis requires a questionnaire (OSDI/DEQ-5) plus ocular surface tests; blinking is not a diagnostic test. A 2026 review (Ong, Eye) concludes that blink metrics with apps or webcams have "insufficient validation".
- [V] Astronauts: post-flight ocular symptoms in 257 astronauts: irritation 34 %, foreign body 21 %, dry eye 14 % (self-report; Ong, Life Sci Space Res 2025, DOI 10.1016/j.lssr.2025.05.005). In-flight blinking had not been studied until 2023 (Ax, Front Physiol 2023, DOI 10.3389/fphys.2023.1281327).
- [INF] At 30 fps a closing phase of ~100 ms is ~3 frames: partial amplitude is heavily undersampled. It is better to report a minimum opening index with uncertainty than a diagnostic "% incomplete".
- Defensible wording: "risk signal for dryness or visual fatigue, compared with the individual baseline; it does not diagnose".

### 19.3 Eyelid swelling as a trend
- [V] Pupil-to-brow distance (PTB): +3.7 mm in 18 astronauts, 112 photos (Karlin 2021, PMID 33710037) and +2.3 mm in parabolic flight (Ax, Orbit 2025, PMID 40265683). MRD1 does not change in either. In parabolic flight MRD2 drops (−0.9 mm [P: the abstract obtained was truncated]).
- [V] Lying down versus standing: MRD1 2.97 to 2.38 mm, MRD2 5.57 to 5.01 mm, fissure 8.54 to 7.38 mm (Wier 2024, PMID 38534066).
- [V] Automatic landmarks: mean absolute difference of 0.5 mm in MRD1 and MRD2 versus humans and 1.5 to 2 mm in brow height (Van Brummen, PeriorbitAI, Am J Ophthalmol 2021, PMID 34010596); ICC > 0.90 (Rana 2025, PMID 38710195).
- [V] Fissure asymmetry ≥ 1 mm in ~6 % of healthy people (Lam 1995, PMID 7573311) and in ~25 % (Song 2007, PMID 17293281): 1 mm of asymmetry is common and does not work as an absolute alarm.
- [NV] mm of change from allergic, thyroid or sleep-related edema; between-day repeatability of MRD; effect of salt or alcohol; norm for the right-left MRD difference; application of CUSUM or EWMA to eyelid measurements.
- [INF] Number of measurements to detect 1 mm against a known baseline, with α=0.05 and 80 % power: ~8 with 1 mm noise and ~31 with 2 mm; double if the baseline is also estimated. They must come from separate sessions, not consecutive frames.
- Defensible wording: "NOVA measures and tracks the trend of eyelid and brow position; it does not detect edema".

### 19.4 Detector table
| Detector | Supporting metric | Evidence | Is our noise (~1 to 2 mm) good enough? | What is missing |
|---|---|---|---|---|
| Drowsiness (support) | Approx. PERCLOS, total blink duration | Laboratory, dedicated equipment; low certainty in driving | Yes (it is a proportion of time, not mm) | Per-person threshold; pilot against KSS and PVT |
| Visual fatigue and dry eye (risk) | Blink rate, minimum opening index | Small and contradictory associations | Yes (it is a count) | Validate the count; 30 fps limits incomplete blinks |
| Pupil-to-brow distance | PTB | The largest signal in microgravity (+2 to +4 mm) | Yes, larger than the noise, but the brow has 1.5 to 2 mm of error | Measure the brow in the spike |
| Lower eyelid (MRD2) | MRD2 | −0.9 mm parabolic, −0.56 mm lying down | Borderline (MDC 1.1-1.4 mm) | Several measurements per session; baseline |
| Upper eyelid (MRD1) | MRD1 | No change in microgravity; −0.6 mm lying down, −0.7 mm in hypergravity | MDC 0.8-1.0 mm | Useful for ptosis or retraction, not for swelling in orbit |
| Asymmetry between eyes | A, MRD1, MRD2 (right minus left) | 1 mm asymmetry common in healthy people | Only changes vs one's own baseline | Asymmetry norm |
| Stress and emotion | Blinking, 52 expression scores | Weak with camera only; model trained for entertainment AR | n/a | Opt-in only, visible only to the person (decision of 14 Nov) |

## 20. Visual check of the brow points (14 Nov 2026)
`--brow-check` with Niko's webcam (subject S01). **Visually confirmed by the user:** the green line (upper edge) and the red one (lower edge) fall on both eyebrows, each on its own. This confirms [V, one person] the brow indices used (assumed from memory until now): R upper 70, 63, 105, 66, 107 and lower 46, 53, 52, 65, 55; L upper 300, 293, 334, 296, 336 and lower 276, 283, 282, 295, 285.

Values at rest (iris diameters; mm [INF] with an 11.7 mm iris): PTB_inf 1.5-1.7 (~18-20 mm), PTB_sup 2.0-2.2 (~23-26 mm), brow thickness 0.44-0.50 (~5-6 mm). Active-brow score at rest 0.06-0.11 and up to 0.97 when moving the eyebrows: the expression filter reacts (provisional threshold 0.30). PTB_inf varied ~0.2 diameters (~2.3 mm) within a few seconds, partly due to pitch (down to −13.7°). It is not a noise measurement: that comes from the noise floor.

## 21. Noise floor with brow: sessions 5, 6 and 7 (14 Nov 2026, 19:32)
Niko's webcam, 640x480, 512 px q80 path, VIDEO mode, subject S01, eyebrows relaxed, looking at the red dot. Three sessions with repositioning (blocks with 92 to 100 % stillness). Report `--noise-floor-report --exclude-sessions 1,2,3,4`; full table in `docs/spike-resultados.md`. The mm values are [INF] (iris 11.7 mm).

| Measure | σ_w | σ_b | MDC95 with repositioning (R / L) | in mm [INF] |
|---|---|---|---|---|
| Opening A | 0.041 / 0.041 | 0.038 / 0.016 | 0.155 / 0.123 | 1.8 / 1.4 |
| MRD2n | 0.024 / 0.021 | 0.010 / 0.008 | 0.073 / 0.062 | **0.85 / 0.72** |
| MRD1n | 0.021 / 0.025 | 0.030 / 0.014 | 0.101 / 0.080 | 1.2 / 0.9 |
| **PTB_inf (primary)** | 0.099 / 0.087 | 0.024 / 0.053 | 0.282 / 0.281 | **3.3 / 3.3** |
| PTB_sup | 0.097 / 0.087 | 0.044 / 0.065 | 0.295 / 0.301 | 3.5 / 3.5 |
| PTB_inf, lateral point (46/276) | 0.060 / 0.050 | 0.037 / 0.037 | 0.195 / 0.171 | 2.3 / 2.0 |
| PTB_inf, medial point (55/285) | 0.069 / 0.059 | 0.052 / 0.061 | 0.239 / 0.235 | 2.8 / 2.8 |
| Brow thickness | 0.009 / 0.012 | 0.021 / 0.020 | 0.063 / 0.064 | 0.7 / 0.8 |

**Acceptance criteria for PTB_inf** (provisional thresholds from the architect):
- MDC95 with repositioning ≤ 2.3 mm: **NOT MET** (3.3 mm). With 3.3 mm the +2.3 mm from parabolic flight (Ax 2025) would not be detected, and the +3.7 mm in astronauts (Karlin 2021) would be just above the limit.
- σ_w of brow thickness comparable to MRD1n: **MET** (ratio 0.47).
- Slope of PTB with pitch < 0.1 mm/°: **NOT MET**: −0.38 mm/° between blocks and −0.16 mm/° between sessions.
- Frames excluded for active brow < 30 %: **MET** (0.3 to 1.1 %).
- Positive control: **NO DATA** (`--brow-control` has not been run).

**Reading** [V measured, one person, three sessions]:
- **PTB_inf is ~4 times noisier than MRD2n**, with σ_w of 0.09 versus 0.02 iris diameters. Brow thickness barely varies (σ 0.01): the two brow lines move together. **The whole brow shifts relative to the eye.**
- **Part of that variation depends on pitch** (slope −0.38 mm/° between blocks), which matches the expected parallax effect: the brow is in front of the iris. [INF] With 1 to 2° of pitch variation, that is ~0.4 to 0.8 mm.
- **The expression filter barely intervenes** (0.8 % of frames): the eyebrows were relaxed, and the results match with and without the filter.
- **The lateral brow point is the least noisy** (MDC ~2.0 to 2.3 mm), but it is still borderline.
- **MRD2n improved compared with sessions 2 to 4** (0.72 to 0.85 mm versus 1.1 to 1.4 mm): the lower eyelid measurement is the most stable of all. [INF] The difference may be due to better stillness with the corrected filter and to how you were that day, not to an improvement in the method.
- **σ_b is estimated from three numbers** and sessions 5 and 6 differed a lot from each other (PTB_inf σ_w 0.15 and 0.055): the minimal change with repositioning is imprecise.
- **Possible improvements not yet measured:** correct PTB for pitch (regression with the measured slope) and use the lateral point. Neither has been tested.

## 22. Brow positive control (14 Nov 2026, 19:35)
`--brow-control` with Niko's webcam: 10 s neutral, 10 s eyebrows raised, 4 s rest, 10 s frowning. Reference: MDC95 of PTB_inf with repositioning from sessions 5 to 7 (3.3 mm [INF]). One person, one run.

| Phase | Change in PTB_inf (R / L) | In mm [INF] | Multiples of the MDC | Detected (> 3 times the MDC in both eyes)? |
|---|---|---|---|---|
| Eyebrows raised | +0.283 / +0.165 iris diam. | +3.3 / +1.9 mm | 1.0 / 0.6 | **No** |
| Frowning | −0.767 / −0.814 | −9.0 / −9.5 mm | 2.7 / 2.9 | **No** (narrowly) |

- The sign is as expected in both phases, and the expression scores flagged an active brow in 94 % (raised) and 100 % (frowning) of the frames: the expression filter works.
- **Result: POSITIVE CONTROL NOT DETECTED.** With the measured noise (3.3 mm), not even a large raised-eyebrow gesture exceeds the threshold. [INF] The MediaPipe mesh probably tracks upward brow movement poorly (it tends toward the mean face shape): a large voluntary gesture moved PTB only 2 to 3 mm.
- **Caveat:** when frowning, pitch changed by 7.7°, so part of the −9 mm is parallax and not the brow. With the eyebrows raised, pitch changed by −0.8°.
- **Consequence:** with this webcam and this model, PTB_inf is not a usable signal for detecting **subtle** changes such as the +2 to +4 mm of microgravity: they fall within the noise. **That does not mean the brow is not detected:** the points fall on the eyebrows (confirmed by eye), large gestures (raising, frowning) are detected with the expression scores (94 % and 100 % of the frames) and frowning moved the measurement ~9 mm. The brow remains useful for large changes, gestures and as a quality filter. Possible uses to investigate [NV]: drooping brow, asymmetry, gesture counting (only with the person's permission).
- PTB was not corrected for pitch: the sessions did not save the per-frame points (privacy), so it cannot be recalculated without repeating with `--save-landmarks`.
