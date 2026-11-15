#!/bin/bash
# Escribe ya el resumen semanal de NOVA en la bitácora de la crew de esa cuenta (sin esperar al viernes):
#   api/resumen-prueba.sh correo@dominio          → sin aviso push
#   PUSH=1 api/resumen-prueba.sh correo@dominio   → también avisa a la crew
source ~/.nova-api
P=false; [ -n "$PUSH" ] && P=true
curl -s -X POST https://nova-bn-api.fly.dev/v1/admin/resumen-prueba -H "x-admin: $NOVA_API_ADMIN" -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"push\":$P}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).texto??s)}catch{console.log(s)}})"
