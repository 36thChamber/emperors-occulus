#!/usr/bin/env bash
set -euo pipefail
# Stop only the viewer process; do not affect AWS or other Python applications.
pkill -u "$(id -u)" -f '^.venv/bin/python -m occulus.app$' || true
