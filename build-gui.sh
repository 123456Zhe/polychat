#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

python3 -c 'import flet' 2>/dev/null || {
  echo "错误：缺少 GUI 构建依赖。请先运行：python3 -m pip install -r requirements-gui.txt" >&2
  exit 1
}

rm -rf dist/PolyChat-GUI
flet build linux clients \
  --module-name gui \
  --project polychat \
  --product PolyChat \
  --artifact PolyChat-GUI \
  --output dist \
  --yes

echo "构建完成：$(pwd)/dist/PolyChat-GUI"
