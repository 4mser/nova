#!/bin/bash
# NOVA con el "cerebro de demo" (Claude). La arquitectura de vuelo es el modelo de a bordo; esto es solo para la demo.
# La clave vive en el Llavero de macOS (nunca en archivos ni en la línea de comandos). Una sola vez, en tu Terminal:
#   security add-generic-password -s nova-anthropic -a nova -w
# (te pide la clave sin mostrarla). Usa una clave personal o del equipo, no la de una empresa.
set -e
CLAVE=$(security find-generic-password -s nova-anthropic -a nova -w 2>/dev/null || true)
if [ -z "$CLAVE" ]; then
  echo "No hay clave en el Llavero (servicio nova-anthropic). Guárdala con:"
  echo "  security add-generic-password -s nova-anthropic -a nova -w"
  exit 1
fi
cd "$(dirname "$0")/src-tauri"
pkill -f "target/debug/nova-tripulacion" 2>/dev/null || true
sleep 1
ANTHROPIC_API_KEY="$CLAVE" NOVA_CEREBRO=claude nohup target/debug/nova-tripulacion > /tmp/nova-trip.log 2>&1 &
echo "NOVA con cerebro de demo (Claude). Para volver al modelo de a bordo, abre NOVA normal."
