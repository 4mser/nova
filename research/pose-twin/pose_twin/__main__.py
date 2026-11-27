"""CLI: python -m pose_twin {live,video,calibrar,bench}"""
from __future__ import annotations

import argparse
import os
import sys

# Silencia los registros de glog/TFLite de MediaPipe (deben fijarse antes de importarlo)
os.environ.setdefault("GLOG_minloglevel", "2")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")


def _comunes(p: argparse.ArgumentParser) -> None:
    p.add_argument("--modelo", choices=["full", "heavy"], default="heavy", help="modelo MediaPipe (heavy = más preciso)")
    p.add_argument("--delegado", choices=["auto", "gpu", "cpu"], default="auto")
    p.add_argument("--umbral-vis", type=float, default=0.6, help="visibilidad mínima para no abstenerse (0-1)")
    p.add_argument("--perfil", default=None, help="nombre del perfil en data/perfiles/ para comparar")
    p.add_argument("--enderezar", action="store_true", help="activa el enderezado por rotación desde el inicio")


def construir_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="pose_twin", description="Seguimiento corporal de una persona en tiempo real.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    lv = sub.add_parser("live", help="ventana en vivo")
    lv.add_argument("--source", default="0", help="índice de cámara, archivo de video/imagen, URL o 'telefono'")
    lv.add_argument("--host", default=None, help="(teléfono) IP donde escuchar; por defecto la IP de la LAN")
    lv.add_argument("--puerto", type=int, default=8443, help="(teléfono) puerto HTTPS")
    lv.add_argument("--sin-ventana", action="store_true", help="no abre ventana (útil con el teléfono)")
    lv.add_argument("--sin-csv", action="store_true", help="no guarda el CSV de la sesión")
    _comunes(lv)

    vd = sub.add_parser("video", help="genera un video anotado sin ventana")
    vd.add_argument("--in", dest="entrada", required=True)
    vd.add_argument("--out", dest="salida", required=True)
    vd.add_argument("--csv", default=None, help="ruta del CSV (por defecto junto al video de salida)")
    vd.add_argument("--sin-csv", action="store_true")
    vd.add_argument("--max-cuadros", type=int, default=0)
    vd.add_argument("--repeticiones", type=int, default=30, help="si la entrada es imagen: cuadros a generar")
    _comunes(vd)

    cb = sub.add_parser("calibrar", help="crea un perfil personal sin ventana")
    cb.add_argument("--source", required=True)
    cb.add_argument("--nombre", required=True)
    cb.add_argument("--segundos", type=float, default=4.0)
    cb.add_argument("--modelo", choices=["full", "heavy"], default="heavy")
    cb.add_argument("--delegado", choices=["auto", "gpu", "cpu"], default="auto")

    bn = sub.add_parser("bench", help="compara modelos frente a la rotación")
    bn.add_argument("--video", default="data/muestras/sentadilla.webm")
    bn.add_argument("--imagen", default="data/muestras/pose.jpg")
    bn.add_argument("--modelos", default="full,heavy,rtmpose")
    bn.add_argument("--paso-video", type=int, default=30, help="grados entre rotaciones del video")
    bn.add_argument("--paso-img", type=int, default=15, help="grados entre rotaciones de la imagen")
    bn.add_argument("--cada", type=int, default=3, help="usar 1 de cada N cuadros del video")
    bn.add_argument("--max-cuadros", type=int, default=80)
    bn.add_argument("--ancho", type=int, default=640, help="reescala el video a este ancho")
    return ap


def main(argv=None) -> int:
    for flujo in (sys.stdout, sys.stderr):  # la consola de Windows usa cp1252 por defecto
        if hasattr(flujo, "reconfigure"):
            flujo.reconfigure(encoding="utf-8", errors="replace")
    args = construir_parser().parse_args(argv)
    from .fuente import ErrorFuente
    from .motor import ErrorModelo

    try:
        if args.cmd == "live":
            from .vivo import ejecutar_vivo

            return ejecutar_vivo(args)
        if args.cmd == "video":
            from .vivo import ejecutar_video

            return ejecutar_video(args)
        if args.cmd == "calibrar":
            from .vivo import ejecutar_calibrar

            return ejecutar_calibrar(args)
        if args.cmd == "bench":
            from .bench import ejecutar_bench

            return ejecutar_bench(args)
    except (ErrorFuente, ErrorModelo) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2
    return 1


if __name__ == "__main__":
    sys.exit(main())
