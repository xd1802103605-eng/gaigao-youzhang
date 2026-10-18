@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 20 或更新版本，再双击本文件。
  echo 下载地址：https://nodejs.org/zh-cn/download
  pause
  exit /b 1
)
echo 正在启动改稿有账。浏览器地址：http://127.0.0.1:4173
start "" "http://127.0.0.1:4173"
node server.mjs
pause
