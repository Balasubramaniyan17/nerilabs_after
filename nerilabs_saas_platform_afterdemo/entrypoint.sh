#!/bin/bash
set -e

# Ensure data directory exists if DATABASE_PATH is provided
if [ -n "$DATABASE_PATH" ]; then
    mkdir -p "$(dirname "$DATABASE_PATH")" 2>/dev/null || true
fi

PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"
WORKERS="${WORKERS:-4}"

echo "============================================================"
echo " Starting NeriLabs SaaS on $HOST:$PORT"
echo " Concurrency: $WORKERS workers | Mode: Production"
echo "============================================================"

exec uvicorn saas_platform.server:app     --host "$HOST"     --port "$PORT"     --workers "$WORKERS"     --proxy-headers     --forwarded-allow-ips="*"
