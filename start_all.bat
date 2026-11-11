@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   Bioanalys 一键启动
echo ============================================
echo.
echo 即将打开两个窗口：
echo   1) 管理员工作台       http://127.0.0.1:18787/
echo   2) 用户需求提交台     http://127.0.0.1:8080/
echo.

start "Bioanalys Workbench" "%~dp0start_workbench.bat"
start "Bioanalys Portal"    "%~dp0start_portal.bat"

start "" "http://127.0.0.1:18787/"
start "" "http://127.0.0.1:8080/"
echo 已在两个独立窗口启动。关闭对应窗口即可停止该服务。
echo.
timeout /t 3 >nul
endlocal
