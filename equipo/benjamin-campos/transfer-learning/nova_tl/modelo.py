"""PatchTST de Hugging Face (`transformers`) como pronosticador diario, univariado y compartido entre variables.

Se entrena en Tierra con todas las series diarias (LifeSnaps y el pre-reposo), y después se adapta al reposo
congelando el backbone (solo la cabeza) o ajustando todo. Solo corre en Kaggle: nada de redes en el PC de Benja.

La pérdida que trae `PatchTSTForPrediction` es un MSE sin máscara, así que aquí se calcula aparte: error al cuadrado,
dividido por el ruido típico de un día a otro de cada variable (para que pulso y diuresis pesen parecido), solo en días observados.
"""

from __future__ import annotations

import copy

import numpy as np
import torch
from transformers import PatchTSTConfig, PatchTSTForPrediction

from nova_tl.ventanas import Ventanas, escala


def crear(C: int, H: int, semilla: int = 0) -> PatchTSTForPrediction:
    torch.manual_seed(semilla)
    cfg = PatchTSTConfig(num_input_channels=1, context_length=C, prediction_length=H, patch_length=4, patch_stride=2,
                         d_model=64, num_attention_heads=4, num_hidden_layers=3, ffn_dim=128, dropout=0.1,
                         head_dropout=0.1, scaling="std", loss="mse", do_mask_input=False)
    return PatchTSTForPrediction(cfg)


def _tensores(v: Ventanas, device: str, ruido: dict[str, float] | None = None):
    x = torch.from_numpy(v.x).unsqueeze(-1).to(device)
    mx = torch.from_numpy(v.mx).bool().unsqueeze(-1).to(device)
    y = torch.from_numpy(v.y).to(device)
    my = torch.from_numpy(v.my).to(device)
    s = torch.from_numpy(escala(v, ruido)).unsqueeze(-1).to(device)
    return x, mx, y, my, s


def perdida(yhat: torch.Tensor, y: torch.Tensor, my: torch.Tensor, s: torch.Tensor) -> torch.Tensor:
    e = ((yhat - y) / s) ** 2 * my
    return e.sum() / my.sum().clamp(min=1)


def congelar_backbone(model: PatchTSTForPrediction) -> None:
    for p in model.model.parameters():
        p.requires_grad = False


def entrenar(model: PatchTSTForPrediction, train: Ventanas, val: Ventanas | None, epocas: int, lr: float,
             device: str, batch: int = 512, paciencia: int = 6, semilla: int = 0,
             ruido: dict[str, float] | None = None) -> dict:
    """Adam con parada temprana sobre `val` (si hay). Devuelve la historia y deja cargado el mejor estado."""
    if len(train) == 0:
        raise ValueError("no hay ventanas de entrenamiento")
    model.to(device)
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=lr, weight_decay=1e-4)
    g = torch.Generator().manual_seed(semilla)
    X = _tensores(train, device, ruido)
    V = _tensores(val, device, ruido) if val is not None and len(val) else None
    mejor, estado, sin_mejora, hist = np.inf, copy.deepcopy(model.state_dict()), 0, []
    n = len(train)
    for ep in range(epocas):
        model.train()
        orden = torch.randperm(n, generator=g)
        tot = 0.0
        for i in range(0, n, batch):
            idx = orden[i:i + batch].to(device)
            out = model(past_values=X[0][idx], past_observed_mask=X[1][idx]).prediction_outputs.squeeze(-1)
            loss = perdida(out, X[2][idx], X[3][idx], X[4][idx])
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 1.0)
            opt.step()
            tot += loss.item() * len(idx)
        l_val = _evaluar_perdida(model, V) if V is not None else tot / n
        hist.append({"epoca": ep, "train": tot / n, "val": l_val})
        if l_val < mejor - 1e-4:
            mejor, estado, sin_mejora = l_val, copy.deepcopy(model.state_dict()), 0
        else:
            sin_mejora += 1
            if sin_mejora >= paciencia:
                break
    model.load_state_dict(estado)
    return {"historia": hist, "mejor_val": float(mejor)}


@torch.no_grad()
def _evaluar_perdida(model, T, batch: int = 4096) -> float:
    model.eval()
    tot, den = 0.0, 0.0
    for i in range(0, len(T[0]), batch):
        out = model(past_values=T[0][i:i + batch], past_observed_mask=T[1][i:i + batch]).prediction_outputs.squeeze(-1)
        e = ((out - T[2][i:i + batch]) / T[4][i:i + batch]) ** 2 * T[3][i:i + batch]
        tot += e.sum().item()
        den += T[3][i:i + batch].sum().item()
    return tot / max(den, 1)


@torch.no_grad()
def predecir(model: PatchTSTForPrediction, v: Ventanas, device: str, batch: int = 4096) -> np.ndarray:
    model.to(device).eval()
    x, mx = _tensores(v, device)[:2]
    outs = [model(past_values=x[i:i + batch], past_observed_mask=mx[i:i + batch]).prediction_outputs.squeeze(-1)
            for i in range(0, len(v), batch)]
    return torch.cat(outs).cpu().numpy() if outs else np.zeros_like(v.y)


def adaptar(base: PatchTSTForPrediction, train: Ventanas, val: Ventanas | None, modo: str, device: str,
            semilla: int = 0, ruido: dict[str, float] | None = None) -> tuple[PatchTSTForPrediction, dict]:
    """modo «cabeza»: backbone congelado, solo la cabeza. modo «todo»: ajuste completo con lr bajo."""
    m = copy.deepcopy(base)
    if modo == "cabeza":
        congelar_backbone(m)
        info = entrenar(m, train, val, epocas=30, lr=1e-3, device=device, semilla=semilla, ruido=ruido)
    else:
        info = entrenar(m, train, val, epocas=30, lr=2e-4, device=device, semilla=semilla, ruido=ruido)
    return m, info
