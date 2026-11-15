#!/bin/zsh
cd "${0:A:h}/.."
B=http://127.0.0.1:8931
for x in "en:vertical:nova-movil:video" "es:vertical-es:nova-movil:video/es"; do
  IFS=: read l v n d <<< "$x"
  for i in 1 2 3; do
    AUD=render/mezcla-$l.wav node render/render.js "$B/render/$v.html" 1080 1920 1 render/movil-$l.mp4 > render/movil-$l.log 2>&1 && grep -q "✓" render/movil-$l.log && break
    echo "reintento $l $i"
  done
  ffmpeg -v error -y -i render/movil-$l.mp4 -map 0:v -map 0:a -c:v libx264 -preset slow -refs 10 -crf 23 -pix_fmt yuv420p -c:a copy -movflags +faststart $d/$n.tmp.mp4 && mv $d/$n.tmp.mp4 $d/$n.mp4 && echo "✓ $d/$n.mp4 $(du -h $d/$n.mp4 | cut -f1)"
done
echo FIN
