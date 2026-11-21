#!/usr/bin/env bash
# Scarica in ../dl i componenti Windows da includere nello zip (eseguire su Linux o Git Bash).
set -euo pipefail
cd "$(dirname "$0")/.." && mkdir -p dl && cd dl
ELECTRON=45.4.1; WHISPER=v1.9.2
curl -fL -o electron-win.zip "https://github.com/electron/electron/releases/download/v$ELECTRON/electron-v$ELECTRON-win32-x64.zip"
curl -fL -o whisper-bin-x64.zip "https://github.com/ggml-org/whisper.cpp/releases/download/$WHISPER/whisper-bin-x64.zip"
curl -fL -o yt-dlp.exe "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
curl -fL -o ffmpeg-win32-x64.gz "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz" && gunzip -f ffmpeg-win32-x64.gz
curl -fL -o deno.zip "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip" && unzip -o -q deno.zip -d denobin
# runtime Visual C++ (msvcp140, vcruntime140, vcruntime140_1, vcomp140) richiesto da whisper-cli
pip download msvc-runtime==14.51.36231 --platform win_amd64 --only-binary=:all: --no-deps -d vcrt
(cd vcrt && unzip -o -q ./*.whl -d x)
echo "Componenti pronti in $(pwd)"
