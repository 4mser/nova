# Work plan: eye health in NOVA with computer vision

Updated: 14 Nov 2026. Mark each item as you progress. Status: `[x]` done, `[~]` in progress, `[ ]` pending.

## Goal
Integrate eye health into NOVA's AR scanner using **computer vision only** (no soft sensors). The phone looks at the face, measures blinking, the lower eyelid and distance, compares them with each person's baseline and issues a **follow-up alert**, never a diagnosis or "SANS". Everything on board, without internet.

## Decisions made
- Phone and webcam only. Mission instruments (OCT, fundus, tonometer) come in as optional data through the medical station contract.
- Switchable camera: front (self-check) and rear (another person scans). Baseline per camera.
- Visual acuity and the Amsler grid are included, assisted by the camera (Amsler exploratory).
- Pupil: deferred. At 512 px the iris measures ~17 px and the pupil ~3 to 6 px; a larger image is needed.
- The eye is one more system in the AR scanner's hologram.
- Autonomous and supervised modes. The acuity alert threshold is defined by Niko.
- Model: MediaPipe Face Landmarker. The module runs inside the `/v1/vision/ws` bridge.
- All scientific data with a primary source; anything not verified [NV] is not cited.
- The pitch is not touched for now.

## Phases

### Phase 0 · Spike (branch `nico/vision-spike`)
- [x] Research and verified background (`docs/soft-sensors-antecedentes.md`)
- [x] `hackaton-vision` repo on GitHub (private), design page published
- [x] Spike v1 with webcam: 478 points, iris present, 90/90 detections, 7.76 ms
- [x] Test at 512 px with JPEG: 100 % detection, iris 17 px
- [x] Model documentation (section 12)
- [x] Spike v2 programmed (design by `cv-arquitecto`, code by `impl-python`): 22 automated tests and the smoke test pass; still needs to run with a webcam
- [x] Run `--check --sweep` with your webcam: detection and iris at 100 % in 31 conditions; the stillness gate approved 0 % (needs fixing)
- [x] Stillness gate fixed and diagnosed: with the person still, 100 % of windows pass (orientation matrix in 100 % of frames)
- [x] Live interface with wait-for-stillness: tested on the webcam (100 % stillness when still, 37 % when moving)
- [x] Automatic retry if you move (tested with simulations)
- [x] Sweep repeated with the fixed gate: acceptance met (stillness 84.6 %, MDC of A ~0.33 mm [INF])
- [x] Noise floor, 3 sessions (2, 3 and 4): MDC of eye opening ~1.8 to 2.2 mm [INF]; repositioning adds little
- [x] Record results and the minimum detectable change in the docs (section 17)

### Phase 1 · Base (`nico/vision-base`) · agent `impl-python`
- [ ] Landmark module with camera, mirror and resolution registry
- [ ] Quality gate (light, sharpness, pose, occlusion); abstains if the image is bad
- [ ] Personal baseline per person and per camera (median and MAD, minimum 7 valid days)
- [ ] Output contract in `docs/contrato.md` (value, quality, uncertainty, status, source, version)
- [ ] Demo with webcam and a flip-camera button

### Phase 2 · Measurements, in parallel (agents `impl-python`)
- [ ] 2a `nico/vision-parpadeo-periocular`: blinking, PERCLOS, eyelid opening and MRD2 as change against the baseline
- [ ] 2b `nico/vision-distancia`: distance from the iris and fixation for acuity and Amsler
- [ ] Pupil: deferred until there is a larger image or on-phone processing

### Phase 3 · Wrap-up
- [ ] QA with a real webcam (agent `qa`): glasses, low light, brown eyes, tilted head, another person
- [ ] Handover specification for whoever maintains `nova-pc`: `/v1/vision/ws` bridge, AR overlay and the eye as a hologram system
- [ ] Review by ophthalmology and a flight surgeon

## Depends on other people or on missing data
- [ ] Actual FPS of the scanner. Below ~15 fps, blinking and PERCLOS are not viable through that route.
- [ ] Actual JPEG quality of the scanner and whether the phone crops the image before sending it.
- [ ] Which camera the scanner uses today.
- [ ] Whether the 689 anatomical structures include the eye (BodyParts3D has it; retina and optic nerve do not).
- [ ] Minimum clinically relevant change: literature or flight surgeon.
- [ ] Acuity alert threshold (Niko).
- [ ] Eye injury protocol: does not exist among the 12; candidate to add.
- [ ] BodyParts3D license: the PDF says CC BY 4.0 and its README says CC BY-SA 2.1 Japan.

## Housekeeping
- [ ] Delete the GitHub repo `aura-modelos` (`gh auth refresh -h github.com -s delete_repo`, or Settings on the web)
- [ ] Delete the duplicate copies of `Antecedentes/` and edit only in `hackaton-vision/docs/`
- [ ] Review the `NASA-datos-salud/` folder that appeared in the project

## Who does what
| Task | Agent | Model |
|---|---|---|
| Vision and methodology decisions | `cv-arquitecto` | the most capable |
| Module implementation | `impl-python` | mid-range |
| Research with sources | `investigador` | mid-range |
| Verify with a real webcam | `qa` | mid-range |
| If a model fails twice | go up one level | |

## Rules
- No evidence, no claim. NOVA is not a medical device and does not diagnose.
- Images are never saved. Raw landmarks are biometric data and are only saved with an explicit flag.
- Commits without AI attribution. Branches `nico/<topic>`.

- [x] Noise floor with eyebrow (sessions 5-7): PTB_inf MDC 3.3 mm [INF], does not meet ≤ 2.3 mm; MRD2n 0.7-0.9 mm
- [x] Eyebrow control (--brow-control): NOT detected (raised 1.0/0.6 times the MDC; frown 2.7/2.9). PTB_inf is not usable for subtle changes with this webcam (large gestures are detected)
- [ ] Decide which detectors stay (MRD2 and eye opening as a trend, blinking/PERCLOS; PTB not usable for subtle changes; the eyebrow does work for large gestures, drooping eyebrow and asymmetry [to be investigated])
