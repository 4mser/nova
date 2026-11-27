#!/bin/sh
# SAM 3D Body (Meta) para el espejo del gemelo. Los pesos están cerrados: pide acceso en
# https://huggingface.co/facebook/sam-3d-body-dinov3 y conéctate con `.venv/bin/hf auth login` antes de correr el servidor.
set -e
cd "$(dirname "$0")"
[ -d repo ] || git clone https://github.com/facebookresearch/sam-3d-body repo
git -C repo checkout -q b5c765a0d89d789985e186d396315e7590887b94   # la versión probada
[ -d .venv ] || python3.11 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
echo "Listo. Servidor: .venv/bin/python servidor.py   (escucha en 127.0.0.1:8793)"
