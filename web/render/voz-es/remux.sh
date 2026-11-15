#!/bin/zsh
# Replaces the audio of a rendered Spanish video with the final mix (video stream copied)
cd "${0:A:h}/../.."
ffmpeg -v error -y -i "$1" -i render/voz-es/mezcla-es.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -movflags +faststart -shortest "$1.tmp.mp4" && mv "$1.tmp.mp4" "$1" && echo "✓ $1"
