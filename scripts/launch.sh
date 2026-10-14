#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project_dir="$PWD"
export OCCULUS_PORT="${OCCULUS_PORT:-8765}"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/emperors-occulus.service" <<EOF
[Unit]
Description=Emperor's Occulus local viewer
After=network.target
[Service]
Type=simple
WorkingDirectory=$project_dir
ExecStart=$project_dir/.venv/bin/python -m occulus.app
Restart=on-failure
RestartSec=3
Environment=PYTHONUNBUFFERED=1
Environment=OCCULUS_PORT=$OCCULUS_PORT
Environment=OCCULUS_WSL_ACCESS=1
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user start emperors-occulus.service
for attempt in {1..30}; do
  if curl -fsS "http://127.0.0.1:$OCCULUS_PORT/health" 2>/dev/null | grep -q 'emperors-occulus'; then exit 0; fi
  sleep 1
done
echo 'Falha ao iniciar. Consulte journalctl --user -u emperors-occulus.service' >&2
exit 1
