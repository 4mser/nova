#!/bin/zsh
# Re-encodes a high-quality Spanish render to web size, like the English files (x264 CRF 23 phone / 24 desktop, ref 10)
cd "${0:A:h}/../.."
ffmpeg -v error -y -i "$1" -map 0:v -map 0:a -c:v libx264 -preset slow -refs 10 -crf "$2" -pix_fmt yuv420p -c:a copy -movflags +faststart "$1.tmp.mp4" && mv "$1.tmp.mp4" "$1" && echo "✓ $1 $(du -h $1 | cut -f1)"
