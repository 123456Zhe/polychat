#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/clients"
exec python3 gui.py "$@"
