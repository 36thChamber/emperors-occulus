#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
printf '%s\n' 'Instalado. Execute ./scripts/launch.sh e abra http://localhost:8765'
