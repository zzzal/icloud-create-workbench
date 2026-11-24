@echo off
rem Windows 本地启动。首次运行会在本目录生成 .env。
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 需要 Node.js 24 或更高版本。
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo 需要 Node.js 24 或更高版本。
  node -v
  exit /b 1
)

if not exist node_modules npm install
node --disable-warning=ExperimentalWarning src/server.js
