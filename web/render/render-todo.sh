#!/bin/zsh
# Renderiza las cuatro versiones (inglés/español × escritorio/teléfono) y las deja en tamaño web en video/
cd "${0:A:h}/.."
B=http://127.0.0.1:8931
(AUD=render/mezcla-en.wav node render/render.js "$B/motor/motor.html?render" 1920 1080 1.3333334 render/pc-en.mp4 > render/pc.log 2>&1; \
 AUD=render/mezcla-en.wav node render/render.js "$B/render/vertical.html" 1080 1920 1 render/movil-en.mp4 > render/movil.log 2>&1) &
(AUD=render/mezcla-es.wav node render/render.js "$B/motor-es/motor.html?render" 1920 1080 1.3333334 render/pc-es.mp4 > render/pc-es.log 2>&1; \
 AUD=render/mezcla-es.wav node render/render.js "$B/render/vertical-es.html" 1080 1920 1 render/movil-es.mp4 > render/movil-es.log 2>&1) &
wait
for x in "pc-en:nova-pc:24:video" "pc-es:nova-pc:24:video/es" "movil-en:nova-movil:23:video" "movil-es:nova-movil:23:video/es"; do
  IFS=: read a n crf d <<< "$x"
  ffmpeg -v error -y -i render/$a.mp4 -map 0:v -map 0:a -c:v libx264 -preset slow -refs 10 -crf $crf -pix_fmt yuv420p -c:a copy -movflags +faststart $d/$n.mp4 && echo "✓ $d/$n.mp4 $(du -h $d/$n.mp4 | cut -f1)"
done
echo FIN
