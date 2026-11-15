#!/bin/zsh
# Renders horizontales de a uno, con reintento si la página no arranca
cd "${0:A:h}/.."
B=http://127.0.0.1:8931
for x in "en:motor:nova-pc:video" "es:motor-es:nova-pc:video/es"; do
  IFS=: read l m n d <<< "$x"
  for i in 1 2 3; do
    AUD=render/mezcla-$l.wav node render/render.js "$B/$m/motor.html?render" 1920 1080 1.3333334 render/pc-$l.mp4 > render/pc-$l.log 2>&1 && grep -q "✓" render/pc-$l.log && break
    echo "reintento $l $i"
  done
  ffmpeg -v error -y -i render/pc-$l.mp4 -map 0:v -map 0:a -c:v libx264 -preset slow -refs 10 -crf 24 -pix_fmt yuv420p -c:a copy -movflags +faststart $d/$n.tmp.mp4 && mv $d/$n.tmp.mp4 $d/$n.mp4 && echo "✓ $d/$n.mp4 $(du -h $d/$n.mp4 | cut -f1)"
done
echo FIN
