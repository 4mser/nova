#!/bin/bash
# Crea (o cambia la clave de) una cuenta de NOVA:  ./cuenta.sh correo@x.cl "Nombre" 'clave-de-8+'
# Sin argumentos lista las cuentas. API=http://localhost:8140 para la local.
set -e
source ~/.nova-api
API=${API:-https://nova-bn-api.fly.dev}
if [ -z "$1" ]; then curl -s "$API/v1/admin/cuentas" -H "x-admin: $NOVA_API_ADMIN"; echo; exit; fi
[ -n "$3" ] || { echo "uso: ./cuenta.sh correo nombre clave"; exit 1; }
python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"nombre":sys.argv[2],"clave":sys.argv[3]}))' "$1" "$2" "$3" \
  | curl -s -X POST "$API/v1/admin/cuentas" -H "x-admin: $NOVA_API_ADMIN" -H 'content-type: application/json' --data-binary @-
echo
