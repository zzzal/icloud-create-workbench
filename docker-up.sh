#!/usr/bin/env bash
# 先准备本目录的 .env，再用 Docker 启动。容器只映射到 127.0.0.1:4173。
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "首次生成 .env 需要本机 Node.js 24 或更高版本。"
  exit 1
fi

node scripts/init-env.js
docker compose up --build
