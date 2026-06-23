#!/usr/bin/env bash
# VIN-AIOS · pull the recommended on-prem model set.
#
# Defaults to the balanced tier (Qwen2.5 14B + nomic-embed-text). Override with
# env vars or pass `--tier fast|balanced|powerful` / `--family qwen|nemotron|gemma`.
#
# Usage:
#   ./scripts/setup-models.sh                 # default: Qwen 14B + embedder
#   ./scripts/setup-models.sh --tier fast     # 7B-class models
#   ./scripts/setup-models.sh --tier powerful # 32B+ models
#   ./scripts/setup-models.sh --family gemma  # Gemma family only
#   ./scripts/setup-models.sh --family nemotron
#   ./scripts/setup-models.sh --all           # pull everything (large download)

set -euo pipefail

OLLAMA_HOST="${OLLAMA_BASE_URL:-http://localhost:11434}"
TIER="balanced"
FAMILY="qwen"
PULL_ALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tier)   TIER="$2"; shift 2 ;;
    --family) FAMILY="$2"; shift 2 ;;
    --all)    PULL_ALL=true; shift ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if ! command -v ollama >/dev/null 2>&1; then
  if ! curl -fsS "${OLLAMA_HOST}/api/tags" >/dev/null 2>&1; then
    echo "✗ Ollama not found locally and ${OLLAMA_HOST} is unreachable."
    echo "  Install: https://ollama.com/download"
    echo "  Or run: docker compose up -d"
    exit 1
  fi
  echo "✓ Using remote Ollama at ${OLLAMA_HOST}"
  PULL() { curl -fsS -X POST "${OLLAMA_HOST}/api/pull" -d "{\"model\":\"$1\"}" | tail -1; }
else
  PULL() { ollama pull "$1"; }
fi

declare -a MODELS=()

if $PULL_ALL; then
  MODELS=(
    qwen2.5:7b qwen2.5:14b qwen2.5:32b
    nemotron-mini:4b nemotron:70b
    gemma2:9b gemma2:27b gemma3:12b
    nomic-embed-text mxbai-embed-large
  )
else
  case "${FAMILY}-${TIER}" in
    qwen-fast)        MODELS=(qwen2.5:7b nomic-embed-text) ;;
    qwen-balanced)    MODELS=(qwen2.5:14b nomic-embed-text) ;;
    qwen-powerful)    MODELS=(qwen2.5:32b nomic-embed-text) ;;
    nemotron-fast)    MODELS=(nemotron-mini:4b nomic-embed-text) ;;
    nemotron-balanced) MODELS=(nemotron-mini:4b nomic-embed-text) ;;
    nemotron-powerful) MODELS=(nemotron:70b nomic-embed-text) ;;
    gemma-fast)       MODELS=(gemma2:9b nomic-embed-text) ;;
    gemma-balanced)   MODELS=(gemma2:27b nomic-embed-text) ;;
    gemma-powerful)   MODELS=(gemma3:12b nomic-embed-text) ;;
    *) echo "Unknown family/tier combo: ${FAMILY}/${TIER}"; exit 1 ;;
  esac
fi

echo ""
echo "VIN-AIOS · pulling ${#MODELS[@]} model(s) from ${OLLAMA_HOST}"
printf "  • %s\n" "${MODELS[@]}"
echo ""

for m in "${MODELS[@]}"; do
  echo "──→ pulling $m"
  PULL "$m"
  echo "    ✓ $m ready"
done

echo ""
echo "✓ All models pulled. Edit .env to set OLLAMA_MODEL=${MODELS[0]} (or another), then:"
echo "    npm install && npm run start"
