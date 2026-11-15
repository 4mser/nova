#!/bin/bash
# Actualiza SOLO el código del puente de voz (voz.mjs) en Fly. No toca las claves: desplegar.sh genera un NOVA_TOKEN
# nuevo y dejaría sin voz a todos los APK instalados (el token va dentro del APK). Usar este para cada cambio.
set -e
cd "$(dirname "$0")"
flyctl deploy "$(pwd)" --app nova-voz --remote-only --ha=false
curl -s https://nova-voz.fly.dev/salud && echo "  ← voz de NOVA actualizada"
