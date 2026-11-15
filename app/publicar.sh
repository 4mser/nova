#!/bin/bash
# Publica una actualización de NOVA (solo JS y assets) a los teléfonos con el APK del perfil `preview`.
# Los EXPO_PUBLIC_* se toman del perfil preview de eas.json, igual que en el APK: así la actualización apunta a la
# misma API y voz de producción. Si cambiaste algo nativo (paquete con código nativo, permisos, plugins en app.json),
# esto NO basta: sube la "version" de app.json y compila un APK nuevo.
#   ./publicar.sh "qué cambió"
#   RUNTIME=0.4.0 ./publicar.sh "qué cambió"   → publica para los APK de una versión anterior (solo si el JS nuevo
#   no necesita nada nativo que ese APK no tenga: los módulos nuevos deben cargarse con requireOptionalNativeModule)
set -e
cd "$(dirname "$0")"
MSG="${1:-$(git log -1 --pretty=%s)}"
eval "$(node -e 'const e=require("./eas.json").build.preview.env; for (const [k,v] of Object.entries(e)) console.log(`export ${k}=${JSON.stringify(v)}`)')"
if [ -n "$RUNTIME" ]; then
  cp app.json /tmp/nova-app.json.bak
  trap 'cp /tmp/nova-app.json.bak app.json' EXIT
  node -e 'const f="app.json",a=require("./"+f);a.expo.version=process.env.RUNTIME;require("fs").writeFileSync(f,JSON.stringify(a,null,2)+"\n")'
fi
npx eas-cli@latest update --channel preview --environment preview --platform android --message "$MSG" --non-interactive
