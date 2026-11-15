#!/bin/bash
# Manda un aviso de prueba a una cuenta (para verificar los push):  api/push-prueba.sh correo@dominio
source ~/.nova-api
curl -s -X POST https://nova-bn-api.fly.dev/v1/admin/push-prueba -H "x-admin: $NOVA_API_ADMIN" -H 'content-type: application/json' -d "{\"email\":\"$1\"}"; echo
