#!/bin/zsh
# Video en inglés: escritorio (2560×1440) y teléfono (1080×1920), de a uno, con reintento si la página no arranca
cd "${0:A:h}/.."
B=http://127.0.0.1:8931
for x in "motor/motor.html?render:1920:1080:1.3333334:pc-en:nova-pc:24" "render/vertical.html:1080:1920:1:movil-en:nova-movil:23"; do
  IFS=: read u w h dpr out n crf <<< "$x"
  for i in 1 2 3; do
    AUD=render/mezcla-en.wav node render/render.js "$B/$u" $w $h $dpr render/$out.mp4 > render/$out.log 2>&1 && grep -q "✓" render/$out.log && break
    echo "reintento $out $i"
  done
  ffmpeg -v error -y -i render/$out.mp4 -map 0:v -map 0:a -c:v libx264 -preset slow -refs 10 -crf $crf -pix_fmt yuv420p -c:a copy -movflags +faststart video/$n.tmp.mp4 && mv video/$n.tmp.mp4 video/$n.mp4 && echo "✓ video/$n.mp4 $(du -h video/$n.mp4 | cut -f1)"
done
echo FIN
