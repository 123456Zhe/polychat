#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

python3 -c 'import tkinter, PIL, matplotlib, nuitka' 2>/dev/null || {
  echo "错误：缺少 GUI 构建依赖。请先运行：python3 -m pip install -r requirements-gui.txt" >&2
  echo "Ubuntu/Pop!_OS 还需要安装 python3-tk、gcc 和 patchelf。" >&2
  exit 1
}

python3 -m nuitka \
  --onefile \
  --enable-plugin=tk-inter \
  --include-package-data=matplotlib \
  --include-data-file=assets/polychat-icon.png=polychat-icon.png \
  --output-dir=dist \
  --output-filename=PolyChat-GUI \
  --remove-output \
  clients/gui.py

echo "构建完成：$(pwd)/dist/PolyChat-GUI"
