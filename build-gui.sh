#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

python3 -c 'import tkinter' 2>/dev/null || {
  echo "错误：缺少 Tkinter。Ubuntu/Pop!_OS 请安装 python3-tk。" >&2
  exit 1
}

python3 -m nuitka \
  --onefile \
  --enable-plugin=tk-inter \
  --output-dir=dist \
  --output-filename=PolyChat-GUI \
  --remove-output \
  clients/gui.py

echo "构建完成：$(pwd)/dist/PolyChat-GUI"
