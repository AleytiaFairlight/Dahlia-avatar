#!/usr/bin/env bash
# Dahlia: fetches what the Android app's background listening needs, before the Android build: the
# sherpa-onnx Android library (ONNX Runtime linked in) into android/app/libs, and the wake word model
# that the web app uses too into android/app/src/main/assets/dahlia-kws. This file is Dahlia's (AIRI
# has no such file). The files are large, so they are fetched, not kept in git (.gitignore).
#
#   apps/stage-pocket/scripts/fetch-dahlia-kws.sh
set -euo pipefail
cd "$(dirname "$0")/../android"

readonly version="1.13.8"
readonly releases="https://github.com/k2-fsa/sherpa-onnx/releases/download"
readonly aar="app/libs/sherpa-onnx-static-link-onnxruntime-$version.aar"
readonly model="sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20"
readonly assets="app/src/main/assets/dahlia-kws"

# GitHub sends each connection slowly; parts in parallel are several times faster.
fetch() {
  local url="$1" out="$2" size parts=8 i start end
  size=$(curl -sfIL "$url" | tr -d '\r' | awk 'tolower($1) == "content-length:" { n = $2 } END { print n }')
  if [[ -z "$size" || "$size" -lt 1048576 ]]; then
    curl -sfL --retry 3 -o "$out" "$url"
    return
  fi
  local tmp; tmp=$(mktemp -d "${out}.parts.XXXX")
  for ((i = 0; i < parts; i++)); do
    start=$((i * size / parts)); end=$(((i + 1) * size / parts - 1))
    curl -sfL --retry 3 -r "$start-$end" -o "$tmp/$i" "$url" &
  done
  wait
  for ((i = 0; i < parts; i++)); do cat "$tmp/$i"; done > "$out"
  rm -rf "$tmp"
  [[ "$(wc -c < "$out")" -eq "$size" ]] || { echo "fetch-dahlia-kws: $url came incomplete" >&2; exit 1; }
}

mkdir -p app/libs
if [[ ! -f "$aar" ]]; then
  rm -f app/libs/sherpa-onnx-*.aar
  fetch "$releases/v$version/sherpa-onnx-static-link-onnxruntime-$version.aar" "$aar.tmp"
  mv "$aar.tmp" "$aar"
fi

if [[ ! -f "$assets/tokens.txt" ]]; then
  tmp=$(mktemp -d)
  fetch "$releases/kws-models/$model.tar.bz2" "$tmp/model.tar.bz2"
  tar -xjf "$tmp/model.tar.bz2" -C "$tmp"
  mkdir -p "$assets"
  # The same files as the web app's wake word (chunk 16, not quantized); the rest stays out of the app.
  for name in encoder decoder joiner; do
    cp "$tmp/$model/$name-epoch-13-avg-2-chunk-16-left-64.onnx" "$assets/$name.onnx"
  done
  cp "$tmp/$model/tokens.txt" "$assets/tokens.txt"
  rm -rf "$tmp"
fi

# Her name as the web app hears it (packages/stage-ui/src/libs/voice/dahlia-wake-word.ts): DAL-yuh,
# DAH-lyuh, DAY-lee-uh and DAH-lee-uh. Keep both lists the same.
cat > "$assets/keywords.txt" <<'KEYWORDS'
D AE1 L Y AH0 @Dahlia
D AA1 L Y AH0 @Dahlia
D EY1 L IY0 AH0 @Dahlia
D AA1 L IY0 AH0 @Dahlia
KEYWORDS

ls -l "$aar" "$assets"
