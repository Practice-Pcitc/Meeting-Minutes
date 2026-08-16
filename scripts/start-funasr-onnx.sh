#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WORKSPACE=$(dirname "$SCRIPT_DIR")
RUNTIME="$WORKSPACE/.runtime"
PID_FILE="$RUNTIME/funasr-onnx.pid"
OUT_LOG="$RUNTIME/funasr-onnx.out.log"
ERROR_LOG="$RUNTIME/funasr-onnx.error.log"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is missing. Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  exit 1
fi
if curl -fsS http://127.0.0.1:10095/health >/dev/null 2>&1; then
  echo "FunASR ONNX is already running."
  exit 0
fi

mkdir -p "$RUNTIME"
cd "$WORKSPACE"
nohup uv run --project tools --locked uvicorn tools.funasr_onnx_server:app --host 127.0.0.1 --port 10095 >"$OUT_LOG" 2>"$ERROR_LOG" &
SERVICE_PID=$!
echo "$SERVICE_PID" >"$PID_FILE"
echo "FunASR ONNX started. PID: $SERVICE_PID"
