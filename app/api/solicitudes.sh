#!/bin/bash
# Solicitudes de acceso desde la página (nova-crew-web):
#   api/solicitudes.sh                    lista todas
#   api/solicitudes.sh avisarme correo    esa cuenta de NOVA recibe un aviso en el teléfono por cada solicitud nueva
#   api/solicitudes.sh no-avisar correo   deja de recibirlo
#   api/solicitudes.sh borrar N           borra la solicitud #N (por ejemplo, una de prueba)
source ~/.nova-api
API=${API:-https://nova-bn-api.fly.dev}
case "$1" in
  avisarme|no-avisar) python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"quitar":sys.argv[2]=="no-avisar"}))' "$2" "$1" \
      | curl -s -X POST "$API/v1/admin/avisos-acceso" -H "x-admin: $NOVA_API_ADMIN" -H 'content-type: application/json' --data-binary @-; echo; exit ;;
  borrar) curl -s -X DELETE "$API/v1/admin/solicitudes/$2" -H "x-admin: $NOVA_API_ADMIN"; echo; exit ;;
esac
curl -s "$API/v1/admin/solicitudes" -H "x-admin: $NOVA_API_ADMIN" | node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  const l = JSON.parse(s);
  if (!Array.isArray(l)) return console.log(s);
  if (!l.length) return console.log("Todavía nadie pidió acceso.");
  for (const x of l) console.log(`#${String(x.numero).padStart(4, "0")}  ${new Date(x.ts).toLocaleString("es-CL")}  ${x.nombre} <${x.email}>  ${x.para === "equipo" ? "equipo " + (x.equipo ?? "") : "para sí"} · ${x.telefono ?? "?"}\n        ${JSON.parse(x.usos || "[]").join(", ")}`);
  console.log(`\n${l.length} solicitudes`);
});'
