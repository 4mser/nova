"""Servicio local de SAM 3D Body (Meta, CVPR 2026) para el espejo del gemelo.

La pantalla del gemelo manda un cuadro JPEG de la cámara y el recuadro de la persona (sale de MediaPipe, que ya corre
en el navegador) y recibe 70 puntos 3D del cuerpo completo: cuerpo, pies, las 21 articulaciones de cada mano,
olécranon, acromion y cuello. A diferencia de MediaPipe, el modelo infiere la profundidad real y las partes tapadas,
así que distingue una mano que toca la cabeza de una que está delante.

Corre en la GPU del Mac (MPS) y solo escucha en 127.0.0.1. La imagen no se guarda.

Uso:  .venv/bin/python servidor.py  [--puerto 8793] [--modelo facebook/sam-3d-body-dinov3]
"""
import argparse
import io
import os
import sys
import threading
import time

import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, "repo"))
os.environ.setdefault("MOMENTUM_ENABLED", "0")   # sin la librería momentum: el MHR va como TorchScript

from sam_3d_body import SAM3DBodyEstimator, load_sam_3d_body  # noqa: E402

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
estado = {"listo": False, "error": None, "ms": None, "dispositivo": None}
bloqueo = threading.Lock()
estimador = None


def cargar(modelo: str):
    global estimador
    try:
        from huggingface_hub import snapshot_download
        carpeta = snapshot_download(modelo)
        disp = torch.device("mps") if torch.backends.mps.is_available() else torch.device("cpu")
        red, cfg = load_sam_3d_body(os.path.join(carpeta, "model.ckpt"), device=disp,
                                    mhr_path=os.path.join(carpeta, "assets", "mhr_model.pt"))
        estimador = SAM3DBodyEstimator(sam_3d_body_model=red, model_cfg=cfg)
        estado.update(listo=True, dispositivo=str(disp))
        print(f"[sam3d] listo en {disp}", flush=True)
    except Exception as e:  # el acceso a los pesos se aprueba a mano en Hugging Face
        estado["error"] = f"{type(e).__name__}: {e}"
        print("[sam3d] no se pudo cargar:", estado["error"], flush=True)


@app.get("/estado")
def ver_estado():
    return estado


@app.post("/cuadro")
async def cuadro(img: UploadFile = File(...), caja: str = Form(""), manos: str = Form("1")):
    if not estado["listo"]:
        return {"ok": False, "error": estado["error"] or "cargando"}
    datos = await img.read()
    rgb = np.array(Image.open(io.BytesIO(datos)).convert("RGB"))
    bgr = rgb[:, :, ::-1].copy()
    cajas = None
    if caja:
        x0, y0, x1, y1 = (float(v) for v in caja.split(","))
        cajas = np.array([[x0, y0, x1, y1]], dtype=np.float32)
    t = time.perf_counter()
    with bloqueo, torch.inference_mode():
        salida = estimador.process_one_image(bgr, bboxes=cajas, inference_type="full" if manos == "1" else "body")
    ms = (time.perf_counter() - t) * 1000
    estado["ms"] = round(ms)
    if not salida:
        return {"ok": True, "persona": False, "ms": round(ms)}
    p = salida[0]
    k3 = np.asarray(p["pred_keypoints_3d"])[:70]
    k2 = np.asarray(p["pred_keypoints_2d"])[:70]
    return {"ok": True, "persona": True, "ms": round(ms),
            "k3": np.round(k3, 4).tolist(), "k2": np.round(k2, 1).tolist(),
            "cam_t": np.round(np.asarray(p["pred_cam_t"]), 4).tolist(),
            "foco": float(np.asarray(p["focal_length"]).reshape(-1)[0]),
            "alto": int(rgb.shape[0]), "ancho": int(rgb.shape[1])}


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("--puerto", type=int, default=8793)
    a.add_argument("--modelo", default="facebook/sam-3d-body-dinov3")
    args = a.parse_args()
    threading.Thread(target=cargar, args=(args.modelo,), daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=args.puerto, log_level="warning")
