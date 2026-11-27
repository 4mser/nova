"""Lógica de escaner/figura.mjs (tamaño de la figura 3D según el perfil), comprobada con node."""
import shutil
import subprocess
from pathlib import Path

import pytest

PRUEBA = Path(__file__).resolve().parents[1] / "escaner" / "pruebas" / "figura.mjs"
NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="requiere node")
def test_figura_mjs():
    r = subprocess.run([NODE, str(PRUEBA)], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr
