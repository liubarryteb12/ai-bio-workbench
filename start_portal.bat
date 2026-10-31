@echo off
chcp 65001 >nul
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

pwsh -NoProfile -File "%~dp0ops\port_preflight.ps1" -Port 8080 -ExpectedPattern "portal[\\/]serve\.mjs" >nul 2>nul
if not errorlevel 1 goto portal_port_free
echo [提示] 8080 端口已被 Bound 或 Listen 状态占用，启动已取消。
echo         请运行以下命令查看占用者，禁止直接结束未知进程：
echo         pwsh -File ops\port_preflight.ps1 -Port 8080 -ExpectedPattern "portal[\\/]serve\.mjs"
echo.
pause
exit /b 1
:portal_port_free

echo 客户访问地址: http://127.0.0.1:8080/
echo 需求收件箱  : %~dp0portal\inbox\
echo 按 Ctrl+C 可停止服务。
echo.

node "%~dp0portal\serve.mjs"

echo.
echo [已停止] 用户需求提交台已退出。
pause
endlocal
