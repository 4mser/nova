/* Atajos del ícono (Android): al mantener presionado el ícono de NOVA aparecen accesos directos.
   Cada uno es un enlace nova://… que expo-router abre en su pantalla (salvo «Escúchame», que abre la capa del asistente). Sin librerías: res/xml/shortcuts.xml +
   el meta-data en la actividad principal. Los textos van en español (la crew usa la app en español). */
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const ATAJOS = [
  // «Escúchame» abre la capa del asistente (modules/nova-control) sobre lo que estés usando, no la app
  { id: 'escuchar', corto: 'Escúchame', largo: 'NOVA te escucha', accion: 'solutions.bn.nova.ESCUCHAR', clase: 'expo.modules.novacontrol.NovaAsistenteActivity' },
  { id: 'foco', corto: 'Foco', largo: 'Empezar una sesión de foco', uri: 'nova://foco' },
  { id: 'momento', corto: 'Mi momento', largo: 'Compartir mi momento con la crew', uri: 'nova://compartir' },
  { id: 'nova', corto: 'Hablar', largo: 'Hablar con NOVA', uri: 'nova://nova' },
  { id: 'habitos', corto: 'Hábitos', largo: 'Marcar mis hábitos de hoy', uri: 'nova://habitos' },
];

const xml = paquete => `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${ATAJOS.map(a => `  <shortcut android:shortcutId="${a.id}" android:enabled="true" android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="@string/atajo_${a.id}_corto" android:shortcutLongLabel="@string/atajo_${a.id}_largo">
    ${a.clase
      ? `<intent android:action="${a.accion}" android:targetPackage="${paquete}" android:targetClass="${a.clase}" />`
      : `<intent android:action="android.intent.action.VIEW" android:targetPackage="${paquete}" android:targetClass="${paquete}.MainActivity" android:data="${a.uri}" />`}
  </shortcut>`).join('\n')}
</shortcuts>
`;

module.exports = function conAtajos(config) {
  const paquete = config.android?.package;
  config = withDangerousMod(config, ['android', async c => {
    const res = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res');
    fs.mkdirSync(path.join(res, 'xml'), { recursive: true });
    fs.writeFileSync(path.join(res, 'xml/shortcuts.xml'), xml(paquete));
    const strings = path.join(res, 'values/strings.xml');
    let s = fs.readFileSync(strings, 'utf8').replace(/\s*<string name="atajo_[^"]+">[^<]*<\/string>/g, '');
    const nuevas = ATAJOS.flatMap(a => [`  <string name="atajo_${a.id}_corto">${a.corto}</string>`, `  <string name="atajo_${a.id}_largo">${a.largo}</string>`]).join('\n');
    s = s.replace('</resources>', `${nuevas}\n</resources>`);
    fs.writeFileSync(strings, s);
    return c;
  }]);
  return withAndroidManifest(config, c => {
    const act = c.modResults.manifest.application?.[0]?.activity?.find(a => a.$['android:name'] === '.MainActivity');
    if (act) {
      act['meta-data'] = (act['meta-data'] ?? []).filter(m => m.$['android:name'] !== 'android.app.shortcuts');
      act['meta-data'].push({ $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/shortcuts' } });
    }
    return c;
  });
};
