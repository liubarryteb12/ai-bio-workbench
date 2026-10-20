@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   用户需求提交台 · 启动
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 后重试。
  echo.
  pause
  exit /b 1
)

netstat -ano | findstr ":8080 " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo [提示] 8080 端口已被占用，用户需求提交台可能已经在运行。
  echo         请直接访问 http://127.0.0.1:8080/
  echo         若要重启，请先关闭已有的提交台窗口。
  echo.
  pause
  exit /b 1
)

echo 客户访问地址: http://127.0.0.1:8080/
echo 需求收件箱  : %~dp0portal\inbox\
echo 按 Ctrl+C 可停止服务。
echo.

node "%~dp0portal\serve.mjs"

echo.
echo [已停止] 用户需求提交台已退出。
pause
endlocal
