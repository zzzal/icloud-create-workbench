#!/usr/bin/env bash
# macOS 和 Linux 本地启动。首次运行会在本目录生成 .env。
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js 24 或更高版本。"
  exit 1
fi

major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$major" -lt 24 ]; then
  echo "需要 Node.js 24 或更高版本，当前是 $(node -v)。"
  exit 1
fi

if [ ! -d node_modules ]; then
  npm install
fi

exec node --disable-warning=ExperimentalWarning src/server.js
