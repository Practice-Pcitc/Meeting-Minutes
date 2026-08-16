#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WORKSPACE=$(dirname "$SCRIPT_DIR")
PID_FILE="$WORKSPACE/.runtime/funasr-onnx.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "FunASR ONNX is not running."
  exit 0
fi

SERVICE_PID=$(cat "$PID_FILE")
case "$SERVICE_PID" in (*[!0-9]*|'') echo "Invalid FunASR PID file." >&2; exit 1;; esac
if kill -0 "$SERVICE_PID" 2>/dev/null; then
  kill "$SERVICE_PID"
fi
rm -f "$PID_FILE"
echo "FunASR ONNX stopped. PID: $SERVICE_PID"
