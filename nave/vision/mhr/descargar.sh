#!/bin/sh
# MHR (Momentum Human Rig, Meta, Apache-2.0): el cuerpo armado que va a reemplazar el esqueleto hecho a mano del gemelo.
# Baja el código (para leer cómo se evalúa) y los archivos del modelo: rig.npz (esqueleto de 127 articulaciones,
# parámetros, red de correcciones) y lod1.npz (piel de 18.439 vértices con 8 pesos, 117 formas, 3.000 correcciones).
set -e
cd "$(dirname "$0")"
[ -d repo ] || git clone https://github.com/facebookresearch/MHR repo
git -C repo checkout -q 137525d1f27011afe65e475b9b3071518d43f954
gh release download v1.2.2 -R facebookresearch/MHR -p 'mhr-assets-v1-common.zip' -p 'mhr-assets-v1-lod1.zip' -p 'mhr-assets-v1.json' --clobber
for z in mhr-assets-v1-common.zip mhr-assets-v1-lod1.zip; do unzip -oq "$z" -d assets; done
ls -la assets
