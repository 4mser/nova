"""Pruebas de las funciones puras de la vista en vivo (sin camara, sin mediapipe, sin ventana)."""
from __future__ import annotations

import math
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import spike_metrics as sm  # noqa: E402
import spike_viewer as sv  # noqa: E402

FS = 30.0


def face(dx: float = 0.0, dy: float = 0.0, rot_deg: float = 0.0) -> np.ndarray:
    P = sm.make_synthetic_landmarks(1, noise_px=0.0)[0]
    if rot_deg:
        P = sm.apply_known_similarity(P[None], 1.0, rot_deg, (0.0, 0.0))[0]
    return P + (dx, dy)


def rot_y(deg: float) -> np.ndarray:
    r = math.radians(deg)
    M = np.eye(4)
    M[0, 0], M[0, 2], M[2, 0], M[2, 2] = math.cos(r), math.sin(r), -math.sin(r), math.cos(r)
    return M


def fill(gate: sv.LiveGate, frames: list[tuple[np.ndarray | None, np.ndarray | None]], t0: float = 0.0) -> None:
    for i, (p, m) in enumerate(frames):
        gate.push(p, m, t0 + i / FS)


def by_key(st: sv.GateStatus) -> dict[str, sv.Indicator]:
    return {i.key: i for i in st.indicators}


# ------------------------------------------------------------ gate en vivo
def test_gate_warming_returns_none():
    g = sv.LiveGate(sm.GateParams())
    assert g.status() is None
    fill(g, [(face(), None)] * 10)
    assert g.status() is None  # menos de una ventana de 1 s


def test_gate_quiet_when_still():
    g = sv.LiveGate(sm.GateParams())
    fill(g, [(face(), np.eye(4))] * 40)
    st = g.status()
    assert st is not None and st.quiet
    assert all(i.ok for i in st.indicators) and len(st.indicators) == 5


def test_gate_no_matrix_omits_yaw_pitch_but_stays_quiet():
    g = sv.LiveGate(sm.GateParams())
    fill(g, [(face(), None)] * 40)
    st = g.status()
    ind = by_key(st)
    assert st.quiet and ind["yaw"].ok is None and ind["pitch"].ok is None and ind["yaw"].value is None
    assert sv.status_color(ind["yaw"].ok) == sv.GRAY


def test_gate_speed_fails_when_moving():
    g = sv.LiveGate(sm.GateParams())
    fill(g, [(face(dx=3.0 * i), None) for i in range(40)])  # 3 px/cuadro sobre IOD 140: ~2 %
    st = g.status()
    assert not st.quiet and by_key(st)["speed"].ok is False and by_key(st)["speed"].value > 0.5


def test_gate_roll_fails_on_tilt_and_yaw_on_turn():
    g = sv.LiveGate(sm.GateParams())
    fill(g, [(face(rot_deg=0.4 * i), np.eye(4)) for i in range(40)])  # ~12 grados en 1 s
    assert by_key(g.status())["roll"].ok is False
    g2 = sv.LiveGate(sm.GateParams())
    fill(g2, [(face(), rot_y(10.0 if i % 2 else 0.0)) for i in range(40)])
    st = g2.status()
    assert by_key(st)["yaw"].ok is False and not st.quiet and by_key(st)["roll"].ok is True


def test_gate_face_loss_is_not_quiet_and_recovers_incrementally():
    g = sv.LiveGate(sm.GateParams())
    frames = [(face(), None)] * 20 + [(None, None)] * 3 + [(face(), None)] * 20
    fill(g, frames)
    st = g.status()
    assert not st.quiet and st.face_loss_pct > 0
    fill(g, [(face(), None)] * 40, t0=43 / FS)  # la ventana vieja sale del buffer
    st2 = g.status()
    assert st2.quiet and st2.face_loss_pct == 0.0


def test_gate_buffer_is_bounded_and_uses_last_window():
    g = sv.LiveGate(sm.GateParams(), maxlen=60)
    fill(g, [(face(dx=3.0 * i), None) for i in range(200)])
    assert len(g.buf) == 60
    fill(g, [(face(), None)] * 40, t0=200 / FS)
    assert g.status().quiet


def test_gate_matches_offline_quiet_gate():
    """La ventana final en vivo debe dar el mismo veredicto que sm.quiet_gate sobre los mismos datos."""
    P = sm.make_synthetic_landmarks(40, noise_px=0.05, seed=1)
    g = sv.LiveGate(sm.GateParams())
    fill(g, [(p, None) for p in P])
    an = sm.analyze_recording(P, np.ones(40, bool), np.ones(40, bool), None, FS)
    assert g.status().quiet == bool(an.gate[-1])


def test_indicator_text_and_thresholds_shown():
    ind = sv.Indicator("speed", "Velocidad", 0.321, 0.5, True, "%IOD/cuad")
    assert sv.indicator_text(ind) == "0.32 / < 0.5 %IOD/cuad"
    assert "omitido" in sv.indicator_text(sv.Indicator("yaw", "Yaw", None, 3.0, None, "gr"))


# ------------------------------------------------------------ espera de quietud
def run_waiter(seq: list[tuple[float, bool | None]], **kw: float) -> list[str]:
    w = sv.StillWaiter(**kw)
    return [w.update(q, t) for t, q in seq]


def test_waiter_ready_after_hold():
    seq = [(i / FS, True) for i in range(60)]  # 2 s en verde
    out = run_waiter(seq)
    assert out[0] == "waiting" and out[-1] == "ready"
    first_ready = out.index("ready")
    assert abs(seq[first_ready][0] - 1.5) < 1 / FS + 1e-9


def test_waiter_resets_on_red():
    seq = [(i / FS, i != 30) for i in range(120)]  # un cuadro rojo a 1 s
    out = run_waiter(seq)
    ready_t = seq[out.index("ready")][0]
    assert ready_t >= 1.0 + 1.5 - 1 / FS


def test_waiter_none_counts_as_not_quiet_and_times_out():
    seq = [(i * 0.5, None if i % 2 else False) for i in range(100)]
    out = run_waiter(seq, timeout_s=10.0)
    assert "ready" not in out
    t_timeout = seq[out.index("timeout")][0]
    assert t_timeout == pytest.approx(10.0)


def test_waiter_ready_wins_over_timeout_at_same_instant():
    out = run_waiter([(0.0, True), (1.5, True)], timeout_s=1.5)
    assert out == ["waiting", "ready"]


def test_waiter_progress_helpers():
    w = sv.StillWaiter()
    assert w.update(True, 5.0) == "waiting"
    assert w.green_s(6.0) == pytest.approx(1.0) and w.elapsed(7.0) == pytest.approx(2.0)


# ------------------------------------------------------------ minigrafico y parpadeo
def test_sparkline_segments_scale_and_bounds():
    rect = (10, 20, 100, 50)
    samples = [(t, 0.3 + 0.1 * math.sin(t)) for t in np.linspace(0, 5, 50)]
    segs, (vmin, vmax) = sv.sparkline_segments(samples, 5.0, 5.0, rect)
    pts = [p for s in segs for p in s]
    assert len(segs) == 1 and len(pts) == 50 and vmin < 0.2 and vmax > 0.4
    assert all(10 <= x <= 109 and 20 <= y <= 69 for x, y in pts)
    assert [x for x, _ in pts] == sorted(x for x, _ in pts)


def test_sparkline_splits_on_nan_drops_old_and_handles_empty():
    rect = (0, 0, 100, 40)
    samples = [(0.0, 0.3), (1.0, 0.3), (2.0, float("nan")), (3.0, 0.3), (4.0, 0.3), (-9.0, 0.9)]
    segs, _ = sv.sparkline_segments(samples, 4.0, 5.0, rect)
    assert [len(s) for s in segs] == [2, 2]  # el de t=-9 queda fuera de ventana
    assert sv.sparkline_segments([], 1.0, 5.0, rect)[0] == []
    assert sv.sparkline_segments([(0.0, float("nan"))], 0.0, 5.0, rect)[0] == []


def test_ear_trace_detects_blink_and_flashes():
    tr = sv.EarTrace()
    t = 0.0
    for _ in range(40):
        tr.push(t, 0.30)
        t += 1 / FS
    assert tr.blinks == 0 and tr.threshold == pytest.approx(0.6 * 0.30, abs=0.01)
    tr.push(t, 0.10)  # un solo cuadro bajo: no es parpadeo
    t += 1 / FS
    tr.push(t, 0.30)
    t += 1 / FS
    assert tr.blinks == 0 and not tr.flashing(t)
    for _ in range(3):
        tr.push(t, 0.10)
        t += 1 / FS
    assert tr.blinks == 1 and tr.flashing(t)
    assert not tr.flashing(t + 1.0)


def test_ear_trace_window_is_pruned():
    tr = sv.EarTrace(window_s=5.0)
    for i in range(400):
        tr.push(i / FS, 0.3)
    assert tr.samples[-1][0] - tr.samples[0][0] <= 5.0


# ------------------------------------------------------------ metricas en vivo
def test_live_metrics_on_synthetic_face():
    m = sv.live_metrics(face())
    assert m is not None
    assert m.ear_r == pytest.approx(14 / 60, abs=1e-6) and m.ear_l == pytest.approx(14 / 60, abs=1e-6)
    assert m.iris_px == pytest.approx(22.0, abs=1e-6) and m.iod_px == pytest.approx(140.0, abs=1e-6)
    assert m.a_r == pytest.approx(14 / 22, abs=1e-6) and m.mrd2n_l == pytest.approx(7 / 22, abs=1e-6)


def test_live_metrics_missing_face():
    assert sv.live_metrics(None) is None
    bad = face()
    bad[10] = np.nan
    assert sv.live_metrics(bad) is None
    assert sv.live_metrics(face()[:100]) is None


# ------------------------------------------------------------ formato, color y teclas
def test_formatting():
    assert sv.fmt_num(1.23456, 2) == "1.23" and sv.fmt_num(None) == "n/a" and sv.fmt_num(float("nan")) == "n/a"
    assert sv.fmt_num(12.34, 1, " px") == "12.3 px"
    assert sv.fmt_clock(75.4) == "01:15" and sv.fmt_clock(-3) == "00:00"
    assert sv.fmt_remaining(None) == "n/a" and sv.fmt_remaining(3.04) == "3.0 s" and sv.fmt_remaining(-1) == "0.0 s"
    assert sv.ascii_text("Cuenta atrás: ñandú ≥ 3") == "Cuenta atras: nandu  3"


def test_color_selection():
    assert sv.status_color(True) == sv.GREEN and sv.status_color(False) == sv.RED
    assert sv.status_color(None) == sv.GRAY
    assert sv.phase_color("CUENTA REGRESIVA 3") == sv.YELLOW and sv.phase_color("GRABANDO") == sv.RED
    assert sv.phase_color("ESPERANDO QUIETUD") == sv.ORANGE and sv.phase_color("PROCESANDO") == sv.CYAN
    assert sv.line_color("REF: NO CUMPLE") == sv.RED and sv.line_color("REF: CUMPLE") == sv.GREEN
    assert sv.line_color("! aviso") == sv.ORANGE and sv.line_color("texto") == sv.WHITE


def test_key_actions():
    assert sv.key_action(-1) is None and sv.key_action(ord("x")) is None
    assert sv.key_action(ord("q")) == "quit" and sv.key_action(27) == "quit" and sv.key_action(ord("Q")) == "quit"
    assert sv.key_action(ord("m")) == "mirror" and sv.key_action(ord("p")) == "pause"
    assert sv.key_action(0x100000 | ord("q")) == "quit"  # modificadores de waitKey


# ------------------------------------------------------------ render a memoria
def make_frame(w: int = 640, h: int = 480) -> np.ndarray:
    return np.random.default_rng(0).integers(0, 255, (h, w, 3), dtype=np.uint8)


def hud(**kw: object) -> sv.CaptureHud:
    base = dict(mode="PRUEBA", phase="GRABANDO", progress=0.4, remaining_s=3.0, size=(640, 480), fps=29.7)
    base.update(kw)
    return sv.CaptureHud(**base)  # type: ignore[arg-type]


def test_render_capture_does_not_touch_frame_and_draws_landmarks():
    f = make_frame()
    before = f.copy()
    with_face = sv.render_capture(f, face(), hud())
    no_face = sv.render_capture(f, None, hud())
    assert np.array_equal(f, before)
    assert with_face.dtype == np.uint8 and with_face.shape == (630, 1000, 3) and with_face.shape == no_face.shape
    assert not np.array_equal(with_face, no_face)
    # iris amarillo y centro rojo presentes en la zona del video
    video = with_face[:480, :640].reshape(-1, 3)
    assert (video == np.array(sv.YELLOW)).all(axis=1).any() and (video == np.array(sv.RED)).all(axis=1).any()


def test_render_capture_mirror_flips_video_only():
    f = make_frame()
    a = sv.render_capture(f, None, hud(), mirror=False, draw_lm=False)
    b = sv.render_capture(f, None, hud(), mirror=True, draw_lm=False)
    # el cartel de instrucciones (abajo) no se voltea: se compara solo la zona de video sin cartel
    assert np.array_equal(a[70:360, :640][:, ::-1], b[70:360, :640])


def test_render_capture_other_resolutions_and_no_draw_banner():
    for w, h in ((1280, 720), (320, 240)):
        c = sv.render_capture(make_frame(w, h), face(), hud(size=(w, h), slow=True, infer_ms=40), draw_lm=False)
        assert c.shape[1] == 1000 and c.shape[0] >= 620


def test_render_capture_hud_variants_do_not_fail():
    g = sv.LiveGate(sm.GateParams())
    fill(g, [(face(), None)] * 40)
    m = sv.live_metrics(face())
    for h in (hud(gate=g.status(), metrics=m, block=(2, 3), blink_flash=True, note="x"),
              hud(gate=None, metrics=None, progress=None, remaining_s=None),
              hud(phase="CUENTA REGRESIVA 5", ear_samples=[(0.0, 0.3), (1.0, 0.2)], ear_thr=0.18, now=1.0)):
        assert sv.render_capture(make_frame(), face(), h).ndim == 3


def test_render_processing_and_final_with_and_without_face():
    rows = [sv.RowStat(f"cond{i}", 99.0, 97.0, 11.0) for i in range(14)]
    st = sv.ProcState("T", "REF", 2, 30, 0.2, make_frame(512, 384), face() * 0.8, rows, 61.0, "cuadro 1/5")
    a = sv.render_processing(st)
    st.P = None
    b = sv.render_processing(st)
    st.preview = None
    c = sv.render_processing(st)
    assert a.shape == b.shape == c.shape == (sv.PROC_H, sv.PROC_W, 3)
    assert not np.array_equal(a, b) and not np.array_equal(b, c)
    fin = sv.render_final("R", ["REF: CUMPLE", "REF: NO CUMPLE"], "tecla")
    assert fin.shape == (sv.PROC_H, sv.PROC_W, 3) and (fin == np.array(sv.GREEN)).all(axis=2).any()


def test_fit_box_upscale_is_nearest_and_downscale_fits():
    big, s = sv.fit_box(make_frame(256, 192), 470, 352)
    assert s > 1 and big.shape[1] <= 470 and big.shape[0] <= 352
    small, s2 = sv.fit_box(make_frame(1280, 720), 470, 352)
    assert s2 < 1 and small.shape[1] <= 470


def test_scale_canvas():
    c = np.zeros((100, 200, 3), np.uint8)
    assert sv.scale_canvas(c, 1.0) is c and sv.scale_canvas(c, 0.5).shape == (50, 100, 3)


def test_panel_texts_fit_in_side_panel():
    room = sv.PANEL_W - 12
    for text, scale in (("CUENTA REGRESIVA 15", 0.62), ("ESPERANDO QUIETUD", 0.62),
                        ("Resolucion 1920x1080   FPS 30.0", 0.5), ("QUIETUD EN VIVO (ventana 1 s)", 0.5),
                        ("DIAGNOSTICO DEL GATE", 0.55), ("SUELO DE RUIDO s12", 0.55)):
        assert cv2.getTextSize(text, sv.FONT, scale, 2)[0][0] < room, text


# ------------------------------------------------------------ monitor
def monitor(infer, **kw):
    return sv.LiveMonitor(None, infer, sm.GateParams(), "T", **kw)


def test_monitor_slow_inference_skips_drawing_but_keeps_gate():
    P = face()

    def slow(frame, ts):
        time.sleep(0.004)
        return P, np.eye(4)

    f = make_frame()
    mon = monitor(slow, slow_ms=1.0)
    for i in range(45):
        c = mon.feed(f, "GRABANDO", now=i / FS)
    assert mon.last_hud.slow and mon.quiet() is True  # el gate sigue calculando
    video = c[:480, :640]
    assert not (video == np.array(sv.YELLOW)).all(axis=2).any()  # sin landmarks


def test_monitor_timestamps_strictly_increase_and_raw_mirror():
    seen: list[int] = []

    def infer(frame, ts):
        seen.append(ts)
        return None, None

    f = make_frame()
    mon = monitor(infer, capture_mirror=True)
    for _ in range(5):
        mon.feed(f, "X", raw=True, now=1.0)  # mismo instante: igual deben crecer
    assert seen == sorted(set(seen)) and len(seen) == 5
    assert mon.quiet() is None


def test_monitor_eta_and_fps():
    mon = monitor(lambda f, t: (None, None))
    f = make_frame()
    for i in range(31):
        mon.feed(f, "X", now=i / FS)
    assert mon.fps() == pytest.approx(FS, rel=1e-6) and mon.eta(60) == pytest.approx(2.0, rel=1e-6)
    assert monitor(lambda f, t: (None, None)).eta(10) is None


def test_process_panel_without_view_is_noop():
    p = sv.ProcessPanel(None, "T", 3)
    p.update(1, "REF", 0.5, make_frame(), None)
    p.add_row("a", 1, 1, 1)
    p.frame_cb(1, "REF")(0, 5, make_frame(), None)
    assert len(p.rows) == 1


def test_process_panel_keeps_last_12_rows():
    p = sv.ProcessPanel(None, "T", 3)
    for i in range(20):
        p.add_row(f"c{i}", 99.0, 99.0, 1.0)
    assert [r.name for r in p.rows][0] == "c8" and len(p.rows) == 12


def test_liveview_open_degrades_without_gui(monkeypatch, capsys):
    def boom(*a, **k):
        raise cv2.error("no display")

    monkeypatch.setattr(cv2, "namedWindow", boom)
    assert sv.LiveView.open() is None
    assert "sin entorno grafico" in capsys.readouterr().out


def test_liveview_show_degrades_when_imshow_fails(monkeypatch, capsys):
    v = sv.LiveView()
    monkeypatch.setattr(cv2, "imshow", lambda *a: (_ for _ in ()).throw(cv2.error("x")))
    monkeypatch.setattr(cv2, "waitKey", lambda ms=1: -1)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *a: 1.0)
    v.show(np.zeros((10, 10, 3), np.uint8))
    assert v.dead and "fallo" in capsys.readouterr().out
    v.show(np.zeros((10, 10, 3), np.uint8))  # ya muerta: no hace nada ni lanza


@pytest.mark.parametrize("key,exc", [(ord("q"), True), (27, True), (ord("m"), False)])
def test_liveview_keys(monkeypatch, key, exc):
    v = sv.LiveView()
    monkeypatch.setattr(cv2, "imshow", lambda *a: None)
    monkeypatch.setattr(cv2, "waitKey", lambda ms=1: key)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *a: 1.0)
    canvas = np.zeros((10, 10, 3), np.uint8)
    if exc:
        with pytest.raises(sv.ViewAbort):
            v.show(canvas)
    else:
        v.show(canvas)
        assert v.mirror


def test_liveview_pause_toggles_and_window_close_aborts(monkeypatch):
    v = sv.LiveView()
    keys = iter([ord("p"), ord("p")])
    monkeypatch.setattr(cv2, "imshow", lambda *a: None)
    monkeypatch.setattr(cv2, "waitKey", lambda ms=1: next(keys))
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *a: 1.0)
    v.show(np.zeros((10, 10, 3), np.uint8))
    assert v.paused and v._frozen is not None
    v.refresh()
    assert not v.paused
    monkeypatch.setattr(cv2, "waitKey", lambda ms=1: -1)
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *a: -1.0)
    with pytest.raises(sv.ViewAbort):
        v.pump()


def test_show_final_returns_on_key_and_on_hold_timeout(monkeypatch):
    shown: list[int] = []
    monkeypatch.setattr(cv2, "imshow", lambda name, img: shown.append(1))
    monkeypatch.setattr(cv2, "getWindowProperty", lambda *a: 1.0)
    keys = iter([-1, -1, ord("x")])
    monkeypatch.setattr(cv2, "waitKey", lambda ms=1: next(keys))
    sv.LiveView(hold_s=0.0).show_final("T", ["a"])
    assert len(shown) == 3
    monkeypatch.setattr(cv2, "waitKey", lambda ms=1: (time.sleep(0.03), -1)[1])
    t0 = time.perf_counter()
    sv.LiveView(hold_s=0.1).show_final("T", ["a"])
    assert 0.1 <= time.perf_counter() - t0 < 1.0


# ------------------------------------------------------------ quietud durante la grabacion
def _monitor_with(frames_fn):
    state = {"i": 0}
    img = np.zeros((48, 64, 3), np.uint8)

    def infer(_f, _ts):
        return frames_fn(state["i"]), np.eye(4)

    mon = sv.LiveMonitor(None, infer, sm.GateParams(), "TEST")

    def feed(n: int):
        for _ in range(n):
            state["i"] += 1
            mon.feed(img, "GRABANDO", now=state["i"] / FS)
    return mon, feed


def test_quiet_pct_pure():
    assert sv.quiet_pct([]) is None
    assert sv.quiet_pct([True, False, False, False]) == 25.0
    assert sv.quiet_pct([True] * 4) == 100.0


def test_recording_pct_still_and_moving():
    still = lambda i: face()  # noqa: E731
    mon, feed = _monitor_with(still)
    feed(40)  # calienta
    mon.start_recording()
    feed(40)
    assert mon.stop_recording() == 100.0
    assert mon.stop_recording() is None  # ya no graba
    shaky = lambda i: face(dx=12.0 * (1 if i % 2 else -1))  # noqa: E731
    mon, feed = _monitor_with(shaky)
    feed(40)
    mon.start_recording()
    feed(60)
    assert mon.stop_recording() == 0.0


def test_recording_before_warmup_has_no_data():
    mon, feed = _monitor_with(lambda i: face())
    mon.start_recording()
    feed(10)  # menos de una ventana: sin muestras
    assert mon.stop_recording() is None


def test_smoke_retry_sequence():
    pytest.importorskip("mediapipe")
    import spike_v2
    spike_v2.smoke_retry()


def test_instruction_for_cubre_fases():
    import spike_viewer as sv

    for ph in ("CUENTA REGRESIVA 3", "ESPERANDO QUIETUD", "TE MOVISTE: 50 %", "GRABANDO", "PROCESANDO barrido"):
        lines, _ = sv.instruction_for(ph, "noise-floor")
        assert lines and all(s.isascii() for s in lines)
    assert any("PARPADEA" in s for s in sv.instruction_for("GRABANDO", "noise-floor")[0])
    assert any("PUNTO ROJO" in s for s in sv.instruction_for("GRABANDO", "noise-floor")[0])
    img = np.zeros((200, 300, 3), np.uint8)
    sv.draw_fixation(img, "GRABANDO")
    assert img.any()
    img2 = np.zeros((200, 300, 3), np.uint8)
    sv.draw_fixation(img2, "PROCESANDO")
    assert not img2.any()
    assert sv.instruction_for("otra", "x")[0] == []


# ------------------------------------------------------------ gate en vivo: parpadeo y diagnostico
def blink_frames(n: int = 120, shift: float = 2.0) -> list[np.ndarray]:
    P = sm.make_synthetic_landmarks(n, noise_px=0.2, seed=2, blinks=[(40, 45), (90, 95)], blink_shift_px=shift)
    return list(P)


def run_gate(gp: sm.GateParams, frames: list[np.ndarray]) -> list[sv.GateStatus]:
    g = sv.LiveGate(gp)
    out = []
    for i, p in enumerate(frames):
        g.push(p, np.eye(4), i / FS)
        st = g.status()
        if st is not None:
            out.append(st)
    return out


def test_live_gate_immune_to_blink_and_legacy_is_not():
    new = run_gate(sm.GateParams(), blink_frames())
    old = run_gate(sm.GateParams(legacy=True), blink_frames())
    assert all(s.quiet for s in new)
    assert sum(not s.quiet for s in old) > 0


def test_live_gate_reports_failed_criteria():
    frames = [face(dx=(6.0 if i % 2 else 0.0)) for i in range(40)]
    st = run_gate(sm.GateParams(), frames)[-1]
    assert not st.quiet and "speed" in st.failed
    ind = {i.key: i for i in st.indicators}
    assert ind["speed"].ok is False and ind["roll"].ok is True


def test_fail_tally_and_monitor_breakdown():
    t = sv.FailTally()
    for f in (("iod", "roll"), ("iod",), (), ("iod",)):
        t.add(f)
    assert t.pct()["iod"] == 75.0 and t.pct()["roll"] == 25.0
    assert t.summary() == "criterios que fallaron: IOD 75 %, roll 25 %"
    P = face()
    state = {"i": 0}

    def infer(_f, _ts):
        state["i"] += 1
        return P + ((6.0 if state["i"] % 2 else 0.0), 0.0), np.eye(4)

    mon = sv.LiveMonitor(None, infer, sm.GateParams(), "T")
    img = np.zeros((48, 64, 3), np.uint8)
    for i in range(40):
        mon.feed(img, "ESPERANDO", now=i / FS)
    mon.start_recording()
    for i in range(40, 80):
        mon.feed(img, "GRABANDO", now=i / FS)
    pct = mon.stop_recording()
    assert pct == 0.0 and mon.last_fail.pct()["speed"] == 100.0
    assert "velocidad 100 %" in mon.last_fail.summary()


def test_capture_panel_renders_red_summary_and_two_line_note():
    frames = [face(dx=(6.0 if i % 2 else 0.0)) for i in range(40)]
    g = sv.LiveGate(sm.GateParams())
    fill(g, [(f, np.eye(4)) for f in frames])
    hud = sv.CaptureHud(mode="T", phase="TE MOVISTE", gate=g.status(), note="63 % quieto\nFallaron: IOD 70 %")
    canvas = sv.render_capture(np.zeros((480, 640, 3), np.uint8), None, hud)
    assert canvas.ndim == 3
