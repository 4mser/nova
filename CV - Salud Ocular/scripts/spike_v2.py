"""Spike v2 de Face Landmarker: barrido (--check --sweep), suelo de ruido y reporte.

Orquesta captura, inferencia y salida. La matematica pura esta en spike_metrics.py y las
degradaciones en spike_degrade.py. Cuadros e imagenes NUNCA se guardan en disco; los
landmarks crudos solo con --save-landmarks (dato biometrico).
"""
from __future__ import annotations

import hashlib
import json
import math
import platform
import subprocess
import sys
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterator, Sequence

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

import spike_degrade as sd
import spike_metrics as sm
import spike_viewer as sv

ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT / "models" / "face_landmarker.task"
RESULTS_PATH = ROOT / "docs" / "spike-resultados.md"
DATA_DIR = ROOT / "data" / "vision"
NOISE_FILE = DATA_DIR / "noise_floor.jsonl"
CONTROL_FILE = DATA_DIR / "brow_control.jsonl"
MODES = ("IMAGE", "VIDEO")
WARMUP_FRAMES = 10  # cuadros descartados al abrir la camara (autoexposicion)
MAX_RAM_BYTES = 2_000_000_000

CAN_CLAIM = [
    "### Que se puede afirmar / que NO",
    "",
    "**Se puede afirmar:** el cambio minimo detectable (MDC) de ESTA persona, ESTA camara y ESTA "
    "luz, y la caida de deteccion con roll sin compensar.",
    "",
    "**NO se puede afirmar:** precision en mm (no hay verdad de referencia; los mm son [INF] "
    "suponiendo iris de 11,7 mm); generalizacion a otras personas; validez clinica; edema; SANS; "
    "desempeno del escaner real; camara trasera; microgravedad; ni que la poca luz simulada "
    "equivalga a poca luz real. MRD1n/MRD2n son proxies: el centro del iris reemplaza al reflejo "
    "corneal.",
]


BROW_CLAIM = [
    "### Ceja (PTB): que se puede afirmar / que NO",
    "",
    "**Se puede afirmar:** el cambio minimo detectable de la distancia pupila-ceja (PTB, pupila a borde "
    "INFERIOR de la ceja segun Karlin 2021) de ESTA persona, ESTA camara y ESTA luz, en diametros de iris, "
    "con y sin el filtro de expresion, y si un gesto de ceja grande (control positivo) se detecta.",
    "",
    "**NO se puede afirmar:** precision en mm (los mm son [INF], iris 11,7 mm, sin verdad de referencia); "
    "edema ni SANS; validez en astronautas ni en otras personas; poca luz; microgravedad. La ceja esta ~10 mm "
    "[SUPUESTO] por delante del iris: hay paralaje con el pitch. Los indices de ceja son SUPUESTOS hasta "
    "confirmarlos con --brow-check. Los umbrales de ceja activa son PROVISORIOS.",
]


# ---------------------------------------------------------------- registro
@dataclass
class CamInfo:
    index: int = -1
    backend: str = "n/a"
    req_w: int | None = None
    req_h: int | None = None
    got_w: int = 0
    got_h: int = 0
    cap_fps: float = 0.0
    frame_shape: tuple[int, ...] = ()
    fps_measured: float = 0.0
    fps_median_inst: float = 0.0


def git_short_hash() -> str:
    try:
        run = lambda *a: subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True,  # noqa: E731
                                        timeout=10, check=True).stdout.strip()
        return run("rev-parse", "--short", "HEAD") + ("+cambios_sin_commit" if run("status", "--porcelain") else "")
    except (OSError, subprocess.SubprocessError):
        return "desconocido"


def model_sha256() -> str:
    return hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest() if MODEL_PATH.exists() else "n/a"


def build_registry(args: Any, cam: CamInfo, gp: sm.GateParams, running_modes: str,
                   iris_assign: dict[str, int] | None = None) -> dict[str, Any]:
    return {
        "fecha": datetime.now().isoformat(timespec="seconds"),
        "git": git_short_hash(),
        "frame_shape": list(cam.frame_shape),
        "resolucion_pedida": [cam.req_w, cam.req_h],
        "resolucion_obtenida": [cam.got_w, cam.got_h],
        "fps_medido": round(cam.fps_measured, 2),
        "fps_instantaneo_mediana": round(cam.fps_median_inst, 2),
        "cap_prop_fps": cam.cap_fps,
        "backend": cam.backend,
        "camara_indice": cam.index,
        "facing": args.facing,
        "espejo": "aplicado (--mirror, flip horizontal)" if args.mirror
        else "no aplicado (cuadro tal como lo entrega la camara)",
        "notas": args.notes,
        "sujeto": args.subject,
        "python": platform.python_version(),
        "mediapipe": mp.__version__,
        "opencv": cv2.__version__,
        "numpy": np.__version__,
        "modelo_sha256": model_sha256(),
        "running_mode": running_modes,
        "umbrales_gate": asdict(gp),
        "umbrales_parpadeo": {"parpadeo_frac": 0.6, "parpadeo_min_cuadros": 2,
                              "suelo_ruido_frac": 0.75, "suelo_ruido_pad": 3,
                              "perclos_frac": 0.2, "perclos_ventana_s": 60},
        "iris_asignado": iris_assign,
        "espera_quietud": list(getattr(args, "wait_results", [])) or "no usada",
        "captura_quietud": list(getattr(args, "capture_results", [])),
        "captura_con_movimiento": bool(getattr(args, "capture_flagged", False)),
        "min_quiet_pct": getattr(args, "min_quiet", sm.DEFAULT_MIN_QUIET),
        "max_retries": getattr(args, "max_retries", sm.DEFAULT_MAX_RETRIES),
        "euler": "Y-X-Z intrinseco, R normalizada por columnas; solo se usan rangos de yaw/pitch",
        "ceja": {"blendshapes": bool(getattr(args, "blendshapes", True)),
                 "abs": getattr(args, "brow_abs", sm.BROW_ABS_DEFAULT),
                 "rel": getattr(args, "brow_rel", sm.BROW_REL_DEFAULT), "pad": sm.BROW_PAD,
                 "filtro": not getattr(args, "no_brow_filter", False),
                 "indices_supuestos": {k: {"sup": list(b.upper), "inf": list(b.lower)}
                                       for k, b in sm.BROWS.items()}},
    }


def registry_markdown(reg: dict[str, Any]) -> list[str]:
    g = reg["umbrales_gate"]
    return [
        "**Registro**",
        "",
        f"- Fecha: {reg['fecha']}; commit: `{reg['git']}`",
        f"- frame.shape real: {tuple(reg['frame_shape'])}",
        f"- Resolucion pedida vs obtenida: {reg['resolucion_pedida']} vs {reg['resolucion_obtenida']}",
        f"- FPS medido con timestamps: {reg['fps_medido']} (mediana instantanea "
        f"{reg['fps_instantaneo_mediana']}); CAP_PROP_FPS: {reg['cap_prop_fps']}",
        f"- Backend: {reg['backend']}; indice de camara: {reg['camara_indice']}; facing: {reg['facing']}",
        f"- Espejo: {reg['espejo']}",
        f"- Notas: {reg['notas'] or '(sin notas)'}; sujeto: {reg['sujeto'] or '(sin dato)'}",
        f"- Python {reg['python']}, mediapipe {reg['mediapipe']}, opencv {reg['opencv']}, "
        f"numpy {reg['numpy']}",
        f"- Modelo sha256: `{reg['modelo_sha256']}`",
        f"- Running mode: {reg['running_mode']}",
        f"- Iris asignado por cercania a las comisuras: {reg['iris_asignado'] or 'n/a'}",
        f"- Espera de quietud antes de grabar: {reg['espera_quietud']}",
        f"- Quietud durante la captura (reintento si < {reg.get('min_quiet_pct', '?')} %, hasta "
        f"{reg.get('max_retries', '?')} reintentos): "
        f"{'; '.join(reg.get('captura_quietud', [])) or 'no medida (sin vista o no aplica)'}",
        *(["- **CAPTURA CON MOVIMIENTO: el MDC no es confiable** (ver arriba el % de quietud logrado "
           "y los intentos)."] if reg.get("captura_con_movimiento") else []),
        f"- Umbrales del gate (PROPUESTA): ventana {g['window_s']} s, velocidad < {g['speed_pct']} % "
        f"IOD/cuadro (cuantil {g['speed_quantile']}), roll < {g['roll_deg']} grados, "
        f"IOD < {g['iod_pct']} %, yaw/pitch < {g['angle_deg']} grados",
        f"- Parpadeo: EAR < 0,6 x mediana abierta durante >= 2 cuadros. Suelo de ruido: excluye "
        f"EAR < 0,75 x mediana y +-3 cuadros. Euler: {reg['euler']}",
        "",
    ]


# ---------------------------------------------------------------- camara
def open_camera_info(index: int, req_w: int | None, req_h: int | None) -> tuple[cv2.VideoCapture, CamInfo]:
    backends = [("default", cv2.CAP_ANY)]
    if sys.platform == "win32":
        backends.append(("DirectShow", cv2.CAP_DSHOW))
    for name, backend in backends:
        cap = cv2.VideoCapture(index, backend)
        if not cap.isOpened():
            cap.release()
            continue
        if req_w:
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, req_w)
        if req_h:
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, req_h)
        ok, frame = cap.read()
        if ok:
            try:
                bname = cap.getBackendName()
            except cv2.error:
                bname = name
            info = CamInfo(index=index, backend=f"{bname} (solicitado: {name})", req_w=req_w, req_h=req_h,
                           got_w=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                           got_h=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                           cap_fps=float(cap.get(cv2.CAP_PROP_FPS)), frame_shape=tuple(frame.shape))
            return cap, info
        cap.release()
    sys.exit(f"No se pudo abrir la camara {index}. Cierra otras apps que la usen, revisa permisos "
             "de camara en Windows o prueba otro indice con --cam 1.")


def print_cam(info: CamInfo) -> None:
    print(f"frame.shape real: {info.frame_shape}")
    print(f"Resolucion pedida: {info.req_w}x{info.req_h}; obtenida (CAP_PROP): "
          f"{info.got_w}x{info.got_h}; CAP_PROP_FPS: {info.cap_fps}; backend: {info.backend}")


def flush(cap: cv2.VideoCapture, n: int = WARMUP_FRAMES) -> None:
    for _ in range(n):
        cap.read()


def set_fps(info: CamInfo, ts: list[float]) -> float:
    if len(ts) >= 2 and ts[-1] > ts[0]:
        info.fps_measured = (len(ts) - 1) / (ts[-1] - ts[0])
        info.fps_median_inst = float(np.median(1.0 / np.maximum(np.diff(ts), 1e-6)))
    return info.fps_measured or 30.0


def ts_to_ms(ts: list[float]) -> list[int]:
    out: list[int] = []
    for t in ts:
        v = int((t - ts[0]) * 1000)
        out.append(v if not out or v > out[-1] else out[-1] + 1)
    return out


# ---------------------------------------------------------------- inferencia
def build_landmarker_v2(mode: str, blendshapes: bool = False) -> vision.FaceLandmarker:
    """blendshapes=True activa output_face_blendshapes (puntajes de ceja); agrega latencia: mide la
    p95 con y sin (--no-blendshapes) antes de comparar sesiones."""
    if not MODEL_PATH.exists():
        sys.exit(f"Modelo no encontrado: {MODEL_PATH}")
    rm = vision.RunningMode.IMAGE if mode == "IMAGE" else vision.RunningMode.VIDEO
    opts = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODEL_PATH)), running_mode=rm, num_faces=1,
        output_facial_transformation_matrixes=True, output_face_blendshapes=blendshapes)
    return vision.FaceLandmarker.create_from_options(opts)


@dataclass
class ModeRecord:
    """Salida de una condicion en un modo: una fila por cuadro (NaN sin deteccion)."""
    P: np.ndarray
    face: np.ndarray
    iris_ok: np.ndarray
    mats: list[np.ndarray | None]
    lat: np.ndarray
    size: tuple[int, int] = (0, 0)  # (w, h) de la imagen que entro al modelo
    roll_est: np.ndarray = field(default_factory=lambda: np.zeros(0))


def brow_blend_scores(res: Any) -> np.ndarray | None:
    """(5,) puntajes de sm.BROW_BLEND del primer rostro de un resultado de MediaPipe; None si el
    modelo no entrego blendshapes; NaN en un puntaje ausente."""
    bs = getattr(res, "face_blendshapes", None)
    if not bs:
        return None
    sc = {c.category_name: float(c.score) for c in bs[0]}
    return np.array([sc.get(n, math.nan) for n in sm.BROW_BLEND], dtype=np.float64)


def infer_frame_full(lm: vision.FaceLandmarker, mode: str, img_bgr: np.ndarray, ts_ms: int
                     ) -> tuple[np.ndarray | None, bool, bool, np.ndarray | None, float, np.ndarray | None]:
    """(P px | None, face, iris_ok, matriz | None, ms de inferencia, puntajes de ceja (5,) | None)."""
    h, w = img_bgr.shape[:2]
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    t0 = time.perf_counter()
    res = lm.detect(image) if mode == "IMAGE" else lm.detect_for_video(image, ts_ms)
    lat = (time.perf_counter() - t0) * 1000.0
    if not res.face_landmarks:
        return None, False, False, None, lat, None
    mats = res.facial_transformation_matrixes
    mat = np.asarray(mats[0]) if mats else None
    blend = brow_blend_scores(res)
    lms = res.face_landmarks[0]
    if len(lms) < sm.N_LANDMARKS:
        return None, True, False, mat, lat, blend
    arr = np.array([(p.x, p.y) for p in lms], dtype=np.float64)
    ok = bool(((arr[468:478] >= 0.0) & (arr[468:478] <= 1.0)).all())
    return (arr * (w, h) if ok else None), True, ok, mat, lat, blend


def infer_frame(lm: vision.FaceLandmarker, mode: str, img_bgr: np.ndarray, ts_ms: int
                ) -> tuple[np.ndarray | None, bool, bool, np.ndarray | None, float]:
    """(P px | None, face, iris_ok, matriz | None, ms de inferencia)."""
    return infer_frame_full(lm, mode, img_bgr, ts_ms)[:5]  # type: ignore[return-value]


def roll_estimates(rec: ModeRecord) -> np.ndarray:
    """Roll por cuadro con los ojos (grados, para contrarrotar). Sin deteccion se arrastra el
    ultimo valor; antes de la primera deteccion queda 0 (sin compensar)."""
    out = np.zeros(len(rec.P))
    last = 0.0
    for i, p in enumerate(rec.P):
        if np.isfinite(p).all():
            mr = (p[33] + p[133]) / 2
            ml = (p[362] + p[263]) / 2
            last = float(sm.roll_deg(mr[None], ml[None])[0])
        out[i] = last
    return out


def run_condition(cond: sd.Condition, frames: list[np.ndarray], ts_ms: list[int],
                  center_norm: tuple[float, float], raw: dict[str, ModeRecord] | None = None,
                  on_frame: Callable[[int, int, np.ndarray, np.ndarray | None], None] | None = None
                  ) -> dict[str, ModeRecord]:
    """Aplica la condicion a los MISMOS cuadros y los infiere en IMAGE y VIDEO (un landmarker
    por modo). Latencia = reduccion + JPEG + inferencia (+ contrarrotacion y la inferencia cruda
    en la compensada). La degradacion sintetica y la rotacion de entrada no cuentan.
    on_frame(i, n, imagen_que_entra_al_modelo_en_VIDEO, landmarks_VIDEO | None) es solo para la vista."""
    n = len(frames)
    lms = {m: build_landmarker_v2(m) for m in MODES}
    recs = {m: ModeRecord(np.full((n, sm.N_LANDMARKS, 2), np.nan), np.zeros(n, bool), np.zeros(n, bool),
                          [None] * n, np.zeros(n)) for m in MODES}
    comp = {m: roll_estimates(raw[m]) for m in MODES} if (cond.compensate and raw) else None
    h0, w0 = frames[0].shape[:2]
    center = (center_norm[0] * w0, center_norm[1] * h0)
    try:
        for i, frame in enumerate(frames):
            d = sd.degrade(frame, cond.degrade, np.random.default_rng(1000 + i))
            d = sd.rotate_reflect(d, cond.roll, center)
            t0 = time.perf_counter()
            img = sd.resize_jpeg(d, cond.width, cond.quality)
            prep = (time.perf_counter() - t0) * 1000.0
            ih, iw = img.shape[:2]
            view_x, view_p = img, None
            for m in MODES:
                x, extra = img, prep
                if comp is not None and raw is not None:
                    t1 = time.perf_counter()
                    x = sd.rotate_reflect(img, float(comp[m][i]),
                                          (center_norm[0] * iw, center_norm[1] * ih))
                    extra = raw[m].lat[i] + (time.perf_counter() - t1) * 1000.0
                p, face, ok, mat, lat = infer_frame(lms[m], m, x, ts_ms[i])
                r = recs[m]
                if p is not None:
                    r.P[i] = p
                r.face[i], r.iris_ok[i], r.mats[i] = face, ok, mat
                r.lat[i] = extra + lat
                r.size = (iw, ih)
                if m == "VIDEO":
                    view_x, view_p = x, p
            if on_frame is not None:
                on_frame(i, n, view_x, view_p)
    finally:
        for lm in lms.values():
            lm.close()
    for r in recs.values():
        r.roll_est = roll_estimates(r)
    return recs


def analyze(rec: ModeRecord, fs: float, gp: sm.GateParams) -> sm.Analysis:
    return sm.analyze_recording(rec.P, rec.face, rec.iris_ok, rec.mats, fs, gp, brow=False)  # el barrido no mide ceja


# ---------------------------------------------------------------- estadisticas por condicion
def _f(x: Any) -> float:
    return float(x) if x is not None and np.isfinite(x) else float("nan")


def condition_stats(rec: ModeRecord, an: sm.Analysis, ref_an: sm.Analysis | None) -> dict[str, Any]:
    lat = rec.lat
    st: dict[str, Any] = {
        "n": an.n, "det_pct": an.face_pct, "iris_pct": an.iris_ok_pct, "gate_pct": an.gate_pct,
        "iod_px": _f(an.iod_px), "d_px": _f(an.d_px),
        "lat_med": float(np.median(lat)), "lat_p95": float(np.percentile(lat, 95)),
        "usable": an.usable, "n_blinks": an.n_blinks, "noise": {}, "bias": {}, "proc": an.proc,
        "gated": False, "usable_frames": 0,
    }
    if not an.usable:
        return st
    mask, gated = sm.usable_mask(an)
    st["gated"], st["usable_frames"] = gated, int(mask.sum())
    st["noise"] = sm.series_noise(an, mask)
    if ref_an is not None and ref_an.usable:
        for k, x in an.series.items():
            st["bias"][k] = sm.paired_bias(x, ref_an.series[k])[0]
    return st


def eye_avg(d: dict[str, Any], base: str, key: str) -> float:
    """Promedio de ambos ojos (o la serie unica) de d[serie][key]."""
    if base in d:
        return _f(d[base][key])
    return float(np.nanmean([_f(d[f"{base}_R"][key]), _f(d[f"{base}_L"][key])]))


def eye_avg_flat(d: dict[str, float], base: str) -> float:
    if base in d:
        return _f(d[base])
    return float(np.nanmean([_f(d.get(f"{base}_R")), _f(d.get(f"{base}_L"))]))


def fmt(x: float, nd: int = 2, scale: float = 1.0) -> str:
    return "n/a" if x is None or not np.isfinite(x) else f"{x * scale:.{nd}f}"


T1_METRICS = (("EAR", "ear"), ("A", "A"), ("MRD2n", "mrd2n"), ("u", "u"), ("v", "v"), ("D/IOD", "d_iod"))


def table1(mode: str, stats: dict[str, dict[str, Any]]) -> list[str]:
    names = list(stats)
    out = [f"#### Modo {mode}", "", f"**Tabla 1a ({mode}): deteccion, gate, tamano y latencia**", "",
           "| Condicion | n | % deteccion | % iris OK | % gate | IOD px | D px | lat. mediana ms | lat. p95 ms |",
           "|---|---|---|---|---|---|---|---|---|"]
    for c in names:
        s = stats[c]
        out.append(f"| {c} | {s['n']} | {s['det_pct']:.1f} | {s['iris_pct']:.1f} | {s['gate_pct']:.1f} | "
                   f"{fmt(s['iod_px'], 1)} | {fmt(s['d_px'], 1)} | {s['lat_med']:.2f} | {s['lat_p95']:.2f} |")
    hdr = " | ".join(m for m, _ in T1_METRICS)
    out += ["", f"**Tabla 1b ({mode}): ruido de alta frecuencia sigma_hf (x1e-3, promedio de ambos ojos) "
            f"y validacion con mediana movil de 7 (cociente med7/hf)**", "",
            f"| Condicion | {hdr} | cociente med7/hf (EAR) |", "|---|" + "---|" * (len(T1_METRICS) + 1)]
    for c in names:
        n = stats[c]["noise"]
        row = [fmt(eye_avg(n, b, "sigma_hf"), 2, 1e3) if n else "n/a" for _, b in T1_METRICS]
        ratio = (eye_avg(n, "ear", "sigma_med7") / eye_avg(n, "ear", "sigma_hf")) if n else float("nan")
        out.append(f"| {c} | " + " | ".join(row) + f" | {fmt(ratio, 2)} |")
    out += ["", f"**Tabla 1c ({mode}): MDC95 entre medias de bloques de 1 s (x1e-3, promedio de ambos "
            f"ojos; * = sin gate o < 3 bloques) y residuo de Procrustes (RMS, % de IOD)**", "",
            f"| Condicion | {hdr} | MDC A (mm) [INF] | Procrustes iris | Procrustes parpados | Procrustes malla |",
            "|---|" + "---|" * (len(T1_METRICS) + 4)]
    for c in names:
        s = stats[c]
        n = s["noise"]
        flag = "" if (s["gated"] and n and min(v["n_blocks"] for v in n.values()) >= 3) else "*"
        row = [(fmt(eye_avg(n, b, "mdc95"), 2, 1e3) + flag) if n else "n/a" for _, b in T1_METRICS]
        mm = sm.to_mm(eye_avg(n, "A", "mdc95")) if n else float("nan")
        p = s["proc"]
        pr = [fmt(p.get(k, float("nan")), 3) for k in ("rms_iris", "rms_lids", "rms_mesh")]
        out.append(f"| {c} | " + " | ".join(row) + f" | {fmt(mm, 3)} | " + " | ".join(pr) + " |")
    out += ["", f"**Tabla 1d ({mode}): sesgo pareado contra REF, mediana de la diferencia (x1e-3, promedio de "
            f"ambos ojos; Procrustes iris en % de IOD)**", "",
            f"| Condicion | {hdr} | Procrustes iris (cuadro) |", "|---|" + "---|" * (len(T1_METRICS) + 1)]
    for c in names:
        b = stats[c]["bias"]
        row = [fmt(eye_avg_flat(b, base), 2, 1e3) if b else "n/a" for _, base in T1_METRICS]
        out.append(f"| {c} | " + " | ".join(row) + f" | {fmt(b.get('proc_iris', float('nan')), 3) if b else 'n/a'} |")
    return out + [""]


# ---------------------------------------------------------------- salida
def append_doc(lines: list[str]) -> None:
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not RESULTS_PATH.exists():
        RESULTS_PATH.write_text("# Resultados spike Face Landmarker\n", encoding="utf-8")
    with RESULTS_PATH.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def clean(obj: Any) -> Any:
    """Convierte a tipos JSON validos (NaN/inf -> None, numpy -> python)."""
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, (np.floating, float)):
        return float(obj) if math.isfinite(float(obj)) else None
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def acceptance(stats: dict[str, dict[str, dict[str, Any]]]) -> tuple[list[str], dict[str, bool]]:
    lines, flags = [], {}
    for m in MODES:
        s = stats[m]["REF"]
        ok_det = s["det_pct"] >= 95 and s["iris_pct"] >= 95
        ok_gate = s["gate_pct"] >= 80
        flags[f"{m}_det_iris"], flags[f"{m}_gate"] = ok_det, ok_gate
        lines.append(f"- REF 512 px q80, {m}: deteccion {s['det_pct']:.1f} % e iris OK {s['iris_pct']:.1f} % "
                     f"(>= 95 %): {'CUMPLE' if ok_det else 'NO CUMPLE'}; gate {s['gate_pct']:.1f} % "
                     f"(>= 80 %): {'CUMPLE' if ok_gate else 'NO CUMPLE'}")
    return lines, flags


# ---------------------------------------------------------------- barrido
def run_sweep(a: Any, gp: sm.GateParams) -> None:
    with view_session(a, "BARRIDO (--sweep)", gp) as (view, mon):
        try:
            _run_sweep(a, gp, view, mon)
        except sv.ViewAbort as e:
            print(abort_message(e))


def _run_sweep(a: Any, gp: sm.GateParams, view: sv.LiveView | None, mon: sv.LiveMonitor | None) -> None:
    inv = invariance_selftest()
    print(f"Prueba de invariancia (similitud conocida, tol 1e-6): "
          f"{'PASA' if inv < 1e-6 else 'FALLA'} (max dif {inv:.2e})")
    if inv >= 1e-6:
        sys.exit("La prueba de invariancia fallo; no se mide con metricas no invariantes.")
    cap, cam = open_camera_info(a.cam, a.req_width, a.req_height)
    print_cam(cam)
    n = a.frames
    need = n * int(np.prod(cam.frame_shape))
    if need > MAX_RAM_BYTES:
        cap.release()
        sys.exit(f"{n} cuadros de {cam.frame_shape} ocupan {need / 1e9:.1f} GB en RAM (> 2 GB). "
                 "Baja --frames o la resolucion con --req-width/--req-height.")
    print(f"Captura de {n} cuadros en RAM (mantente quieto, mirada al frente). No se guarda nada.")
    def record() -> tuple[list[np.ndarray], list[float]]:
        fr: list[np.ndarray] = []
        t_: list[float] = []
        beep(1)
        flush(cap)
        for _ in range(n):
            ok, f = cap.read()
            if not ok:
                break
            fr.append(cv2.flip(f, 1) if a.mirror else f)
            t_.append(time.perf_counter())
            if mon is not None:  # la vista va DESPUES de guardar el cuadro
                mon.feed(fr[-1], "GRABANDO", len(fr) / n, mon.eta(n - len(fr)))
        beep(2)
        return fr, t_

    try:
        countdown(cap, a.start_delay, "Ponte en posicion, quieto y mirando al frente. 1 pitido al empezar y 2 al terminar. Empieza en...", mon)
        (frames, ts), cap_out = capture_with_retry(a, cap, mon, "barrido", record)
    finally:
        cap.release()
    if len(frames) < 3 * max(1, int(cam.cap_fps or 30)):
        sys.exit(f"Solo {len(frames)} cuadros capturados; el barrido necesita al menos ~3 s.")
    cam.frame_shape = tuple(frames[0].shape)
    fs = set_fps(cam, ts)
    ts_ms = ts_to_ms(ts)
    print(f"FPS medido con timestamps: {fs:.2f}")
    conds = sd.build_conditions(frames[0].shape[1])
    stats: dict[str, dict[str, dict[str, Any]]] = {m: {} for m in MODES}
    recs: dict[str, dict[str, ModeRecord]] = {}
    ref_an: dict[str, sm.Analysis] = {}
    center = (0.5, 0.5)
    iris_assign: dict[str, int] | None = None
    panel = sv.ProcessPanel(view, "PROCESANDO barrido", len(conds))
    for ci, cond in enumerate(conds, 1):
        t0 = time.perf_counter()
        raw = recs.get(cond.name.replace("_comp", "_bruto")) if cond.compensate else None
        panel.update(ci, cond.name, 0.0, force=True)
        r = run_condition(cond, frames, ts_ms, center, raw, on_frame=panel.frame_cb(ci, cond.name))
        recs[cond.name] = r
        for m in MODES:
            an = analyze(r[m], fs, gp)
            if cond.name == "REF":
                ref_an[m] = an
                if an.usable:
                    iris_assign = iris_assign or an.iris_assign
            stats[m][cond.name] = condition_stats(r[m], an, ref_an.get(m))
        if cond.name == "REF":
            pts = r["VIDEO"].P[r["VIDEO"].iris_ok]
            if len(pts):
                c = np.nanmean(pts, axis=1)
                w, h = r["VIDEO"].size
                center = (float(np.median(c[:, 0]) / w), float(np.median(c[:, 1]) / h))
            else:
                print("AVISO: REF sin detecciones; el roll gira sobre el centro del cuadro.")
        s = stats["VIDEO"][cond.name]
        panel.add_row(cond.name, s["det_pct"], s["iris_pct"], s["lat_med"])
        print(f"[{ci}/{len(conds)}] {cond.name}: det {s['det_pct']:.0f} %, iris {s['iris_pct']:.0f} %, "
              f"lat {s['lat_med']:.1f} ms ({time.perf_counter() - t0:.0f} s)")
    reg = build_registry(a, cam, gp, "IMAGE y VIDEO (un landmarker por condicion y modo)", iris_assign)
    if cap_out.flagged:
        print(f"\n!!! {cap_out.text}")
    acc, flags = acceptance(stats)
    lines = [f"\n## Check v2 con barrido ({datetime.now():%Y-%m-%d %H:%M})\n", *registry_markdown(reg),
             f"Cuadros: {len(frames)} capturados una sola vez en RAM; todas las condiciones se aplican "
             f"a los mismos cuadros (comparacion pareada). Ruta: degradar a resolucion nativa, rotar "
             f"(centro de la cara, borde reflejado), reducir con INTER_AREA, JPEG. Roll COMPENSADO: "
             f"se estima con los ojos del resultado crudo, se contrarrota el JPEG decodificado y se "
             f"reinfiere (sin deteccion cruda se arrastra el ultimo roll). Latencia = reduccion + JPEG "
             f"+ inferencia (+ contrarrotacion y la inferencia cruda en la compensada).",
             "MRD1n/MRD2n son proxies: el centro del iris reemplaza al reflejo corneal. Unidades "
             "normalizadas: A, MRD en diametros de iris (escala S_t = IOD_t x mediana(D)/mediana(IOD)), "
             "u/v en anchos de ojo, EAR y D/IOD sin unidad. Los mm son [INF] (iris 11,7 mm).", "",
             "### Tabla 1 por condicion", ""]
    for m in MODES:
        lines += table1(m, stats[m])
    lines += ["**Aceptacion**", "",
              "- Resolucion impresa y registrada: SI",
              f"- Prueba de invariancia a similitud (tol 1e-6): PASA (max dif {inv:.1e})", *acc, "",
              *CAN_CLAIM, ""]
    append_doc(lines)
    print("\n".join(["\n=== Aceptacion ===", *acc]))
    print(f"\nEscrito en {RESULTS_PATH}")
    if a.json or a.save_landmarks:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    if a.json:
        p = DATA_DIR / f"sweep_{stamp()}.json"
        p.write_text(json.dumps(clean({"registro": reg, "estadisticas": stats, "aceptacion": flags}),
                                indent=1), encoding="utf-8")
        print(f"JSON (solo metricas) en {p}")
    if a.save_landmarks:
        p = DATA_DIR / f"landmarks_{stamp()}.npz"
        np.savez_compressed(p, **{f"{c}__{m}": r[m].P.astype(np.float32) for c, r in recs.items() for m in MODES})
        print(f"AVISO: landmarks crudos (dato biometrico) en {p}")
    if view is not None:
        view.show_final("BARRIDO: RESUMEN", sweep_summary(stats, flags, capture_summary(a)))


def sweep_summary(stats: dict[str, dict[str, dict[str, Any]]], flags: dict[str, bool],
                  capture_lines: Sequence[str] = ()) -> list[str]:
    """Lineas del panel final (referencia REF 512 px q80): aceptacion, latencia y ruido de A."""
    lines = [f"Referencia REF ({sd.REF_WIDTH} px, JPEG q{sd.REF_QUALITY}); {RESULTS_PATH.name} actualizado",
             *capture_lines, ""]
    for m in MODES:
        s = stats[m]["REF"]
        lines.append(f"{m}: deteccion {s['det_pct']:.1f} %, iris OK {s['iris_pct']:.1f} %: "
                     f"{'CUMPLE' if flags[f'{m}_det_iris'] else 'NO CUMPLE'} (>= 95 %)")
        lines.append(f"{m}: gate de quietud {s['gate_pct']:.1f} %: "
                     f"{'CUMPLE' if flags[f'{m}_gate'] else 'NO CUMPLE'} (>= 80 %)")
        lines.append(f"{m}: latencia mediana {s['lat_med']:.1f} ms, p95 {s['lat_p95']:.1f} ms")
        n = s["noise"]
        if n:
            sig = eye_avg(n, "A", "sigma_hf")
            gated = s["gated"] and min(v["n_blocks"] for v in n.values()) >= 3
            mdc = eye_avg(n, "A", "mdc95")
            lines.append(f"{m}: ruido de A sigma_hf {fmt(sig, 4)} diam. iris; "
                         + (f"MDC95 {fmt(mdc, 4)} ({fmt(sm.to_mm(mdc), 3)} mm [INF])" if gated
                            else "MDC95 no valido (sin gate o < 3 bloques)"))
        else:
            lines.append(f"{m}: sin ruido calculable (REF no utilizable)")
        lines.append("")
    lines.append("MRD1n/MRD2n son proxies; los mm son [INF] (iris 11,7 mm). No es validacion clinica.")
    return lines


def invariance_selftest() -> float:
    """Aplica una similitud conocida (distinta por cuadro y una global) a landmarks sinteticos
    y devuelve la maxima diferencia en las metricas 1 a 3."""
    P = sm.make_synthetic_landmarks(60, noise_px=0.4, seed=3)
    base = sm.invariance_metrics(P)
    glob = sm.apply_known_similarity(P, 1.7, 23.0, (35.0, -12.0))
    rng = np.random.default_rng(1)
    per = np.stack([sm.apply_known_similarity(P[i:i + 1], float(rng.uniform(0.5, 2)),
                                              float(rng.uniform(-40, 40)), (float(i), 2.0 * i))[0]
                    for i in range(len(P))])
    return float(max(np.max(np.abs(sm.invariance_metrics(x) - base)) for x in (glob, per)))


# ---------------------------------------------------------------- suelo de ruido
def beep(times: int = 1) -> None:
    """Aviso sonoro (solo Windows); no hace nada si no esta disponible."""
    try:
        import winsound

        for _ in range(times):
            winsound.Beep(1000, 200)
    except Exception:
        pass


def countdown(cap: cv2.VideoCapture, seconds: int, msg: str, mon: sv.LiveMonitor | None = None,
              label: str | None = None) -> None:
    """Cuenta regresiva (cuadros solo a la vista, no se guardan). label: texto de la fase en la vista
    (p. ej. 'NEUTRAL': muestra la instruccion de la fase que viene); por defecto 'CUENTA REGRESIVA'."""
    print(msg)
    end = time.perf_counter() + seconds
    shown = -1
    while time.perf_counter() < end:
        ok, f = cap.read()  # drena el buffer de la camara
        left = math.ceil(end - time.perf_counter())
        if left != shown:
            shown = left
            print(f"  {left}...", flush=True)
        if mon is not None and ok:
            mon.feed(f, f"{label} EN {left}" if label else f"CUENTA REGRESIVA {left}", 1.0 - (end - time.perf_counter()) / seconds,
                     end - time.perf_counter(), raw=True)


# ---------------------------------------------------------------- vista en vivo
def open_view(a: Any) -> sv.LiveView | None:
    """Ventana si --view (default); None con --no-view o sin entorno grafico (degrada a texto)."""
    if not getattr(a, "view", True):
        return None
    return sv.LiveView.open(getattr(a, "view_scale", 1.0), getattr(a, "view_hold", 0.0))


def make_viz_infer(blendshapes: bool = False) -> tuple[sv.InferFn, Callable[[], None]]:
    """Landmarker de visualizacion (modo VIDEO) SEPARADO del de captura/analisis. Con blendshapes
    devuelve (P, matriz, puntajes de ceja) para el bloque CEJA de la vista."""
    lm = build_landmarker_v2("VIDEO", blendshapes)

    def infer(frame: np.ndarray, ts_ms: int) -> tuple[object, ...]:
        p, _face, _ok, mat, _lat, bs = infer_frame_full(lm, "VIDEO", frame, ts_ms)
        return (p, mat, bs) if blendshapes else (p, mat)

    return infer, lm.close


@contextmanager
def view_session(a: Any, mode: str, gp: sm.GateParams, brow_view: bool = True, blendshapes: bool = False
                 ) -> Iterator[tuple[sv.LiveView | None, sv.LiveMonitor | None]]:
    """(vista, monitor) o (None, None). Cierra landmarker de vista y ventana al salir. brow_view:
    dibuja las cejas (verde sup., rojo inf.) y el bloque CEJA; blendshapes: puntajes en la vista."""
    view = open_view(a)
    mon: sv.LiveMonitor | None = None
    try:
        if view is not None:
            infer, close_fn = make_viz_infer(blendshapes)
            mon = sv.LiveMonitor(view, infer, gp, mode, capture_mirror=bool(a.mirror), close_fn=close_fn,
                                 brow_view=brow_view, brow_numbers=bool(getattr(a, "brow_numbers", False)),
                                 bp=brow_params(a))
        yield view, mon
    finally:
        if mon is not None:
            mon.close()
        if view is not None:
            view.close()


def brow_params(a: Any) -> sm.BrowParams:
    """Umbrales de ceja activa de los flags (--brow-abs, --brow-rel, --no-brow-filter)."""
    return sm.BrowParams(abs_thr=float(getattr(a, "brow_abs", sm.BROW_ABS_DEFAULT)),
                         rel_thr=float(getattr(a, "brow_rel", sm.BROW_REL_DEFAULT)),
                         enabled=not getattr(a, "no_brow_filter", False))


def abort_message(e: Exception) -> str:
    return (f"\nABORTADO por el usuario ({e}). Camara liberada; NO se escribio ningun resultado "
            "(ni parcial) en docs/ ni data/.")


def wait_still(cap: cv2.VideoCapture, mon: sv.LiveMonitor | None, a: Any) -> str:
    """Tras la cuenta regresiva: espera a que el gate lleve >= 1,5 s seguidos en verde (maximo
    --wait-still-timeout s). Si vence, avisa y sigue. El resultado queda en a.wait_results."""
    if mon is None or not getattr(a, "wait_still", True):
        return "desactivada"
    waiter = sv.StillWaiter(sv.STILL_HOLD_S, a.wait_still_timeout)
    print("Esperando quietud (el gate debe estar en verde 1,5 s seguidos)...", flush=True)
    t_start = time.perf_counter()
    tally = sv.FailTally()
    while True:
        ok, f = cap.read()
        if not ok:
            res = "sin_camara"
            break
        now = time.perf_counter()
        mon.feed(f, "ESPERANDO QUIETUD", waiter.green_s(now) / sv.STILL_HOLD_S,
                 max(0.0, a.wait_still_timeout - waiter.elapsed(now)), raw=True,
                 note="Quieto, mirada al frente", now=now)
        if mon.status is not None:
            tally.add(mon.status.failed)
        state = waiter.update(mon.quiet(), time.perf_counter())
        if state != "waiting":
            res = state
            break
    waited = time.perf_counter() - t_start
    if res == "ready":
        msg = f"quietud lograda tras {waited:.1f} s de espera"
    elif res == "timeout":
        msg = f"VENCIO el tiempo ({a.wait_still_timeout:g} s) sin quietud sostenida: se graba igual"
        why = tally.summary("ventanas en rojo durante la espera")
        msg += f" ({why})" if why else ""
        print(f"AVISO: {msg}.", flush=True)
    else:
        msg = "la camara dejo de entregar cuadros durante la espera"
    if res == "ready":
        why = tally.summary("ventanas en rojo durante la espera")
        print(f"  {msg}" + (f" ({why})" if why and waited > 3.0 else "") + ".", flush=True)
    if not hasattr(a, "wait_results"):
        a.wait_results = []
    a.wait_results.append(msg)
    return res


@dataclass
class CaptureOutcome:
    label: str
    attempts: int
    quiet_pct: float | None
    flagged: bool
    text: str


def quiet_notice(cap: cv2.VideoCapture, mon: sv.LiveMonitor, pct: float | None, nxt: int, total: int,
                 secs: float = 2.5, fail: sv.FailTally | None = None) -> None:
    """3 pitidos y aviso en consola y ventana (siguen entrando cuadros: drena el buffer). Si hay
    `fail`, dice QUE criterios rechazaron mas ventanas (p. ej. 'IOD 70 %, roll 35 %')."""
    head = f"{sv.fmt_num(pct, 0)} % quieto, repito: intento {nxt} de {total}"
    why = fail.summary("criterios que fallaron") if fail is not None else ""
    print(f"TE MOVISTE: {head}" + (f" | {why}" if why else " | sin ventanas medidas"), flush=True)
    short = fail.summary("Fallaron") if fail is not None else ""
    note = head + (f"\n{short}" if short else "")
    beep(3)
    end = time.perf_counter() + secs
    while time.perf_counter() < end:
        ok, f = cap.read()
        if not ok:
            break
        mon.feed(f, "TE MOVISTE", None, max(0.0, end - time.perf_counter()), raw=True,
                 note=note)


def capture_with_retry(a: Any, cap: cv2.VideoCapture, mon: sv.LiveMonitor | None, label: str,
                       record_fn: Callable[[], Any]) -> tuple[Any, CaptureOutcome]:
    """Espera de quietud + captura; si el % de ventanas en verde durante lo grabado es < --min-quiet,
    descarta lo capturado (RAM) y repite hasta --max-retries veces (retry_decision decide). Sin
    vista (mon None) no hay gate: una sola captura. Anota el resultado en a.capture_results."""
    results: list[str] = getattr(a, "capture_results", None) or []
    a.capture_results = results
    max_retries, min_quiet = getattr(a, "max_retries", 0), getattr(a, "min_quiet", sm.DEFAULT_MIN_QUIET)
    attempt = 1
    while True:
        wait_still(cap, mon, a)
        if mon is not None:
            mon.start_recording()
        result = record_fn()
        if mon is None:
            if not getattr(a, "_no_view_warned", False):
                print("AVISO: sin vista no hay gate en vivo: --min-quiet / --max-retries solo actuan con vista; "
                      "la quietud durante la captura no se mide.", flush=True)
                a._no_view_warned = True
            text = f"{label}: quietud durante la captura no medida (sin vista)"
            results.append(text)
            return result, CaptureOutcome(label, 1, None, False, text)
        pct = mon.stop_recording()
        why = mon.last_fail.summary("criterios que fallaron")
        dec = sm.retry_decision(pct, attempt, max_retries, min_quiet)
        if dec != sm.RETRY:
            break
        result = None  # descarta lo capturado en el intento fallido
        attempt += 1
        quiet_notice(cap, mon, pct, attempt, max_retries + 1, fail=mon.last_fail)
    shown = "sin dato" if pct is None else f"{pct:.1f} %"
    if dec == sm.FLAG:
        text = (f"{label}: CAPTURA CON MOVIMIENTO: el MDC no es confiable ({shown} quieto < {min_quiet:g} % "
                f"tras {attempt} intento(s)" + (f"; {why}" if why else "") + ")")
        a.capture_flagged = True
    else:
        text = f"{label}: {attempt} intento(s), quietud {shown} (minimo {min_quiet:g} %)"
    print(f"  {'!!! Se continua igual' if dec == sm.FLAG else 'Captura aceptada'}: {text}", flush=True)
    results.append(text)
    return result, CaptureOutcome(label, attempt, pct, dec == sm.FLAG, text)


def capture_summary(a: Any) -> list[str]:
    """Lineas para el panel final: intentos y quietud; el aviso de movimiento va aparte, en rojo."""
    res = list(getattr(a, "capture_results", []))
    out = [f"Captura: {r}" for r in res if "MOVIMIENTO" not in r]
    if getattr(a, "capture_flagged", False):
        out.append("CAPTURA CON MOVIMIENTO: el MDC no es confiable")
        out += [r for r in res if "MOVIMIENTO" in r]
    return out


def infer_jpeg_block(data: Sequence[bytes], ts: Sequence[float], blendshapes: bool,
                     on_frame: Callable[[int, int, np.ndarray, np.ndarray | None], None] | None = None
                     ) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[np.ndarray | None],
                                np.ndarray | None, np.ndarray]:
    """Infiere en modo VIDEO un bloque de cuadros JPEG (ruta 512 px q80). Devuelve (P, face,
    iris_ok, matrices, puntajes de ceja (T,5) NaN sin dato | None sin blendshapes, latencias ms)."""
    n = len(data)
    ms = ts_to_ms(list(ts))
    P = np.full((n, sm.N_LANDMARKS, 2), np.nan)
    face = np.zeros(n, bool)
    iris = np.zeros(n, bool)
    mats: list[np.ndarray | None] = [None] * n
    blend = np.full((n, len(sm.BROW_BLEND)), np.nan) if blendshapes else None
    lats = np.zeros(n)
    lm = build_landmarker_v2("VIDEO", blendshapes)
    try:
        for i, buf in enumerate(data):
            img = sd.jpeg_decode(buf)
            p, fc, ok, mat, lat, bs = infer_frame_full(lm, "VIDEO", img, ms[i])
            lats[i] = lat
            if p is not None:
                P[i] = p
            if blend is not None and bs is not None:
                blend[i] = bs
            face[i], iris[i], mats[i] = fc, ok, mat
            if on_frame is not None:
                on_frame(i, n, img, p)
    finally:
        lm.close()
    return P, face, iris, mats, blend, lats


def run_noise_floor(a: Any, gp: sm.GateParams) -> None:
    if a.session_id is None:
        sys.exit("--noise-floor requiere --session-id N (repite con otro N tras reposicionar).")
    with view_session(a, f"SUELO DE RUIDO s{a.session_id}", gp) as (view, mon):  # vista con cejas
        try:
            _run_noise_floor(a, gp, view, mon)
        except sv.ViewAbort as e:
            print(abort_message(e))


def _run_noise_floor(a: Any, gp: sm.GateParams, view: sv.LiveView | None, mon: sv.LiveMonitor | None) -> None:
    cap, cam = open_camera_info(a.cam, a.req_width, a.req_height)
    print_cam(cam)
    print(f"""
==================== PROTOCOLO (sesion {a.session_id}) ====================
ANTES DE EMPEZAR
  1. Monitor a ~50 cm. Cabeza APOYADA (respaldo o una mano en la sien), mismo lugar y luz.
  2. Cuando abra la ventana, subela al borde superior de la pantalla, pegada a la camara.
EN CADA BLOQUE ({a.blocks} bloques de {a.block_seconds:.0f} s)
  - Mira el PUNTO ROJO de arriba todo el tiempo (no tu cara ni el texto).
  - Quieto: sin mover la cabeza, sin hablar.
  - PARPADEA NORMAL, no te aguantes.
  - 1 pitido = empieza a grabar. 2 pitidos = termino el bloque. 3 pitidos = te moviste, se repite.
  - En los 5 s entre bloques puedes relajar el cuello.
ENTRE SESIONES (importante)
  - Levantate, camina un poco y vuelve a sentarte COMO LO HARIAS NORMALMENTE.
  - No busques quedar distinto ni identico: esa variacion natural es lo que se mide (sigma_b).
  - Si te quedas sentado sin moverte, el cambio minimo detectable sale demasiado optimista.
  - Usa un --session-id distinto cada vez. q o ESC aborta sin guardar nada.
====================================================================""")
    blocks: list[tuple[list[bytes], list[float]]] = []
    try:
        # Nunca se usa input(): bajo `!` no hay teclado aunque stdin parezca una terminal.
        countdown(cap, a.start_delay, f"\nEmpieza en {a.start_delay} s, ponte en posicion. "
                  "Sonara 1 pitido al empezar y 2 al terminar cada bloque.", mon)
        for b in range(a.blocks):
            if mon is not None:
                mon.set_block(b + 1, a.blocks)
            countdown(cap, a.countdown, f"\nBloque {b + 1}/{a.blocks}: fija la mirada, empieza en...", mon)
            def record() -> tuple[list[bytes], list[float], tuple[int, ...] | None]:
                print(f"  GRABANDO {a.block_seconds:.0f} s (no se guardan imagenes)", flush=True)
                beep(1)
                d_: list[bytes] = []
                t_: list[float] = []
                shape: tuple[int, ...] | None = None
                end = time.perf_counter() + a.block_seconds
                while time.perf_counter() < end:
                    ok, f = cap.read()
                    if not ok:
                        break
                    f = cv2.flip(f, 1) if a.mirror else f
                    shape = tuple(f.shape)
                    d_.append(sd.jpeg_encode(sd.shrink(f, sd.REF_WIDTH), sd.REF_QUALITY))
                    t_.append(time.perf_counter())
                    if mon is not None:  # la vista va DESPUES de guardar el cuadro
                        left = max(0.0, end - time.perf_counter())
                        mon.feed(f, "GRABANDO", 1.0 - left / a.block_seconds, left)
                beep(2)
                return d_, t_, shape

            (data, ts, shp), _out = capture_with_retry(a, cap, mon, f"bloque {b + 1}", record)
            cam.frame_shape = shp if (data and shp) else cam.frame_shape
            blocks.append((data, ts))
            print("  listo.", flush=True)
    finally:
        cap.release()
    all_ts = [t for _, ts in blocks for t in ts]
    fs = float(np.median([(len(ts) - 1) / (ts[-1] - ts[0]) for _, ts in blocks if len(ts) > 1] or [30.0]))
    cam.fps_measured, cam.fps_median_inst = fs, fs
    print(f"\nProcesando (ruta 512 px, JPEG q{sd.REF_QUALITY}, modo VIDEO). FPS medido: {fs:.2f}")
    analyses: list[sm.Analysis] = []
    saved: dict[str, np.ndarray] = {}
    bp = brow_params(a)
    use_bs = bool(getattr(a, "blendshapes", True))
    all_lats: list[float] = []
    panel = sv.ProcessPanel(view, "PROCESANDO suelo de ruido (bloques)", len(blocks))
    for bi, (data, ts) in enumerate(blocks):
        panel.update(bi + 1, f"bloque {bi + 1}/{len(blocks)}", 0.0, force=True)
        P, face, iris, mats, blend, lats = infer_jpeg_block(
            data, ts, use_bs, lambda i, n, img, p, bi=bi: panel.update(
                bi + 1, f"bloque {bi + 1}/{len(blocks)}", (i + 1) / n, img, p, detail=f"cuadro {i + 1}/{n}"))
        all_lats += list(lats)
        try:
            an = sm.analyze_recording(P, face, iris, mats, (len(ts) - 1) / (ts[-1] - ts[0]), gp, blend, bp)
        except ValueError as e:
            sys.exit(f"ABORTADO: {e}")
        panel.add_row(f"bloque {bi + 1}", an.face_pct, an.iris_ok_pct, float(np.median(lats)) if len(lats) else 0.0)
        analyses.append(an)
        saved[f"bloque{bi + 1}"] = P.astype(np.float32)
        print(f"  bloque {bi + 1}: {len(data)} cuadros, deteccion {an.face_pct:.0f} %, "
              f"gate {an.gate_pct:.0f} %, parpadeos {an.n_blinks}")
    try:
        summ = sm.session_summary(analyses, bp)
    except ValueError as e:
        sys.exit(f"Sesion inutil: {e}. Revisa luz y distancia y repite.")
    assign = next(an.iris_assign for an in analyses if an.usable)
    reg = build_registry(a, cam, gp, "VIDEO", assign)
    lat_stats = ({"lat_median_ms": float(np.median(all_lats)), "lat_p95_ms": float(np.percentile(all_lats, 95))}
                 if all_lats else {})
    rec = {"session_id": a.session_id, "timestamp": reg["fecha"], "registro": reg,
           "ruta": f"{sd.REF_WIDTH} px, JPEG q{sd.REF_QUALITY}", **lat_stats, **summ}
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with NOISE_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(clean(rec)) + "\n")
    print(f"\nResumen (solo metricas) agregado a {NOISE_FILE}")
    if getattr(a, "capture_flagged", False):
        print("!!! CAPTURA CON MOVIMIENTO: el MDC no es confiable (bloques marcados arriba)")
    m = summ["metrics"]  # type: ignore[index]
    print(f"Cuadros {summ['n_frames']}, gate {summ['gate_pct']:.1f} %, bloques de 1 s por serie: "
          f"{min(v['n_blocks'] for v in m.values())} (min)")
    for base in ("ear", "A", "mrd2n"):
        print(f"  {base}: sigma_w R {m[base + '_R']['sigma_w']:.5f}, L {m[base + '_L']['sigma_w']:.5f}")
    for base in ("ptb_inf", "brow_th"):
        print(f"  {base}: sigma_w R {m[base + '_R']['sigma_w']:.5f}, L {m[base + '_L']['sigma_w']:.5f} "
              f"(sin filtro de ceja R {m[base + '_R']['sigma_w_nf']:.5f}, L {m[base + '_L']['sigma_w_nf']:.5f})")
    br = summ["brow"]  # type: ignore[index]
    print(f"  ceja activa: {fmt(br['active_pct'], 1)} % de los cuadros utilizables ({fmt(br['excl_pct'], 1)} % "
          f"excluidos con +-{sm.BROW_PAD} cuadros; filtro {'ACTIVO' if br['filter'] else 'DESACTIVADO'}); "
          f"blendshapes {'si' if br['has_blend'] else 'NO (sin puntajes: no se filtra)'}")
    if all_lats:
        print(f"  latencia de inferencia (blendshapes {'ON' if use_bs else 'OFF'}): mediana "
              f"{lat_stats['lat_median_ms']:.1f} ms, p95 {lat_stats['lat_p95_ms']:.1f} ms")
    print("Repite con otro --session-id tras reposicionarte; con >= 3 sesiones usa --noise-floor-report.")
    if a.save_landmarks:
        p = DATA_DIR / f"landmarks_noise_s{a.session_id}_{stamp()}.npz"
        np.savez_compressed(p, **saved)
        print(f"AVISO: landmarks crudos (dato biometrico) en {p}")
    if view is not None:
        sw = lambda b: (m[b + "_R"]["sigma_w"], m[b + "_L"]["sigma_w"])  # noqa: E731
        lines = [f"Sesion {a.session_id}: {summ['n_frames']} cuadros, gate {summ['gate_pct']:.1f} %, "
                 f"{min(v['n_blocks'] for v in m.values())} bloques de 1 s por serie (min)",
                 f"Bloques utilizables: {summ['n_blocks_usable']}/{summ['n_blocks_recorded']}", ""]
        for base, name in (("ear", "EAR"), ("A", "A (diam. iris)"), ("mrd2n", "MRD2n proxy"),
                           ("ptb_inf", "PTB_inf (diam. iris)"), ("brow_th", "brow_th (diam. iris)")):
            r, l_ = sw(base)
            lines.append(f"{name}: sigma_w R {fmt(r, 5)}, L {fmt(l_, 5)}; MDC95 intra-sesion "
                         f"R {fmt(sm.mdc95(r), 5)}, L {fmt(sm.mdc95(l_), 5)}")
        lines += ["", f"Ceja activa excluida: {fmt(br['excl_pct'], 1)} % (filtro "
                  f"{'ACTIVO' if br['filter'] else 'DESACTIVADO'}; umbrales PROVISORIOS)", ""]
        lines += ["", *capture_summary(a), "", f"Resumen agregado a data/vision/{NOISE_FILE.name} (solo metricas).",
                  "Repite con otro --session-id tras reposicionarte; con >= 3 usa --noise-floor-report.",
                  "El MDC con reposicionamiento (sigma_b) solo sale con >= 3 sesiones."]
        view.show_final("SUELO DE RUIDO: RESUMEN", lines)


def load_sessions(path: Path | None = None) -> list[dict[str, Any]]:
    path = path or NOISE_FILE
    if not path.exists():
        sys.exit(f"No existe {path}. Corre antes --noise-floor --session-id N.")
    latest: dict[Any, dict[str, Any]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            latest[r["session_id"]] = r  # la ultima corrida de cada id manda
    return list(latest.values())


T2_LABELS = {"ear": "EAR", "A": "A (diam. iris)", "mrd2n": "MRD2n proxy (diam. iris)",
             "mrd1n": "MRD1n proxy (diam. iris)", "u": "u (ancho de ojo)", "v": "v (ancho de ojo)",
             "ptb_inf": "PTB_inf = pupila a ceja INF (diam. iris) PRINCIPAL",
             "ptb_sup": "PTB_sup = pupila a ceja SUP (diam. iris)",
             "brow_fis": "brow_fis = parpado a ceja INF (diam. iris)",
             "brow_th": "brow_th = SUP - INF, grosor (diam. iris)",
             "ptb_inf1": "PTB_inf landmark unico 52/282 (control)",
             "ptb_sup1": "PTB_sup landmark unico 105/334 (control)",
             "ptb_inf_lat": "PTB_inf lateral 46/276 (opcional)",
             "ptb_inf_med": "PTB_inf medial 55/285 (opcional)"}
T2_MM = ("A", "mrd2n", "mrd1n") + sm.BROW_SERIES_EYE


def table2(agg: dict[str, dict[str, float]], records: Sequence[dict[str, Any]] | None = None) -> list[str]:
    """Tabla 2. Las series ausentes en agg (p. ej. PTB con sesiones viejas) se omiten. Columnas de
    ceja: MDC95 con reposicionamiento SIN filtro de expresion (mm [INF]), % de cuadros excluidos por
    ceja activa (media de sesiones) y pendiente PTB_inf-pitch (entre bloques / entre sesiones)."""
    out = ["| Metrica | Ojo | media | sigma_w | sigma_b | MDC95 intra-sesion | MDC95 con reposicionamiento | "
           "MDC95 repos. (mm) [INF] | MDC95 repos. SIN filtro ceja (mm) [INF] | % cuadros excl. por ceja | "
           "pendiente PTB-pitch (mm/grado) [INF] |", "|---|---|---|---|---|---|---|---|---|---|---|"]
    recs = list(records or [])
    ex = sm.brow_excl_pcts(recs)
    ex_txt = f"{np.mean(ex):.1f}" if ex else "n/a"
    sl = sm.pitch_slopes(recs) if recs else {"blocks_mm_deg": math.nan, "sessions_mm_deg": math.nan}
    sl_txt = f"{fmt(sl['blocks_mm_deg'], 3)} bloques / {fmt(sl['sessions_mm_deg'], 3)} sesiones"
    rows = [(T2_LABELS[b], e, f"{b}_{e}", b in T2_MM, b) for b in T2_LABELS for e in ("R", "L")]
    rows.append(("D/IOD", "-", "d_iod", False, "d_iod"))
    for label, eye, key, mm, base in rows:
        if key not in agg:
            continue
        s = agg[key]
        mmv = fmt(sm.to_mm(s["mdc95_repos"]), 3) if mm else "-"
        is_brow = base in sm.BROW_SERIES_EYE
        nf = fmt(sm.to_mm(s["mdc95_repos_nf"]), 3) if is_brow and "mdc95_repos_nf" in s else "-"
        out.append(f"| {label} | {eye} | {s['mean']:.4f} | {s['sigma_w']:.5f} | {s['sigma_b']:.5f} | "
                   f"{s['mdc95_within']:.5f} | {s['mdc95_repos']:.5f} | {mmv} | {nf} | "
                   f"{ex_txt if is_brow else '-'} | {sl_txt if base == 'ptb_inf' else '-'} |")
    return out


def load_control(path: Path | None = None) -> dict[str, Any] | None:
    """Ultimo registro de --brow-control (solo numeros) o None."""
    path = path or CONTROL_FILE
    if not path.exists():
        return None
    last = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            last = json.loads(line)
    return last


def brow_report_lines(agg: dict[str, dict[str, float]], recs: Sequence[dict[str, Any]],
                      control: dict[str, Any] | None) -> list[str]:
    """Avisos de sesiones viejas + criterios de aceptacion de PTB_inf + que se puede afirmar."""
    out: list[str] = []
    old = sm.sessions_without(recs, "ptb_inf_R")
    if old:
        out += [f"AVISO: las sesiones {old} NO tienen series de ceja (PTB, brow_*): son anteriores a la ceja; "
                f"se ignoran SOLO para esas series (el resto de la tabla las usa)."]
    miss = sm.missing_series(recs, agg)
    if any(n in sm.BROW_SERIES for n in miss):
        out += ["AVISO: con menos de 3 sesiones con ceja no hay MDC de PTB (series omitidas: "
                f"{sorted(n for n in miss if n in sm.BROW_SERIES)[:4]}...). Graba >= 3 sesiones nuevas."]
    out += ["", "### Criterios de aceptacion de PTB_inf (umbrales PROVISORIOS; mm [INF], iris 11,7 mm)", ""]
    for name, verdict, detail in sm.brow_acceptance(agg, recs, control):
        out.append(f"- {name}: **{verdict}**: {detail}")
    if control is not None:
        out += ["", f"Control positivo ({control.get('timestamp', '?')}): {control.get('summary', '')}"]
    out += ["", *BROW_CLAIM]
    return out


def run_noise_floor_report(a: Any) -> None:
    recs = load_sessions()
    excl = {int(x) for x in str(getattr(a, 'exclude_sessions', '') or '').replace(' ', '').split(',') if x}
    if excl:
        print(f"Sesiones excluidas por el usuario: {sorted(excl)}")
        recs = [r for r in recs if r['session_id'] not in excl]
    if len(recs) < 3:
        sys.exit(f"Hay {len(recs)} sesion(es) en {NOISE_FILE}; se necesitan >= 3 con reposicionamiento.")
    shapes = {tuple(r["registro"]["resolucion_obtenida"]) for r in recs}
    if len(shapes) > 1:
        print(f"AVISO: las sesiones tienen resoluciones distintas: {shapes}")
    agg = sm.aggregate_sessions(recs)
    reg = recs[-1]["registro"]
    moved = sorted(r["session_id"] for r in recs if r["registro"].get("captura_con_movimiento"))
    moved_lines = ([f"**CAPTURA CON MOVIMIENTO: el MDC no es confiable** en las sesiones {moved} "
                    f"(quietud < minimo tras agotar los reintentos; detalle en el registro de cada sesion).", ""]
                   if moved else [])
    if moved:
        print(f"!!! CAPTURA CON MOVIMIENTO: el MDC no es confiable (sesiones {moved})")
    lines = [f"\n## Suelo de ruido y MDC ({datetime.now():%Y-%m-%d %H:%M})\n", *registry_markdown(reg),
             f"Sesiones agregadas: {len(recs)} (ids {sorted(r['session_id'] for r in recs)}). Cada sesion: "
             f"3 bloques de ~20 s, mirada fija, cabeza apoyada; solo cuadros que pasan el gate, sin "
             f"parpadeos (EAR < 0,75 x mediana) ni +-3 cuadros. sigma_w = 1,4826 x MAD de las medias de "
             f"bloques de 1 s dentro de la sesion (mancomunada entre sesiones, RMS). sigma_b = desv. "
             f"estandar (ddof=1) de las medias de sesion. MDC95 = 1,96 x raiz(2) x sigma sobre medias de "
             f"1 s (no sigma/raiz(N): el modo VIDEO autocorrelaciona los cuadros); el valor con "
             f"reposicionamiento usa raiz(sigma_w^2 + sigma_b^2). Los mm son [INF] (iris 11,7 mm). "
             f"El reposicionamiento entre sesiones no se puede verificar desde el codigo.", "",
             *moved_lines,
             "### Tabla 2: suelo de ruido y MDC", "", *table2(agg, recs), "", *CAN_CLAIM, ""]
    brow_lines = brow_report_lines(agg, recs, load_control())
    lines += brow_lines + [""]
    append_doc(lines)
    print("\n".join(table2(agg, recs)))
    print("\n".join(brow_lines))
    print(f"\nEscrito en {RESULTS_PATH}")
    if a.json:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        p = DATA_DIR / f"noise_floor_report_{stamp()}.json"
        p.write_text(json.dumps(clean({"registro": reg, "tabla2": agg}), indent=1), encoding="utf-8")
        print(f"JSON en {p}")


# ---------------------------------------------------------------- ceja: revision y control positivo
CONTROL_SETTLE_S = 1.5   # s iniciales de cada fase que no cuentan (transicion de la expresion)
CONTROL_RELAX_S = 4      # s de descanso (no se graba) entre cejas alzadas y ceno fruncido


def run_brow_check(a: Any, gp: sm.GateParams) -> None:
    """Vista en vivo SIN grabar ni guardar nada: cejas (verde sup. / rojo inf.), numeracion con n y
    los valores actuales de PTB_inf, PTB_sup, brow_th y pitch. Sirve para confirmar los indices."""
    with view_session(a, "REVISION DE CEJAS", gp, brow_view=True,
                      blendshapes=bool(getattr(a, "blendshapes", True))) as (view, mon):
        if mon is None:
            sys.exit("--brow-check necesita la vista en vivo (no uses --no-view y revisa el entorno grafico).")
        cap, cam = open_camera_info(a.cam, a.req_width, a.req_height)
        print_cam(cam)
        print("\nREVISION DE CEJAS: no se graba ni se guarda nada. Verde = borde superior, rojo = inferior.\n"
              "  n = numera los landmarks, m = espejo, p = pausa, q o ESC = salir.\n"
              "  Comprueba que cada polilinea siga el borde de SU ceja (R = ojo derecho de la persona) y que el\n"
              "  rojo quede en el borde de abajo. Si no coincide, los indices son erroneos: avisa antes de medir.",
              flush=True)
        last = 0.0
        try:
            while True:
                ok, f = cap.read()
                if not ok:
                    print("La camara dejo de entregar cuadros.")
                    break
                mon.feed(f, "REVISION CEJA", None, None, raw=True)
                now = time.perf_counter()
                b = mon.brow
                if now - last >= 1.0:
                    last = now
                    print("  " + (f"PTB_inf R/L {fmt(b.ptb_inf_r)}/{fmt(b.ptb_inf_l)}  PTB_sup R/L "
                                  f"{fmt(b.ptb_sup_r)}/{fmt(b.ptb_sup_l)}  brow_th R/L {fmt(b.th_r)}/{fmt(b.th_l)}  "
                                  f"pitch {fmt(b.pitch, 1)} grados  puntaje ceja max {fmt(b.blend_max)}"
                                  if b is not None else "sin cara, iris sin asignar o cejas cruzadas"),
                          flush=True)
        except sv.ViewAbort as e:
            print(f"\nRevision terminada ({e}). No se grabo ni se guardo nada.")
        finally:
            cap.release()


def known_brow_mdc(a: Any) -> tuple[dict[str, float] | None, str]:
    """MDC95 con reposicionamiento de PTB_inf por ojo (diametros de iris) de las sesiones guardadas
    que SI tienen PTB (>= 3, respetando --exclude-sessions); (None, motivo) si no hay."""
    if not NOISE_FILE.exists():
        return None, f"no existe {NOISE_FILE.name}"
    latest: dict[Any, dict[str, Any]] = {}
    for line in NOISE_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            latest[r["session_id"]] = r
    excl = {int(x) for x in str(getattr(a, "exclude_sessions", "") or "").replace(" ", "").split(",") if x}
    recs = [r for r in latest.values() if r["session_id"] not in excl and "ptb_inf_R" in r["metrics"]]
    if len(recs) < 3:
        return None, f"solo {len(recs)} sesion(es) con PTB (< 3)"
    agg = sm.aggregate_sessions(recs)
    return ({e: agg[f"ptb_inf_{e}"]["mdc95_repos"] for e in "RL"},
            f"MDC95 con reposicionamiento de {len(recs)} sesiones")


def control_lines(res: dict[str, Any], phases: dict[str, dict[str, float]]) -> list[str]:
    """Texto del control positivo (cambio de PTB_inf frente al neutral)."""
    mdc = res["mdc"]
    out = [f"Referencia: {res['mdc_source']}; MDC95 PTB_inf R {fmt(mdc.get('R', math.nan), 4)}, "
           f"L {fmt(mdc.get('L', math.nan), 4)} diam. iris ({fmt(sm.to_mm(mdc.get('R', math.nan)), 2)} / "
           f"{fmt(sm.to_mm(mdc.get('L', math.nan)), 2)} mm [INF])",
           f"Neutral: PTB_inf R {fmt(phases['neutral']['ptb_inf_R'], 3)}, L {fmt(phases['neutral']['ptb_inf_L'], 3)} "
           f"diam. iris, {phases['neutral']['n_frames']:.0f} cuadros utiles"]
    for ph, name in (("raised", "CEJAS ALZADAS"), ("frown", "CENO FRUNCIDO")):
        r = res[ph]
        d, mm, rt = r["delta_diam"], r["delta_mm"], r["ratio_mdc"]
        out.append(f"{name}: cambio PTB_inf R {fmt(d['R'], 3)}, L {fmt(d['L'], 3)} diam. iris "
                   f"({fmt(mm['R'], 2)} / {fmt(mm['L'], 2)} mm [INF]) = {fmt(rt['R'], 1)} / {fmt(rt['L'], 1)} x MDC "
                   f"-> {'DETECTADO' if r['detected'] else 'NO detectado'} (> {res['factor']:g} x MDC en ambos ojos); "
                   f"signo {'esperado' if r['sign_ok'] else 'NO esperado'}; blendshapes: ceja activa en "
                   f"{fmt(r['active_pct'], 0)} % de los cuadros -> {'marcado' if r['blend_flag'] else 'NO marcado'}; "
                   f"cambio de pitch {fmt(r['delta_pitch_deg'], 1)} grados")
        if _finite_abs(r["delta_pitch_deg"]) > 1.0:
            out.append(f"  ! el pitch cambio > 1 grado: parte del cambio puede ser paralaje, no la ceja")
    out.append(f"CONTROL POSITIVO: {'DETECTADO' if res['detected'] else 'NO DETECTADO'}")
    return out


def _finite_abs(x: float) -> float:
    return abs(x) if x is not None and math.isfinite(x) else 0.0


def run_brow_control(a: Any, gp: sm.GateParams) -> None:
    with view_session(a, "CONTROL POSITIVO DE CEJA", gp, brow_view=True,
                      blendshapes=bool(getattr(a, "blendshapes", True))) as (view, mon):
        try:
            _run_brow_control(a, gp, view, mon)
        except sv.ViewAbort as e:
            print(abort_message(e))


def _run_brow_control(a: Any, gp: sm.GateParams, view: sv.LiveView | None, mon: sv.LiveMonitor | None) -> None:
    secs = float(getattr(a, "control_seconds", 10.0))
    cap, cam = open_camera_info(a.cam, a.req_width, a.req_height)
    print_cam(cam)
    print(f"""
==================== CONTROL POSITIVO DE CEJA ====================
Mide si PTB_inf detecta un gesto GRANDE de ceja. Cabeza apoyada, quieto, mismo lugar y luz.
Mira el PUNTO ROJO de arriba todo el tiempo (no muevas los ojos hacia arriba al alzar las cejas).
  1) NEUTRAL {secs:.0f} s: cara relajada, cejas en reposo.
  2) CEJAS ALZADAS {secs:.0f} s: sube las cejas y manten (sorpresa moderada).
  3) {CONTROL_RELAX_S} s de descanso (no se graba).
  4) CENO FRUNCIDO {secs:.0f} s: baja y junta las cejas y manten.
1 pitido = empieza la fase, 2 = termina. q o ESC aborta sin guardar nada.
==================================================================""")
    data: dict[str, tuple[list[bytes], list[float]]] = {}

    def record_phase(label: str, key: str) -> None:
        print(f"  GRABANDO {label} {secs:.0f} s (no se guardan imagenes)", flush=True)
        beep(1)
        d_: list[bytes] = []
        t_: list[float] = []
        end = time.perf_counter() + secs
        while time.perf_counter() < end:
            ok, f = cap.read()
            if not ok:
                break
            f = cv2.flip(f, 1) if a.mirror else f
            d_.append(sd.jpeg_encode(sd.shrink(f, sd.REF_WIDTH), sd.REF_QUALITY))
            t_.append(time.perf_counter())
            if mon is not None:  # la vista va DESPUES de guardar el cuadro
                left = max(0.0, end - time.perf_counter())
                mon.feed(f, label, 1.0 - left / secs, left)
        beep(2)
        data[key] = (d_, t_)

    try:
        countdown(cap, a.start_delay, f"\nEmpieza en {a.start_delay} s, ponte en posicion.", mon, "NEUTRAL")
        record_phase("NEUTRAL", "neutral")
        record_phase("CEJAS ALZADAS", "raised")
        print(f"  Descanso {CONTROL_RELAX_S} s...", flush=True)
        end = time.perf_counter() + CONTROL_RELAX_S
        while time.perf_counter() < end:
            ok, f = cap.read()
            if ok and mon is not None:
                mon.feed(f, "RELAJA", 1.0 - (end - time.perf_counter()) / CONTROL_RELAX_S,
                         max(0.0, end - time.perf_counter()), raw=True)
        countdown(cap, 3, "Ceno fruncido en...", mon, "CENO FRUNCIDO")
        record_phase("CENO FRUNCIDO", "frown")
    finally:
        cap.release()
    bp = sm.BrowParams(abs_thr=brow_params(a).abs_thr, rel_thr=brow_params(a).rel_thr, enabled=False)
    use_bs = bool(getattr(a, "blendshapes", True))
    panel = sv.ProcessPanel(view, "PROCESANDO control de ceja", 3)
    ans: dict[str, sm.Analysis] = {}
    lats: list[float] = []
    for pi, key in enumerate(sm.CONTROL_PHASES):
        d_, t_ = data[key]
        if len(d_) < 30:
            sys.exit(f"Fase {key}: solo {len(d_)} cuadros capturados; repite.")
        panel.update(pi + 1, key, 0.0, force=True)
        P, face, iris, mats, blend, lt = infer_jpeg_block(
            d_, t_, use_bs, lambda i, n, img, p, pi=pi, key=key: panel.update(
                pi + 1, key, (i + 1) / n, img, p, detail=f"cuadro {i + 1}/{n}"))
        lats += list(lt)
        try:
            ans[key] = sm.analyze_recording(P, face, iris, mats, (len(t_) - 1) / (t_[-1] - t_[0]), gp, blend, bp)
        except ValueError as e:
            sys.exit(f"ABORTADO: {e}")
        panel.add_row(key, ans[key].face_pct, ans[key].iris_ok_pct, float(np.median(lt)))
    if not all(x.usable for x in ans.values()):
        sys.exit("Alguna fase sin cara o iris suficientes; revisa luz y distancia y repite.")
    ref_med = sm.blend_median(ans["neutral"].blend)
    phases = {k: sm.control_phase_stats(v, int(round(CONTROL_SETTLE_S * v.fs)), bp, ref_med) for k, v in ans.items()}
    mdc, src = known_brow_mdc(a)
    if mdc is None:
        mdc = {e: sm.mdc95(phases["neutral"][f"sigma_w_{e}"]) for e in "RL"}
        src = (f"FALLBACK ({src}): MDC95 intra-sesion del bloque neutral; optimista (sin reposicionamiento)")
    res = sm.control_result(phases, mdc, src)
    lines = control_lines(res, phases)
    print("\n=== Control positivo de ceja ===\n" + "\n".join(lines))
    rec = {"timestamp": datetime.now().isoformat(timespec="seconds"), "registro": build_registry(a, cam, gp, "VIDEO"),
           "fases": phases, "resultado": res, "detected": res["detected"], "summary": res["summary"],
           "lat_p95_ms": float(np.percentile(lats, 95)) if lats else None, "blendshapes": use_bs}
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with CONTROL_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(clean(rec)) + "\n")
    print(f"\nResultado (solo numeros) agregado a {CONTROL_FILE}")
    append_doc([f"\n## Control positivo de ceja ({datetime.now():%Y-%m-%d %H:%M})\n", *lines, "", *BROW_CLAIM, ""])
    print(f"Escrito en {RESULTS_PATH}")
    if view is not None:
        view.show_final("CONTROL POSITIVO DE CEJA: RESUMEN", lines + ["", "Los mm son [INF] (iris 11,7 mm)."])


# ---------------------------------------------------------------- diagnostico del gate
CRIT_LABELS = {"speed": ("velocidad (mediana, % IOD/cuadro)", "{:.3f}"),
               "roll": ("rango de roll (grados)", "{:.2f}"),
               "iod": ("rango de IOD (%)", "{:.2f}"),
               "yaw": ("rango de yaw (grados)", "{:.2f}"),
               "pitch": ("rango de pitch (grados)", "{:.2f}"),
               "face_loss": ("perdida de cara (% cuadros de la ventana)", "{:.1f}")}


def diagnose_lines(an: sm.Analysis, gp: sm.GateParams, header: str) -> list[str]:
    """Reporte markdown del diagnostico del gate (ventanas deslizantes de gp.window_s)."""
    if an.gate_vals is None or len(an.gate_vals.get("speed", [])) == 0:
        return [header, "", "Sin ventanas utilizables (pocos cuadros validos): repite la captura."]
    d = sm.diagnose_windows(an.gate_vals, gp, an.mat_pct)
    crit: dict[str, dict[str, float]] = d["criteria"]  # type: ignore[assignment]
    lines = [header, "",
             f"{an.n} cuadros a {an.fs:.1f} FPS, ventana {gp.window_s:g} s, {d['n_windows']} ventanas. "
             f"Deteccion de cara {an.face_pct:.1f} %, iris OK {an.iris_ok_pct:.1f} %. "
             f"**Matriz de transformacion disponible: {an.mat_pct:.1f} %** de los cuadros con cara"
             + (" (sin matriz, yaw/pitch se omiten del gate)." if an.mat_pct == 0 else "."), "",
             "| Criterio | umbral actual | mediana | p80 | p95 | max | % ventanas que pasan | "
             "% total si se quita solo este |", "|---|---|---|---|---|---|---|---|"]
    for k in sm.CRITERIA:
        c = crit[k]
        label, f = CRIT_LABELS[k]
        thr = "= 0" if k == "face_loss" else "< " + f.format(c["threshold"])
        lines.append(f"| {label} | {thr} | {f.format(c['median'])} | {f.format(c['p80'])} | "
                     f"{f.format(c['p95'])} | {f.format(c['max'])} | {c['pass_pct']:.1f} | "
                     f"{c['pass_without_pct']:.1f} |")
    lines += ["", f"**Ventanas que pasan TODOS los criterios: {d['all_pct']:.1f} %.** "
              f"Cuello de botella: **{d['bottleneck']}** (criterio con menos ventanas aprobadas).", "",
              "Umbrales sugeridos (p80 observado; calibrado con esta persona y sesion: propuesta, "
              "decide el usuario): "
              + "; ".join(f"{k} < {CRIT_LABELS[k][1].format(crit[k]['p80'])}"
                          for k in sm.CRITERIA if k != "face_loss" and np.isfinite(crit[k]["p80"])) + "."]
    return lines


def run_gate_diagnose(a: Any, gp: sm.GateParams) -> None:
    with view_session(a, "DIAGNOSTICO DEL GATE", gp) as (view, mon):
        try:
            _run_gate_diagnose(a, gp, view, mon)
        except sv.ViewAbort as e:
            print(abort_message(e))


def _run_gate_diagnose(a: Any, gp: sm.GateParams, view: sv.LiveView | None, mon: sv.LiveMonitor | None) -> None:
    """Captura N cuadros (ruta 512 px q80, modo VIDEO) y diagnostica cada criterio del gate."""
    n = a.frames or 150
    cap, cam = open_camera_info(a.cam, a.req_width, a.req_height)
    print_cam(cam)
    data: list[bytes] = []
    ts: list[float] = []
    try:
        countdown(cap, a.countdown, f"\nQuieto y mirando al frente. Captura de {n} cuadros en...", mon)
        wait_still(cap, mon, a)
        print("  GRABANDO (no se guardan imagenes)", flush=True)
        beep(1)
        while len(data) < n:
            ok, f = cap.read()
            if not ok:
                break
            f = cv2.flip(f, 1) if a.mirror else f
            data.append(sd.jpeg_encode(sd.shrink(f, sd.REF_WIDTH), sd.REF_QUALITY))
            ts.append(time.perf_counter())
            if mon is not None:  # la vista va DESPUES de guardar el cuadro
                mon.feed(f, "GRABANDO", len(data) / n, mon.eta(n - len(data)))
    finally:
        cap.release()
    beep(2)
    if len(data) < 30:
        sys.exit(f"Solo {len(data)} cuadros capturados; se necesitan al menos 30.")
    fs = (len(ts) - 1) / (ts[-1] - ts[0])
    ms = ts_to_ms(ts)
    P = np.full((len(data), sm.N_LANDMARKS, 2), np.nan)
    face = np.zeros(len(data), bool)
    iris = np.zeros(len(data), bool)
    mats: list[np.ndarray | None] = [None] * len(data)
    lm = build_landmarker_v2("VIDEO")
    panel = sv.ProcessPanel(view, "PROCESANDO diagnostico del gate", 1)
    try:
        for i, buf in enumerate(data):
            img = sd.jpeg_decode(buf)
            p, fc, ok, mat, _ = infer_frame(lm, "VIDEO", img, ms[i])
            if p is not None:
                P[i] = p
            face[i], iris[i], mats[i] = fc, ok, mat
            panel.update(1, "diagnostico", (i + 1) / len(data), img, p, detail=f"cuadro {i + 1}/{len(data)}")
    finally:
        lm.close()
    shapes = sorted({tuple(m.shape) for m in mats if m is not None})
    print(f"Formas de matriz recibidas: {shapes or 'ninguna'}; con matriz: "
          f"{sum(m is not None for m in mats)}/{len(mats)} cuadros")
    an = sm.analyze_recording(P, face, iris, mats, fs, gp)
    reg_note = (f"{cam.got_w}x{cam.got_h}, ruta {sd.REF_WIDTH} px q{sd.REF_QUALITY}, modo VIDEO, "
                f"{'espejo aplicado' if a.mirror else 'sin espejo'}, espera de quietud: "
                f"{'; '.join(getattr(a, 'wait_results', [])) or 'no usada'}, git {git_short_hash()}")
    lines = diagnose_lines(an, gp, f"\n## Diagnostico del gate de quietud ({datetime.now():%Y-%m-%d %H:%M})\n")
    lines.insert(2, f"Registro: {reg_note}. Notas: {a.notes or '-'}.")
    print("\n".join(lines))
    append_doc(lines)
    print(f"\nEscrito en {RESULTS_PATH}")
    if view is not None:
        view.show_final("DIAGNOSTICO DEL GATE: RESUMEN", gate_summary(an, gp))


def gate_summary(an: sm.Analysis, gp: sm.GateParams) -> list[str]:
    if an.gate_vals is None or len(an.gate_vals.get("speed", [])) == 0:
        return ["Sin ventanas utilizables (pocos cuadros validos): repite la captura.",
                f"Deteccion de cara {an.face_pct:.1f} %, iris OK {an.iris_ok_pct:.1f} %"]
    d = sm.diagnose_windows(an.gate_vals, gp, an.mat_pct)
    crit: dict[str, dict[str, float]] = d["criteria"]  # type: ignore[assignment]
    lines = [f"{an.n} cuadros a {an.fs:.1f} FPS, {d['n_windows']} ventanas de {gp.window_s:g} s; "
             f"deteccion {an.face_pct:.1f} %, iris OK {an.iris_ok_pct:.1f} %, matriz {an.mat_pct:.0f} %",
             f"Ventanas que pasan TODO: {d['all_pct']:.1f} %.   Cuello de botella: {d['bottleneck']}", ""]
    for k in sm.CRITERIA:
        c = crit[k]
        lines.append(f"{k}: pasa {c['pass_pct']:.0f} % (umbral {fmt(c['threshold'], 2)}, p80 "
                     f"{fmt(c['p80'], 3)}, max {fmt(c['max'], 3)}); sin este criterio: "
                     f"{c['pass_without_pct']:.0f} %")
    return lines + ["", "! Umbrales sugeridos = p80 de esta sesion: propuesta, decide el usuario."]


# ---------------------------------------------------------------- smoke sin camara
def _fake_sweep_stats() -> tuple[dict[str, dict[str, dict[str, Any]]], dict[str, bool]]:
    an = sm.analyze_recording(sm.make_synthetic_landmarks(150, noise_px=0.3), np.ones(150, bool),
                              np.ones(150, bool), None, 30.0)
    rec = ModeRecord(np.zeros((150, sm.N_LANDMARKS, 2)), np.ones(150, bool), np.ones(150, bool), [None] * 150,
                     np.full(150, 10.0))
    st = {m: {"REF": condition_stats(rec, an, None)} for m in MODES}
    return st, acceptance(st)[1]


def smoke_v2() -> None:
    """Rotacion, degradaciones, ruta, condiciones y metricas sin camara (cuadros sinteticos)."""
    rng = np.random.default_rng(0)
    img = rng.integers(0, 255, (480, 640, 3), dtype=np.uint8)
    for kind in sd.DEGRADE_KINDS:
        out = sd.degrade(img, kind, np.random.default_rng(1))
        assert out.shape == img.shape and out.dtype == np.uint8, kind
        assert kind == "none" or not np.array_equal(out, img), kind
    rot = sd.rotate_reflect(img, 30.0, (320.0, 240.0))
    assert rot.shape == img.shape and not np.array_equal(rot, img)
    assert sd.shrink(img, 1024) is img and sd.resize_jpeg(img, 512, 80).shape == (384, 512, 3)
    print(f"Smoke v2 degradaciones OK: {len(sd.DEGRADE_KINDS)} tipos, rotacion 30 grados con borde reflejado")
    # el roll medido en puntos rotados por la misma matriz es -angulo; contrarrotar lo anula
    P = sm.make_synthetic_landmarks(1, noise_px=0.0)[0]
    for ang in (15.0, 30.0, 45.0):
        M = cv2.getRotationMatrix2D((300.0, 240.0), ang, 1.0)
        Pr = P @ M[:, :2].T + M[:, 2]
        est = float(sm.roll_deg(((Pr[33] + Pr[133]) / 2)[None], ((Pr[362] + Pr[263]) / 2)[None])[0])
        Mc = cv2.getRotationMatrix2D((300.0, 240.0), est, 1.0)
        Pc = Pr @ Mc[:, :2].T + Mc[:, 2]
        left = float(sm.roll_deg(((Pc[33] + Pc[133]) / 2)[None], ((Pc[362] + Pc[263]) / 2)[None])[0])
        assert abs(est + ang) < 1e-6 and abs(left) < 1e-6, (ang, est, left)
    print("Smoke v2 roll OK: roll estimado = -angulo y la contrarrotacion lo deja en 0")
    for w in (480, 640, 1280):
        cs = sd.build_conditions(w)
        names = [c.name for c in cs]
        assert len(names) == len(set(names)) and cs[0].name == "REF", names
        assert all(c.width is None or c.width < w for c in cs), names
        print(f"  condiciones para ancho nativo {w}: {len(cs)}")
    frames = [rng.integers(0, 255, (480, 640, 3), dtype=np.uint8) for _ in range(6)]
    ts_ms = [i * 33 for i in range(6)]
    raw = run_condition(next(c for c in sd.build_conditions(640) if c.name == "roll15_bruto"), frames, ts_ms,
                        (0.5, 0.5))
    comp = run_condition(next(c for c in sd.build_conditions(640) if c.name == "roll15_comp"), frames, ts_ms,
                         (0.5, 0.5), raw)
    for m in MODES:
        an = analyze(comp[m], 30.0, sm.GateParams())
        assert not an.usable and np.all(comp[m].lat > 0)
        st = condition_stats(comp[m], an, None)
        assert st["det_pct"] == 0.0
    print("Smoke v2 condiciones IMAGE y VIDEO (cruda y compensada) OK sobre cuadros sin cara")
    inv = invariance_selftest()
    assert inv < 1e-6, inv
    def ry(deg: float) -> np.ndarray:
        r = math.radians(deg)
        M = np.eye(4)
        M[0, 0], M[0, 2], M[2, 0], M[2, 2] = math.cos(r), math.sin(r), -math.sin(r), math.cos(r)
        return M

    # yaw oscilando 179.5 <-> -179.5 (1 grado real, 359 sin envolver): el rango circular debe ser ~1
    yaw_cross = [ry(179.5 if i % 2 else -179.5) for i in range(150)]
    ans = sm.analyze_recording(sm.make_synthetic_landmarks(150, noise_px=0.05), np.ones(150, bool),
                               np.ones(150, bool), yaw_cross, 30.0)
    assert ans.mat_pct == 100.0 and ans.gate_pct > 50, (ans.mat_pct, ans.gate_pct)
    assert len(diagnose_lines(ans, sm.GateParams(), "x")) > 8
    print(f"Smoke v2 gate con yaw cruzando +-180 OK: gate {ans.gate_pct:.0f} %")
    an = sm.analyze_recording(sm.make_synthetic_landmarks(150, blinks=[(40, 44)]),
                              np.ones(150, bool), np.ones(150, bool), None, 30.0)
    assert an.usable and an.n_blinks == 1 and an.gate_pct > 50
    print(f"Smoke v2 metricas OK: invariancia max dif {inv:.1e}; cara sintetica: EAR "
          f"{np.nanmedian(an.series['ear_R']):.3f}, gate {an.gate_pct:.0f} %, parpadeos {an.n_blinks}")
    # cabeza quieta con parpadeos que arrastran comisuras/parpados 2 px: el gate nuevo no los toma
    # por movimiento (puntos rigidos + mascara de parpadeo); el legacy si (falla IOD)
    pb = sm.make_synthetic_landmarks(360, noise_px=0.2, seed=5, blink_shift_px=2.0,
                                     blinks=[(40, 45), (130, 135), (220, 226), (310, 315)])
    okb = np.ones(360, bool)
    res_b = {}
    for lg in (False, True):
        gpb = sm.GateParams(legacy=lg)
        anb = sm.analyze_recording(pb, okb, okb, None, 30.0, gpb)
        pas = sm.window_pass(anb.gate_vals, gpb)
        res_b[lg] = (100.0 * float(np.logical_and.reduce(list(pas.values())).mean()),
                     sm.fail_summary({k: 100.0 - 100.0 * float(v.mean()) for k, v in pas.items()}))
    assert res_b[False][0] == 100.0 and res_b[True][0] < 80.0 and "IOD" in res_b[True][1], res_b
    print(f"Smoke v2 gate con parpadeos OK: nuevo {res_b[False][0]:.0f} % de ventanas quietas, "
          f"legacy {res_b[True][0]:.0f} % ({res_b[True][1]})")
    assert len(gate_summary(ans, sm.GateParams())) > 8 and len(sweep_summary(*_fake_sweep_stats())) > 8
    sv.smoke_viewer()
    smoke_retry()
    smoke_brow()


def smoke_retry() -> None:
    """Reintento por quietud sin camara ni ventana: reloj y camara falsos, landmarks sinteticos.
    Caso 1: el 1.er intento se mueve y el 2.o no (2 intentos, aceptada). Caso 2: nunca queda quieto
    (agota los reintentos y marca CAPTURA CON MOVIMIENTO). Caso 3: sin vista, una sola captura."""
    import types

    P0 = sm.make_synthetic_landmarks(1, noise_px=0.0)[0]
    img = np.zeros((48, 64, 3), np.uint8)
    state = {"t": 0.0, "i": 0, "moving": False}

    class FakeCap:
        def read(self) -> tuple[bool, np.ndarray]:
            state["t"] += 1 / 30.0
            state["i"] += 1
            return True, img

    def infer(_f: np.ndarray, _ts: int) -> tuple[np.ndarray | None, np.ndarray | None]:
        dx = 12.0 * (1 if state["i"] % 2 else -1) if state["moving"] else 0.0
        return P0 + (dx, 0.0), np.eye(4)

    def run(max_retries: int, always_moving: bool, view: bool = True) -> tuple[Any, CaptureOutcome, int, int]:
        a = types.SimpleNamespace(wait_still=True, wait_still_timeout=30.0, min_quiet=80.0, max_retries=max_retries)
        mon = sv.LiveMonitor(None, infer, sm.GateParams(), "SMOKE") if view else None
        calls = {"n": 0, "beeps": 0}
        cap = FakeCap()

        def record() -> list[int]:
            calls["n"] += 1
            state["moving"] = always_moving or calls["n"] == 1
            out = []
            for k in range(90):
                ok, f = cap.read()
                out.append(k)
                if mon is not None:
                    mon.feed(f, "GRABANDO", k / 90, None, raw=True)
            state["moving"] = False
            return out

        real_clock, real_beep = time.perf_counter, globals()["beep"]
        time.perf_counter = lambda: state["t"]  # type: ignore[assignment]
        globals()["beep"] = lambda times=1: calls.__setitem__("beeps", calls["beeps"] + (3 if times == 3 else 0))
        try:
            res, out = capture_with_retry(a, cap, mon, "smoke", record)  # type: ignore[arg-type]
        finally:
            time.perf_counter = real_clock  # type: ignore[assignment]
            globals()["beep"] = real_beep
        return res, out, calls["n"], calls["beeps"]

    res, out, n, beeps = run(2, False)
    assert out.attempts == 2 and n == 2 and not out.flagged and out.quiet_pct is not None         and out.quiet_pct >= 80.0 and beeps == 3 and len(res) == 90, (out, n, beeps)
    print(f"Smoke reintento OK: 1.er intento con movimiento, 2.o quieto -> {out.attempts} intentos, "
          f"quietud {out.quiet_pct:.0f} %, 3 pitidos de aviso")
    res, out, n, beeps = run(1, True)
    assert out.attempts == 2 and n == 2 and out.flagged and "MOVIMIENTO" in out.text and beeps == 3, (out, n)
    print(f"Smoke reintento OK: nunca quieto -> {out.attempts} intentos, marcada (quietud {out.quiet_pct:.0f} %)")
    res, out, n, beeps = run(2, True, view=False)
    assert out.attempts == 1 and n == 1 and out.quiet_pct is None and not out.flagged
    print("Smoke reintento OK: sin vista no reintenta ni mide quietud")


def smoke_brow() -> None:
    """Ruta de ceja de punta a punta SIN camara: reloj y camara falsos, landmarks y blendshapes
    sinteticos (ceja desplazada una cantidad conocida). Cubre infer_jpeg_block, --noise-floor (3
    sesiones con reposicionamiento), una sesion vieja sin PTB, --noise-floor-report, --brow-control y la
    lectura del puntaje de blendshapes. Los archivos de salida van a un directorio temporal."""
    import contextlib
    import io
    import tempfile
    import types

    cs = types.SimpleNamespace(category_name="browInnerUp", score=0.7)
    got = brow_blend_scores(types.SimpleNamespace(face_blendshapes=[[cs, types.SimpleNamespace(
        category_name="otro", score=0.1)]]))
    assert got is not None and got[2] == 0.7 and np.isnan(got[0]) and brow_blend_scores(
        types.SimpleNamespace(face_blendshapes=[])) is None
    st: dict[str, Any] = {"t": 0.0, "n": 0, "sid": 0, "mode": "noise", "cnt": {}}
    faces: dict[float, np.ndarray] = {}
    img_code = {"neutral": 10, "raised": 100, "frown": 200}

    def face_for(gap: float) -> np.ndarray:
        if gap not in faces:
            faces[gap] = sm.make_synthetic_landmarks(400, noise_px=0.3, seed=1, brow_gap_px=gap)
        return faces[gap]

    class FakeCap:
        def read(self) -> tuple[bool, np.ndarray]:
            st["t"] += 1 / 30.0
            code = 0
            if st["mode"] == "control":
                code = img_code["neutral"] if st["t"] < 9 else img_code["raised"] if st["t"] < 21 else img_code["frown"]
            return True, np.full((48, 64, 3), code, np.uint8)

        def release(self) -> None:
            pass

    class FakeLm:
        def close(self) -> None:
            pass

    def rx(deg: float) -> np.ndarray:
        r = math.radians(deg)
        M = np.eye(4)
        M[1, 1], M[1, 2], M[2, 1], M[2, 2] = math.cos(r), -math.sin(r), math.sin(r), math.cos(r)
        return M

    def fake_infer(_lm: Any, _mode: str, img: np.ndarray, _ts: int) -> tuple[Any, ...]:
        bs = np.full(len(sm.BROW_BLEND), 0.02)
        if st["mode"] == "control":
            v = float(img.mean())
            ph = min(img_code, key=lambda k: abs(img_code[k] - v))
            gap = {"neutral": 40.0, "raised": 52.0, "frown": 30.0}[ph]
            if ph == "raised":
                bs[2] = 0.6
            if ph == "frown":
                bs[0] = 0.5
            i = st["cnt"][ph] = st["cnt"].get(ph, -1) + 1
            mat = rx(0.0)
        else:
            gap = 40.0 + 0.5 * st["sid"]
            i = st["cnt"]["noise"] = st["cnt"].get("noise", -1) + 1
            if 50 <= i % 120 < 56:
                bs[2] = 0.6  # ceja alzada breve: debe excluirse
            mat = rx(0.6 * st["sid"])
        P = face_for(gap)
        return P[i % len(P)].copy(), True, True, mat, 5.0, bs

    ns = types.SimpleNamespace(
        cam=0, req_width=None, req_height=None, session_id=0, blocks=3, block_seconds=6.0, countdown=1,
        start_delay=1, mirror=False, save_landmarks=False, facing="unknown", notes="smoke", subject="",
        blendshapes=True, brow_abs=0.30, brow_rel=0.15, no_brow_filter=False, json=False, exclude_sessions="",
        control_seconds=8.0, wait_still=False, max_retries=0, min_quiet=0.0)
    names = ("DATA_DIR", "NOISE_FILE", "CONTROL_FILE", "RESULTS_PATH", "open_camera_info", "build_landmarker_v2",
             "infer_frame_full", "beep")
    saved = {n: globals()[n] for n in names}
    real_clock = time.perf_counter
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        globals().update(DATA_DIR=tmp, NOISE_FILE=tmp / "noise_floor.jsonl", CONTROL_FILE=tmp / "brow_control.jsonl",
                         RESULTS_PATH=tmp / "spike-resultados.md",
                         open_camera_info=lambda *_a: (FakeCap(), CamInfo(0, "fake", None, None, 64, 48, 30.0, (48, 64, 3))),
                         build_landmarker_v2=lambda mode, blendshapes=False: FakeLm(),
                         infer_frame_full=fake_infer, beep=lambda times=1: None)
        time.perf_counter = lambda: st["t"]  # type: ignore[assignment]
        sink = io.StringIO()
        try:
            with contextlib.redirect_stdout(sink):
                for sid in (11, 12, 13):
                    st.update(sid=sid, mode="noise", cnt={}, t=0.0)
                    ns.session_id = sid
                    _run_noise_floor(ns, sm.GateParams(), None, None)
            recs = load_sessions()
            assert len(recs) == 3 and all("brow" in r and "ptb_inf_R" in r["metrics"] for r in recs), (len(recs), [list(r) for r in recs])
            assert all(r["brow"]["excl_pct"] > 0 and "sigma_w_nf" in r["metrics"]["ptb_inf_R"] for r in recs)
            assert all(len(r["brow"]["blocks"][0]["mask_runs"]) >= 1 for r in recs)
            # sesion vieja: sin ninguna serie de ceja
            old = {k: v for k, v in recs[0].items() if k != "brow"}
            old["session_id"] = 2
            old["metrics"] = {k: v for k, v in recs[0]["metrics"].items() if k not in sm.BROW_SERIES}
            with sm_noise_append(old):
                with contextlib.redirect_stdout(sink):
                    run_noise_floor_report(ns)
                doc = RESULTS_PATH.read_text(encoding="utf-8")
                assert "AVISO: las sesiones [2] NO tienen series de ceja" in doc, doc[-1500:]
                assert "Criterios de aceptacion de PTB_inf" in doc and "PTB_inf = pupila a ceja INF" in doc
                st.update(mode="control", cnt={}, t=0.0)
                with contextlib.redirect_stdout(sink):
                    _run_brow_control(ns, sm.GateParams(), None, None)
                ctl = load_control()
                assert ctl is not None and ctl["detected"] is True, ctl and ctl["summary"]
                assert ctl["resultado"]["raised"]["blend_flag"] and ctl["resultado"]["frown"]["blend_flag"]
                assert ctl["resultado"]["raised"]["delta_diam"]["R"] > 0 > ctl["resultado"]["frown"]["delta_diam"]["R"]
                with contextlib.redirect_stdout(sink):
                    run_noise_floor_report(ns)
                assert "control positivo detectado: **CUMPLE**" in RESULTS_PATH.read_text(encoding="utf-8")
        finally:
            time.perf_counter = real_clock  # type: ignore[assignment]
            globals().update(saved)
    d = ctl["resultado"]["raised"]["delta_diam"]["R"]
    print(f"Smoke ceja OK: 3 sesiones nuevas + 1 vieja sin PTB agregadas, informe con criterios; control positivo "
          f"detectado (cejas alzadas {d:.2f} diam. iris = {sm.to_mm(d):.1f} mm [INF], esperado 12/22 = 0.55)")


@contextmanager
def sm_noise_append(rec: dict[str, Any]) -> Iterator[None]:
    """Agrega una sesion al archivo de ruido (solo smoke)."""
    with NOISE_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(clean(rec)) + "\n")
    yield
