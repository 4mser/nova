"""Bucles de ejecución: en vivo (ventana), video a video (sin ventana) y calibración sin ventana."""
from __future__ import annotations

import time
from pathlib import Path

import cv2

from .diagnostico import Ausencia
from .dibujo import guiar
from .fuente import EXT_IMAGEN, Reloj, abrir_fuente, describir_camara
from .sesion import CARPETA_SESIONES, Grabador, Procesador, estado_a_json

VENTANA = "pose-twin  [q] salir  [g] grabar  [c] calibrar  [e] enderezar"


def _csv_por_defecto() -> Path:
    return CARPETA_SESIONES / time.strftime("sesion_%Y%m%d_%H%M%S.csv")


def _opciones_camara(args) -> dict:
    return {"captura": getattr(args, "captura", "hilo"), "backend": getattr(args, "backend", "auto"),
            "ancho": getattr(args, "ancho", None), "alto": getattr(args, "alto", None),
            "fps_camara": getattr(args, "fps_camara", None), "fourcc": getattr(args, "fourcc", None),
            "exposicion": getattr(args, "exposicion", None)}


def _aviso_camara_lenta(fps_camara: float) -> str:
    return (f"Aviso: la cámara entrega {fps_camara:.1f} FPS. Con poca luz la exposición automática alarga cada "
            f"cuadro (a ~10 FPS = ~100 ms de exposición). Da más luz o fija la exposición: --exposicion -5 "
            f"(1/32 s, imagen más oscura).")


def ejecutar_vivo(args) -> int:
    # el modelo primero: si falla, la cámara ni se enciende
    proc = Procesador(modelo=args.modelo, enderezar=args.enderezar, umbral_vis=args.umbral_vis,
                      nombre_perfil=args.perfil, csv_ruta=None if args.sin_csv else _csv_por_defecto(),
                      delegado=args.delegado, segundos_preparacion=6.0, segundos_calibracion=6.0)
    try:
        fuente = abrir_fuente(args.source, host=args.host, puerto=args.puerto, **_opciones_camara(args))
    except BaseException:
        proc.cerrar()
        raise
    diagnostico = getattr(args, "diagnostico", False)
    proc.crono.activo = diagnostico
    crono = proc.crono
    ventana = not args.sin_ventana
    minutos = getattr(args, "cerrar_sin_persona", 5.0)
    ausencia = Ausencia(None if fuente.es_archivo else minutos)  # en archivos manda el fin del archivo
    max_seg = getattr(args, "max_segundos", 0) or 0
    t_arranque = time.monotonic()
    avisado_lenta = False
    reloj = Reloj()
    tam_ultimo = None
    fps_cam, descartados = 0.0, None
    try:
        print(f"Fuente: {fuente.nombre} | modelo {args.modelo} | delegado {proc.motor.delegado}", flush=True)
        if hasattr(fuente, "cap") and not fuente.es_archivo:
            print(f"Cámara: {describir_camara(fuente.cap)}", flush=True)
        if args.perfil and proc.perfil is None:
            print(f"No existe el perfil '{args.perfil}': pulsa [c] para crearlo.")
        if ventana:
            cv2.namedWindow(VENTANA, cv2.WINDOW_NORMAL)
        while True:
            t_inicio = time.perf_counter()
            ok, img, t_ms = fuente.leer()
            t_leido = time.perf_counter()
            crono.medir("captura", (t_leido - t_inicio) * 1000)
            if not ok:
                print("Fin de la fuente.")
                break
            ordenes = fuente.comandos()
            persona = False
            t_cap = None
            if img is not None:
                # instante en que llegó el cuadro: lo marca el hilo de captura o el teléfono; si no, al leerlo
                t_cap = getattr(fuente, "ultimo_t_captura", None) or t_leido
                anotada, estado = proc.paso(img, None if not fuente.es_archivo else t_ms, reloj.tic(), t_cap)
                persona = estado["pose"] is not None
                tam_ultimo = (anotada.shape[1], anotada.shape[0])
                fuente.responder(estado_a_json(estado))
            tecla = -1
            t_pantalla = time.perf_counter()
            if ventana:
                if img is not None:
                    cv2.imshow(VENTANA, guiar(anotada, estado, args.umbral_vis))
                espera = 1
                if fuente.es_archivo:  # reproduce el archivo a su velocidad real
                    espera = max(1, int(1000 / fuente.fps - (time.perf_counter() - t_inicio) * 1000))
                tecla = cv2.waitKey(espera) & 0xFF
                if cv2.getWindowProperty(VENTANA, cv2.WND_PROP_VISIBLE) < 1:
                    break
            if img is not None:
                crono.medir("pantalla", (time.perf_counter() - t_pantalla) * 1000)
                crono.cerrar_cuadro(persona, (time.perf_counter() - t_cap) * 1000)
            if img is not None and ausencia.ver(persona):
                print(f"Sin persona durante {minutos:g} min: cierro la sesión para apagar la cámara.", flush=True)
                break
            if max_seg and time.monotonic() - t_arranque >= max_seg:
                break
            fps_cam = getattr(fuente, "fps_entrega", 0.0)
            if not avisado_lenta and fps_cam and time.monotonic() - t_arranque > 3 and fps_cam < 20:
                print(_aviso_camara_lenta(fps_cam), flush=True)
                avisado_lenta = True
            if tecla in (ord("q"), 27):
                break
            if tecla == ord("g"):
                ordenes.append("grabar")
            if tecla == ord("c"):
                ordenes.append("calibrar")
            if tecla == ord("e"):
                ordenes.append("enderezar")
            for o in ordenes:
                if o == "grabar" and tam_ultimo:
                    proc.alternar_grabacion(fuente.fps if fuente.es_archivo else max(5.0, min(30.0, reloj.fps or 15)), tam_ultimo)
                elif o == "calibrar":
                    proc.iniciar_calibracion()
                elif o == "enderezar":
                    proc.alternar_enderezado()
    except KeyboardInterrupt:
        pass
    finally:
        fps_cam = getattr(fuente, "fps_entrega", 0.0)
        descartados = getattr(fuente, "descartados", None)
        try:
            fuente.cerrar()  # primero la cámara: que se apague pase lo que pase después
        finally:
            proc.cerrar()
            if ventana:
                cv2.destroyAllWindows()
    if diagnostico:
        print(crono.texto())
        if fps_cam:
            print(f"  la cámara entregó {fps_cam:.1f} FPS (últimos 60 cuadros); descartados por llegar "
                  f"mientras se procesaba otro: {descartados}")
        if crono.filas:
            ruta = crono.guardar_csv(CARPETA_SESIONES / time.strftime("diagnostico_%Y%m%d_%H%M%S.csv"))
            print(f"Tiempos por cuadro: {ruta}")
    return 0


def ejecutar_video(args) -> int:
    """Genera el video (o imagen) anotado sin ventana."""
    entrada, salida = Path(args.entrada), Path(args.salida)
    salida.parent.mkdir(parents=True, exist_ok=True)
    csv_ruta = Path(args.csv) if args.csv else (None if args.sin_csv else salida.with_suffix(".csv"))
    proc = Procesador(modelo=args.modelo, enderezar=args.enderezar, umbral_vis=args.umbral_vis,
                      nombre_perfil=args.perfil, csv_ruta=csv_ruta, delegado=args.delegado)
    es_imagen = entrada.suffix.lower() in EXT_IMAGEN
    fuente = abrir_fuente(str(entrada), repeticiones=args.repeticiones if es_imagen else None)
    print(f"Procesando {entrada.name} | modelo {args.modelo} | delegado {proc.motor.delegado}", flush=True)
    grab = None
    n, detectados, t0 = 0, 0, time.perf_counter()
    reloj = Reloj()
    ultima = None
    try:
        while True:
            ok, img, t_ms = fuente.leer()
            if not ok:
                break
            anotada, estado = proc.paso(img, t_ms, reloj.tic())
            n += 1
            detectados += estado["pose"] is not None
            ultima = anotada
            if not es_imagen or salida.suffix.lower() not in EXT_IMAGEN:
                if grab is None:
                    grab = Grabador(salida, fuente.fps, (anotada.shape[1], anotada.shape[0]))
                grab.escribir(anotada)
            if args.max_cuadros and n >= args.max_cuadros:
                break
            if n % 50 == 0:
                print(f"  {n} cuadros...", flush=True)
    finally:
        if grab:
            grab.cerrar()
        proc.cerrar()
        fuente.cerrar()
    if es_imagen and salida.suffix.lower() in EXT_IMAGEN and ultima is not None:
        cv2.imwrite(str(salida), ultima)
    seg = time.perf_counter() - t0
    if n == 0:
        print("No se leyó ningún cuadro.")
        return 1
    print(f"Listo: {salida} | {n} cuadros, persona en {detectados} ({100 * detectados / n:.0f}%), "
          f"{1000 * seg / n:.0f} ms/cuadro de media")
    return 0


def ejecutar_calibrar(args) -> int:
    """Calibra un perfil sin ventana a partir de una fuente (útil con archivos de prueba)."""
    proc = Procesador(modelo=args.modelo, nombre_perfil=args.nombre, delegado=args.delegado,
                      segundos_calibracion=args.segundos)
    fuente = abrir_fuente(args.source, repeticiones=None, host=getattr(args, "host", None), **_opciones_camara(args))
    proc.perfil = None  # se recalcula aunque ya existiera
    proc.iniciar_calibracion()
    reloj = Reloj()
    try:
        while True:
            ok, img, t_ms = fuente.leer()
            if not ok:
                break
            if img is None:
                continue
            proc.paso(img, t_ms if fuente.es_archivo else None, reloj.tic())
            if not proc.calibrador.activo and not proc._calib_pendiente:
                break
    finally:
        proc.cerrar()
        fuente.cerrar()
    if proc.perfil is None:
        print("No se pudo crear el perfil (ver mensajes anteriores).")
        return 1
    return 0
