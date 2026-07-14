#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

VENV_DIR=".venv-gui"
PYTHON="$VENV_DIR/bin/python"

if [ ! -x "$PYTHON" ]; then
  echo "正在创建 GUI 专用 Python 环境…"
  python3 -m venv "$VENV_DIR" || {
    echo "错误：无法创建虚拟环境。Ubuntu/Pop!_OS 请先安装 python3-venv。" >&2
    exit 1
  }
fi

echo "正在准备 Flet 构建依赖…"
"$PYTHON" -m pip install --disable-pip-version-check -q -r requirements-gui.txt || {
  echo "错误：无法安装 GUI 构建依赖。请检查网络后重试。" >&2
  exit 1
}

rm -rf dist/PolyChat-GUI dist/gui.build
"$VENV_DIR/bin/flet" pack clients/gui.py \
  --name PolyChat-GUI \
  --icon assets/polychat-icon.png \
  --distpath dist \
  --yes

rm -rf build PolyChat-GUI.spec
echo "构建完成：$(pwd)/dist/PolyChat-GUI"
