@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================================
echo   【Bioanalys 生产级安全网关与服务一键启动】
echo ========================================================
echo.
echo 启动组件：
echo   1. 后端调度核心 (127.0.0.1:18787)
echo   2. 客户门户服务 (127.0.0.1:8080)
echo   3. Caddy 安全反向代理网关 (HTTPS 443 / 8443)
echo.

start "Bioanalys Backend & Desktop" "%~dp0start_workbench.bat"
start "Bioanalys Portal"            "%~dp0start_portal.bat"

where caddy >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [Caddy] 找到系统 Caddy，正在拉起外网安全代理网关...
    start "Caddy Secure Gateway" caddy run --config "%~dp0Caddyfile"
) else (
    echo [提示] 未在系统 PATH 中检测到 caddy.exe，请将 caddy.exe 放置于根目录或配置环境变量即可激活 443 自动证书与路由阻断。
)

echo.
echo ========================================================
echo   服务已在后台全部就绪！
echo   - 内部运维控制台: http://127.0.0.1:18787/
echo   - 外部客户门户:   https://localhost/portal/ (或 http://127.0.0.1:8080/)
echo ========================================================
timeout /t 3 >nul
endlocal
