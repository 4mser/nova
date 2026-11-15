#!/bin/bash
# Instala (o reinstala) el respaldo diario de NOVA en este Mac: un agente de launchd que corre api/respaldar.mjs
# todos los días a las 13:00 (si el Mac estaba dormido, corre al despertar). Log en ~/Respaldos/nova/respaldo.log.
# Desinstalar: launchctl bootout gui/$(id -u)/solutions.bn.nova.respaldo && rm ~/Library/LaunchAgents/solutions.bn.nova.respaldo.plist
set -e
cd "$(dirname "$0")"
NODE=$(command -v /opt/homebrew/opt/node@22/bin/node || command -v node)
ETQ=solutions.bn.nova.respaldo
PLIST=~/Library/LaunchAgents/$ETQ.plist
mkdir -p ~/Respaldos/nova ~/Library/LaunchAgents
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$ETQ</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$(pwd)/respaldar.mjs</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>13</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Respaldos/nova/respaldo.log</string>
  <key>StandardErrorPath</key><string>$HOME/Respaldos/nova/respaldo.log</string>
</dict></plist>
PL
launchctl bootout gui/$(id -u)/$ETQ 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$PLIST"
echo "Respaldo diario instalado ($NODE). Probar ahora: launchctl kickstart gui/$(id -u)/$ETQ"
