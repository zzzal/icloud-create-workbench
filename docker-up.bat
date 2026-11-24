@echo off
rem 先准备本目录的 .env，再用 Docker 启动。容器只映射到 127.0.0.1:4173。
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 首次生成 .env 需要本机 Node.js 24 或更高版本。
  exit /b 1
)

node scripts/init-env.js
if errorlevel 1 exit /b 1
docker compose up --build
