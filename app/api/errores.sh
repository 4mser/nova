#!/bin/bash
# Últimos errores que reportó la app (por defecto 7 días):  api/errores.sh [días]
source ~/.nova-api
curl -s "https://nova-bn-api.fly.dev/v1/admin/errores?dias=${1:-7}" -H "x-admin: $NOVA_API_ADMIN" | node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  const l = JSON.parse(s);
  if (!Array.isArray(l)) return console.log(s);
  if (!l.length) return console.log("Sin errores en ese período.");
  for (const e of l) console.log(`${new Date(e.ts).toLocaleString("es-CL")}  ${e.fatal ? "FATAL " : ""}${e.nombre ?? "sin sesión"} · ${e.version} · ${e.plataforma} · ${e.donde ?? ""}\n  ${e.mensaje}\n  ${(e.pila ?? "").split("\n").slice(1, 4).join("\n  ")}\n`);
});'
