#!/bin/zsh
# Mixes the Spanish narration over the original music bed with ducking, matched to the English mix (-15 LUFS)
cd "${0:A:h}/../.."
VG=${VG:-1.0}
ffmpeg -v error -y -i render/voz-es/narracion-es.wav -i musica/nova-musica.mp3 -filter_complex \
 "[0:a]volume=${VG},asplit=2[v][sc];[1:a]volume=${MG:-0.67}[m];[m][sc]sidechaincompress=threshold=0.02:ratio=5:attack=35:release=400:makeup=1[md];[v][md]amix=inputs=2:normalize=0,atrim=0:249.2[o]" \
 -map "[o]" -ar 48000 -ac 2 render/voz-es/mezcla-pre.wav
I=$(ffmpeg -hide_banner -i render/voz-es/mezcla-pre.wav -af ebur128 -f null - 2>&1 | grep "I:" | tail -1 | awk '{print $2}')
G=$(python3 -c "print(-15.0-($I))")
ffmpeg -v error -y -i render/voz-es/mezcla-pre.wav -af "volume=${G}dB,alimiter=limit=0.95:attack=5:release=50" -ar 48000 render/voz-es/mezcla-es.wav
echo "pre $I LUFS, ganancia $G dB"
