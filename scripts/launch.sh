#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export OCCULUS_PORT="${OCCULUS_PORT:-8765}"
if ! curl -fsS "http://127.0.0.1:$OCCULUS_PORT/health" 2>/dev/null | grep -q 'emperors-occulus'; then
  mkdir -p "$HOME/.local/state/emperors-occulus"
  nohup .venv/bin/python -m occulus.app > "$HOME/.local/state/emperors-occulus/server.log" 2>&1 < /dev/null &
fi
for attempt in {1..30}; do
  if curl -fsS "http://127.0.0.1:$OCCULUS_PORT/health" 2>/dev/null | grep -q 'emperors-occulus'; then exit 0; fi
  sleep 1
done
echo 'Não foi possível iniciar o Occulus. Consulte ~/.local/state/emperors-occulus/server.log' >&2
exit 1
