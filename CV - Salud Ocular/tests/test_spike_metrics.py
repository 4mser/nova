"""Pruebas de las metricas puras del spike v2 (sin camara ni mediapipe)."""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import spike_degrade as sd  # noqa: E402
import spike_metrics as sm  # noqa: E402


def synth(**kw):
    return sm.make_synthetic_landmarks(**kw)


# ------------------------------------------------------------ invariancia (obligatoria)
def test_invariance_global_similarity():
    P = synth(t=60, noise_px=0.4, seed=3)
    base = sm.invariance_metrics(P)
    moved = sm.apply_known_similarity(P, 1.7, 23.0, (35.0, -12.0))
    assert np.max(np.abs(sm.invariance_metrics(moved) - base)) < 1e-6


def test_invariance_per_frame_similarity():
    P = synth(t=60, noise_px=0.4, seed=3)
    base = sm.invariance_metrics(P)
    rng = np.random.default_rng(1)
    moved = np.stack([sm.apply_known_similarity(P[i:i + 1], rng.uniform(0.5, 2), rng.uniform(-40, 40),
                                                (float(i), 2.0 * i))[0] for i in range(len(P))])
    assert np.max(np.abs(sm.invariance_metrics(moved) - base)) < 1e-6


def test_procrustes_residual_detects_nonrigid_change():
    P = synth(t=60, noise_px=0.0)
    P2 = P.copy()
    P2[::2, 468:478, 1] += 3.0  # el iris se mueve respecto a la cara en la mitad de los cuadros
    base = sm.invariance_metrics(P)[0]
    assert base < 1e-9
    assert sm.invariance_metrics(P2)[0] > 0.5


# ------------------------------------------------------------ geometria
def test_iris_assignment_by_proximity_and_failure():
    P = synth(t=20)
    assert sm.assign_iris(P) == {"R": 468, "L": 473}
    swapped = P.copy()
    swapped[:, [468, 473]] = swapped[:, [473, 468]]
    assert sm.assign_iris(swapped) == {"R": 473, "L": 468}
    bad = P.copy()
    bad[:, 473] = bad[:, 468]
    with pytest.raises(ValueError):
        sm.assign_iris(bad)


def test_series_values_on_clean_synthetic():
    an = sm.analyze_recording(synth(t=40, noise_px=0.0), np.ones(40, bool), np.ones(40, bool), None, 30.0)
    s = an.series
    assert np.allclose(s["ear_R"], 14.0 / 60.0) and np.allclose(s["ear_L"], 14.0 / 60.0)
    assert math.isclose(an.iod_px, 140.0) and math.isclose(an.d_px, 22.0)
    assert np.allclose(s["A_R"], 14.0 / 22.0)          # apertura en diametros de iris
    assert np.allclose(s["mrd2n_R"], 7.0 / 22.0) and np.allclose(s["mrd1n_R"], 7.0 / 22.0)
    assert np.allclose(s["u_R"], 0.0) and np.allclose(s["v_R"], 0.0)
    assert np.allclose(s["d_iod"], 22.0 / 140.0)


def test_eye_axes_follow_rotation():
    P = synth(t=10, noise_px=0.0)
    R = sm.apply_known_similarity(P, 1.0, 30.0, (0.0, 0.0))
    an = sm.analyze_recording(R, np.ones(10, bool), np.ones(10, bool), None, 30.0)
    assert np.allclose(an.series["ear_R"], 14.0 / 60.0)
    assert np.allclose(an.series["A_R"], 14.0 / 22.0)
    assert np.allclose(an.roll, 30.0)


def test_euler_round_trip():
    def rot(yaw, pitch, roll):
        y, p, r = map(math.radians, (yaw, pitch, roll))
        ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
        rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
        rz = np.array([[math.cos(r), -math.sin(r), 0], [math.sin(r), math.cos(r), 0], [0, 0, 1]])
        M = np.eye(4)
        M[:3, :3] = 3.0 * ry @ rx @ rz  # con escala
        return M
    for ang in ((10, -20, 5), (-35, 12, 40), (0, 0, 0)):
        assert np.allclose(sm.euler_yxz(rot(*ang)), ang, atol=1e-9)


# ------------------------------------------------------------ ruido
def test_sigma_hf_recovers_white_noise_and_med7_agrees():
    rng = np.random.default_rng(0)
    x = rng.normal(0.0, 0.02, 20000)
    assert abs(sm.sigma_hf(x) - 0.02) / 0.02 < 0.05
    assert abs(sm.sigma_med7(x) - 0.02) / 0.02 < 0.05


def test_sigma_hf_ignores_slow_drift_and_nan_gaps():
    rng = np.random.default_rng(1)
    x = rng.normal(0.0, 0.01, 5000) + np.linspace(0, 5, 5000)
    x[1000:1010] = np.nan
    assert abs(sm.sigma_hf(x) - 0.01) / 0.01 < 0.1


def test_block_means_and_mdc():
    x = np.arange(100, dtype=float)
    bm = sm.block_means(x, np.ones(100, bool), 10)
    assert len(bm) == 10 and bm[0] == 4.5
    assert sm.block_means(x, np.zeros(100, bool), 10).size == 0
    assert math.isclose(sm.mdc95(1.0), 1.96 * math.sqrt(2))


def test_paired_bias():
    a = np.array([1.0, 2.0, np.nan, 4.0])
    b = np.array([0.5, 1.5, 3.0, np.nan])
    bias, n = sm.paired_bias(a, b)
    assert bias == 0.5 and n == 2


def test_blink_detection_and_exclusion():
    ear = np.full(100, 0.25)
    ear[20:23] = 0.05      # parpadeo de 3 cuadros
    ear[60] = 0.05         # un solo cuadro: no cuenta
    mask, n, base = sm.detect_blinks(ear)
    assert n == 1 and mask[20:23].all() and not mask[60] and math.isclose(base, 0.25)
    ex = sm.blink_exclusion(ear)
    assert ex[17:26].all() and not ex[16] and not ex[26] and not ex[30] and ex[57:64].all()


def test_perclos():
    a = np.full(120, 0.6)
    a[:30] = 0.05
    overall, wins = sm.perclos(a, fs=1.0, a_open=0.6, window_s=60.0)
    assert math.isclose(overall, 0.25) and len(wins) == 2 and math.isclose(wins[0], 0.5) and wins[1] == 0.0


# ------------------------------------------------------------ gate
def _gate(P, fs=30.0, gp=sm.GateParams(), mats=None):
    an = sm.analyze_recording(P, np.ones(len(P), bool), np.ones(len(P), bool), mats, fs, gp)
    return an


def test_gate_passes_still_and_fails_moving():
    still = _gate(synth(t=90, noise_px=0.2))
    assert still.gate_pct > 95
    moving = _gate(synth(t=90, noise_px=0.2, drift_px=1.5))
    assert moving.gate_pct < 20


def test_gate_fails_on_roll_and_iod_range():
    P = synth(t=90, noise_px=0.0)
    ramp = np.linspace(0, 6, 90)  # 6 grados de roll en 3 s -> 2 grados por ventana de 1 s: borde
    P2 = np.stack([sm.apply_known_similarity(P[i:i + 1], 1.0, float(ramp[i] * 2), (0, 0))[0]
                   for i in range(90)])
    assert _gate(P2).gate_pct == 0
    P3 = np.stack([sm.apply_known_similarity(P[i:i + 1], 1.0 + 0.001 * i, 0.0, (0, 0))[0]
                   for i in range(90)])
    assert _gate(P3).gate_pct == 0


def test_gate_uses_yaw_pitch_when_available():
    P = synth(t=60, noise_px=0.0)
    mats = []
    for i in range(60):
        y = math.radians(i * 0.05)  # 1,45 grados por ventana de 1 s (< 3)
        M = np.eye(4)
        M[:3, :3] = [[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]]
        mats.append(M)
    assert _gate(P, mats=mats).gate_pct > 90
    mats2 = []
    for i in range(60):
        y = math.radians(i * 0.5)  # 14,5 grados por ventana (> 3)
        M = np.eye(4)
        M[:3, :3] = [[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]]
        mats2.append(M)
    assert _gate(P, mats=mats2).gate_pct == 0


def test_gate_face_loss_and_unusable_recording():
    P = synth(t=90, noise_px=0.0)
    face = np.ones(90, bool)
    face[40:50] = False
    P[40:50] = np.nan
    an = sm.analyze_recording(P, face, face, None, 30.0)
    assert not an.gate[40:50].any() and an.gate_pct < 100
    empty = sm.analyze_recording(np.full((20, 478, 2), np.nan), np.zeros(20, bool), np.zeros(20, bool),
                                 None, 30.0)
    assert not empty.usable and empty.gate_pct == 0


# ------------------------------------------------------------ sesiones y MDC
def test_session_summary_and_aggregate():
    sessions = []
    for sid in range(3):
        P = synth(t=300, noise_px=0.3, seed=sid, open_px=14.0 + sid * 0.5)
        an = _gate(P)
        sessions.append(sm.session_summary([an, an]))
    for s in sessions:
        assert s["metrics"]["ear_R"]["n_blocks"] >= 6
    agg = sm.aggregate_sessions([{"metrics": s["metrics"]} for s in sessions])
    e = agg["ear_R"]
    assert e["sigma_b"] > 0.005            # las sesiones tienen aperturas distintas
    assert math.isclose(e["mdc95_within"], sm.mdc95(e["sigma_w"]))
    assert e["mdc95_repos"] > e["mdc95_within"]
    with pytest.raises(ValueError):
        sm.aggregate_sessions([{"metrics": s["metrics"]} for s in sessions[:2]])


def test_mm_conversion_marked_as_inference():
    assert math.isclose(sm.to_mm(0.1), 1.17)


# ------------------------------------------------------------ degradaciones
def test_conditions_no_duplicates_no_upscale():
    for w in (480, 640, 1280):
        cs = sd.build_conditions(w)
        names = [c.name for c in cs]
        assert len(names) == len(set(names)) and cs[0].name == "REF"
        assert all(c.width is None or c.width < w for c in cs)
    names640 = {c.name for c in sd.build_conditions(640)}
    assert "w640_q80" not in names640 and "w512_q50" in names640 and "roll45_comp" in names640


def test_rotate_reflect_and_resize_never_upscales():
    img = np.random.default_rng(0).integers(0, 255, (120, 160, 3), dtype=np.uint8)
    assert sd.shrink(img, 640) is img
    out = sd.rotate_reflect(img, 45.0, (80.0, 60.0))
    assert out.shape == img.shape and out.sum() > 0
    assert sd.rotate_reflect(img, 0.0, (80.0, 60.0)) is img
    assert sd.resize_jpeg(img, 80, 80).shape == (60, 80, 3)


def test_degradations_change_image_as_expected():
    rng = np.random.default_rng(0)
    img = np.full((60, 80, 3), 200, np.uint8)
    assert sd.degrade(img, "dim", rng).mean() < 100
    assert sd.degrade(img, "gamma", rng).mean() < 200
    assert abs(float(sd.degrade(img, "noise10", rng).astype(float).std()) - 10.0) < 1.0


# ------------------------------------------------------------ gate de quietud (diagnostico)
def _ry(deg):
    r = math.radians(deg)
    M = np.eye(4)
    M[0, 0], M[0, 2], M[2, 0], M[2, 2] = math.cos(r), math.sin(r), -math.sin(r), math.cos(r)
    return M


def test_euler_rejects_bad_matrix():
    assert all(math.isnan(v) for v in sm.euler_yxz(np.empty((0,))))
    assert all(math.isnan(v) for v in sm.euler_yxz(np.zeros((4, 4))))
    assert all(math.isnan(v) for v in sm.euler_yxz(np.full((4, 4), np.nan)))


def test_circular_ptp_does_not_break_at_180():
    w = np.array([[179.5, -179.5, 179.0, -179.0] * 5])
    assert sm.circular_ptp(w)[0] < 2.5
    assert np.ptp(w, axis=1)[0] > 350  # sin envolver el rango seria enorme


def test_gate_passes_with_yaw_crossing_180():
    P = synth(t=120, noise_px=0.05)
    face = np.ones(120, bool)
    mats = [_ry(179.5 if i % 2 else -179.5) for i in range(120)]
    an = sm.analyze_recording(P, face, face, mats, 30.0)
    assert an.mat_pct == 100.0 and an.gate_pct > 90
    an_none = sm.analyze_recording(P, face, face, None, 30.0)
    assert an_none.mat_pct == 0.0 and an_none.gate_pct > 90


def test_gate_fails_when_yaw_really_moves():
    P = synth(t=120, noise_px=0.05)
    face = np.ones(120, bool)
    mats = [_ry(float(i)) for i in range(120)]  # 1 grado por cuadro: 30 grados por ventana
    an = sm.analyze_recording(P, face, face, mats, 30.0)
    assert an.gate_pct == 0.0
    d = sm.diagnose_windows(an.gate_vals, sm.GateParams(), an.mat_pct)
    assert d["bottleneck"] in ("yaw",) and d["criteria"]["yaw"]["pass_pct"] == 0.0
    assert d["criteria"]["speed"]["pass_pct"] == 100.0 and d["all_pct"] == 0.0


def test_speed_uses_midpoint_not_sum():
    """Traslacion pura de 0.4 % de IOD por cuadro: con el punto medio la velocidad es 0.4
    (pasa < 0.5); con la suma seria 0.8 (fallaba siempre)."""
    t, fs = 90, 30.0
    P = synth(t=t, noise_px=0.0)
    iod = 140.0
    P = P + np.stack([np.arange(t) * 0.004 * iod, np.zeros(t)], axis=1)[:, None, :]
    face = np.ones(t, bool)
    an = sm.analyze_recording(P, face, face, None, fs)
    assert math.isclose(float(np.median(an.gate_vals["speed"])), 0.4, rel_tol=1e-6)
    assert an.gate_pct > 90


def test_diagnose_windows_structure_and_short_input():
    P = synth(t=10, noise_px=0.05)
    face = np.ones(10, bool)
    an = sm.analyze_recording(P, face, face, None, 30.0)
    assert len(an.gate_vals["speed"]) == 0 and an.gate_pct == 0.0
    P = synth(t=90, noise_px=0.3, seed=2)
    an = sm.analyze_recording(P, np.ones(90, bool), np.ones(90, bool), None, 30.0)
    d = sm.diagnose_windows(an.gate_vals, sm.GateParams(), an.mat_pct)
    assert set(d["criteria"]) == set(sm.CRITERIA) and d["n_windows"] == 61
    assert 0.0 <= d["all_pct"] <= 100.0 and d["bottleneck"] in sm.CRITERIA
    assert math.isnan(d["criteria"]["yaw"]["median"])  # sin matriz


# ------------------------------------------------------------ reintento por quietud
def test_retry_decision_passes_first_attempt():
    assert sm.retry_decision(95.0, 1, 2, 80.0) == sm.ACCEPT


def test_retry_decision_passes_second_attempt():
    assert sm.retry_decision(40.0, 1, 2, 80.0) == sm.RETRY
    assert sm.retry_decision(85.0, 2, 2, 80.0) == sm.ACCEPT


def test_retry_decision_never_passes_flags_after_last_retry():
    assert [sm.retry_decision(30.0, k, 2, 80.0) for k in (1, 2, 3)] == [sm.RETRY, sm.RETRY, sm.FLAG]


def test_retry_decision_exact_limit_and_edges():
    assert sm.retry_decision(80.0, 1, 2, 80.0) == sm.ACCEPT       # 80 % exacto pasa
    assert sm.retry_decision(79.999, 1, 2, 80.0) == sm.RETRY
    assert sm.retry_decision(79.999, 3, 2, 80.0) == sm.FLAG
    assert sm.retry_decision(10.0, 1, 0, 80.0) == sm.FLAG         # sin reintentos
    assert sm.retry_decision(None, 1, 2, 80.0) == sm.ACCEPT       # sin dato no se reintenta
    assert sm.retry_decision(0.0, 1, 2, 0.0) == sm.ACCEPT


# ------------------------------------------------------------ gate inmune al parpadeo
BLINKS = [(40, 45), (130, 135), (220, 226), (310, 315)]   # ~cada 3 s a 30 fps, 5-6 cuadros
LEGACY = sm.GateParams(legacy=True)


def _blinky(**kw):
    return synth(t=360, noise_px=0.2, seed=5, blinks=BLINKS, blink_shift_px=2.0, **kw)


def _window_pass_pct(an):
    from spike_metrics import window_pass
    gp = sm.GateParams()
    return 100.0 * float(np.logical_and.reduce(list(window_pass(an.gate_vals, gp).values())).mean())


def test_gate_rigid_indices_exist_in_mesh():
    idx = sm.FACE_MIDLINE_IDX + sm.FACE_CHEEK_IDX
    assert all(0 <= i < sm.N_LANDMARKS - len(sm.IRIS_IDX) for i in idx) and len(set(idx)) == len(idx)
    assert not set(idx) & (set(sm.LID_IDX) | {33, 133, 362, 263})


def test_blinking_still_head_passes_new_gate_and_fails_legacy():
    P = _blinky()
    ok = np.ones(len(P), bool)
    new = sm.analyze_recording(P, ok, ok, None, 30.0)
    old = sm.analyze_recording(P, ok, ok, None, 30.0, LEGACY)
    assert new.n_blinks == len(BLINKS)
    assert new.gate_pct == 100.0 and _window_pass_pct(new) == 100.0
    assert _window_pass_pct(old) < 80.0              # el parpadeo se confunde con movimiento


def test_blink_mask_excludes_frames_from_ranges():
    """Un salto de escala solo en cuadros de parpadeo no reprueba con la mascara y si sin ella."""
    t, fs, gp = 60, 30.0, sm.GateParams()
    pos, valid = np.tile([300.0, 240.0], (t, 1)), np.ones(t, bool)
    scale, roll = np.full(t, 140.0), np.zeros(t)
    scale[20:26] = 154.0                              # +10 % durante el parpadeo
    blink = np.zeros(t, bool)
    blink[17:29] = True
    masked = sm.window_pass(sm.gate_window_values(pos, scale, roll, None, None, valid, fs, gp, blink), gp)
    plain = sm.window_pass(sm.gate_window_values(pos, scale, roll, None, None, valid, fs, gp), gp)
    assert masked["iod"].all() and masked["face_loss"].all()
    assert not plain["iod"].all()
    # ventana casi toda en parpadeo: sin cuadros utiles no hay veredicto -> falla, no pasa por defecto
    allb = sm.gate_window_values(pos, scale, roll, None, None, valid, fs, gp, np.ones(t, bool))
    assert not sm.window_pass(allb, gp)["iod"].any()


def test_blink_frames_do_not_count_as_face_loss():
    t = 90
    P = synth(t=t, noise_px=0.0, blinks=[(40, 46)])
    valid = np.ones(t, bool)
    valid[41:45] = False                              # sin iris con el ojo cerrado
    P[~valid] = np.nan
    an = sm.analyze_recording(P, valid, valid, None, 30.0)
    assert an.gate_pct == 100.0
    # cara perdida de verdad (sin parpadeo) sigue fallando
    P2 = synth(t=t, noise_px=0.0)
    v2 = np.ones(t, bool)
    v2[41:45] = False
    P2[~v2] = np.nan
    assert sm.analyze_recording(P2, v2, v2, None, 30.0).gate_pct < 100.0


def test_gate_still_fails_on_real_head_motion_with_blinks():
    ok = np.ones(360, bool)
    P = _blinky(drift_px=1.5)                        # traslacion
    assert sm.analyze_recording(P, ok, ok, None, 30.0).gate_pct < 20.0
    P = _blinky()
    ramp = np.linspace(0, 20, 360)                   # rotacion (roll) de ~1 grado por ventana... x2
    R = np.stack([sm.apply_known_similarity(P[i:i + 1], 1.0, float(ramp[i] * 2), (0, 0))[0]
                  for i in range(360)])
    assert sm.analyze_recording(R, ok, ok, None, 30.0).gate_pct == 0.0


def test_fail_summary_orders_and_formats():
    s = sm.fail_summary({"roll": 35.0, "iod": 70.2, "speed": 0.0, "face_loss": 0.0})
    assert s == "criterios que fallaron: IOD 70 %, roll 35 %"
    assert sm.fail_summary({"roll": 0.0}) == ""


def test_gate_legacy_matches_old_definition():
    """legacy: posicion = medio de los puntos medios de los ojos, escala = IOD de comisuras."""
    P = synth(t=5, noise_px=0.0)
    pos, scale, roll = sm.gate_inputs(P, legacy=True)
    assert np.allclose(scale, 140.0) and np.allclose(roll, 0.0) and np.allclose(pos[0], (300.0, 240.0))
    pos, scale, roll = sm.gate_inputs(P)
    assert np.allclose(scale, 140.0) and np.allclose(roll, 0.0)   # 0,4 x 350
