<div align="center">

# CV · Eye Health

**Research by Nicolás Richardson ([@xSempiternus](https://github.com/xSempiternus)) · computer vision**

![Python](https://img.shields.io/badge/Python-3-3776ab?style=for-the-badge&logo=python&logoColor=white)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Face_Landmarker-0097a7?style=for-the-badge)
![OpenCV](https://img.shields.io/badge/OpenCV-5-5c3ee8?style=for-the-badge&logo=opencv&logoColor=white)
![Status](https://img.shields.io/badge/status-design_%2B_spike-f0ad4e?style=for-the-badge)

</div>

Branch `computer-vision-ocular`.

Eye health for NOVA using pure computer vision (no soft sensors), designed to integrate with the phone's AR scanner
(`nave/tripulacion/ui/escaner.js`) and the ship's vision bridge (`nave/vision/`, `/v1/vision/ws`, port 8792). The
camera looks at the face, measures blinking, the lower eyelid and the distance to the screen, compares them with each
person's baseline and issues a **follow-up alert**. NOVA does not diagnose and does not name "SANS".

## Status

Design and one measurement of the instrument (spike) only. **No code is integrated into the ship or the app yet.**
Everything was measured with one person, a 640×480 webcam and good lighting; there is no validation on astronauts.

Key spike results (details in [`docs/spike-resultados.md`](docs/spike-resultados.md) and
[`docs/plan.md`](docs/plan.md)):

- MediaPipe Face Landmarker v1 spike: 478 landmarks, iris present, 90/90 detections, 7.76 ms; at 512 px with JPEG,
  100 % detection and an iris of 17 px.
- Detection and iris at 100 % across 31 conditions; after fixing the stillness gate, 100 % of windows pass with the
  person still.
- Noise floor over 3 sessions (2, 3 and 4): minimum detectable change (MDC) of eye opening ~1.8 to 2.2 mm [INF].
- Noise floor with eyebrow (sessions 5-7): PTB_inf MDC 3.3 mm [INF], which fails the ≤ 2.3 mm target; MRD2n 0.7-0.9 mm.
  The eyebrow control test did not detect subtle changes, so PTB_inf is not usable for subtle changes with this webcam
  (large gestures are detected).
- Pupil measurement is deferred: at 512 px the iris is ~17 px and the pupil ~3 to 6 px.

## Contents

| Path | What it is |
|---|---|
| `docs/nova-vision-ocular.pdf` · `.html` | Visual design: architecture, test guide, results, plan (in Spanish) |
| [`docs/plan.md`](docs/plan.md) | Phased plan, with what is done and what is pending |
| [`docs/soft-sensors-antecedentes.md`](docs/soft-sensors-antecedentes.md) | Background with primary sources and tags [V] verified, [P] partial, [NV] not verified, [INF] inference |
| [`docs/spike-resultados.md`](docs/spike-resultados.md) | Results of the webcam measurements |
| [`docs/guia-pruebas.md`](docs/guia-pruebas.md) | Step-by-step test guide |
| `scripts/spike_*.py` | Spike: measures MediaPipe Face Landmarker (condition sweep, noise floor, stillness diagnosis, live view) |
| `tests/` | Automated tests (pytest; 111 test functions) |
| `src/vision/` | Reserved for the module (phase 1) |
| `data/` | Own sessions, with consent; their content is not versioned |

## Running the spike (Windows, PowerShell, from this folder)

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# el modelo (3,76 MB, no se versiona) va en models/face_landmarker.task:
mkdir models
Invoke-WebRequest https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task -OutFile models\face_landmarker.task
python -m pytest tests -q
python scripts\spike_face_landmarker.py --smoke          # sin cámara
python scripts\spike_face_landmarker.py --gate-diagnose --facing front   # con webcam
```

The model (3.76 MB, not versioned) goes in `models/face_landmarker.task`. `--smoke` runs without a camera;
`--gate-diagnose --facing front` uses the webcam.

The guide for what to do in each test is in `docs/nova-vision-ocular.pdf` (and in
[`docs/guia-pruebas.md`](docs/guia-pruebas.md)). To regenerate the PDF: `bash scripts/build_pdf.sh` (requires Chrome).

## Privacy

No images or video are stored. Face landmarks are biometric data and are only stored with `--save-landmarks` (in
`data/`, which is not versioned).

## Rules (from NOVA)

No evidence, no claim. Not a medical device. Neutral Spanish in the product. No secrets in git.
Model: MediaPipe Face Landmarker (Apache 2.0), model card in section 12 of the background document.
