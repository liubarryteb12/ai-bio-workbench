@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   管理员工作台 · 启动
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 后重试。
  echo.
  pause
  exit /b 1
)

pwsh -NoProfile -File "%~dp0ops\port_preflight.ps1" -Port 18787 -ExpectedPattern "server[./\\]index\.js" >nul 2>nul
rem exit 0 = free; exit 10 = own old instance (safe to stop); exit 20 = foreign process.
if errorlevel 20 goto workbench_port_foreign
if errorlevel 10 goto workbench_port_restart_own
goto workbench_port_free
:workbench_port_restart_own
echo [提示] 18787 被本项目旧实例占用，正在自动重启...
for /f "usebackq tokens=*" %%l in (`pwsh -NoProfile -Command "(Get-NetTCPConnection -State Listen -LocalPort 18787 -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique"`) do taskkill /f /pid %%l >nul 2>nul
timeout /t 2 /nobreak >nul
goto workbench_port_free
:workbench_port_foreign
echo [提示] 18787 端口被外部进程占用，启动已取消。
echo         请运行以下命令查看占用者，禁止直接结束未知进程：
echo         pwsh -File ops\port_preflight.ps1 -Port 18787 -ExpectedPattern "server[./\\]index\.js"
echo.
pause
exit /b 1
:workbench_port_free

if not exist "BioanalysDesktop\dist\index.html" (
  echo [提示] 前端尚未构建，正在执行 npm run build ...
  pushd "BioanalysDesktop"
  call npm run build
  if errorlevel 1 (
    echo [错误] 前端构建失败，请检查 BioanalysDesktop 目录下的 npm 环境。
    popd
    pause
    exit /b 1
  )
  popd
  echo [完成] 前端构建完成。
  echo.
)

where adb >nul 2>nul
if not errorlevel 1 (
  pwsh -NoProfile -File "%~dp0ops\k40_adb_forward.ps1" >nul 2>nul
  if not errorlevel 1 (
    echo [完成] K40 算力底座端口映射已就绪（10022/8000/9910/8022）。
    echo.
  )
)

echo 工作台地址: http://127.0.0.1:18787/
echo 按 Ctrl+C 可停止服务。
echo.

cd /d "%~dp0BioanalysDesktop"
node server\index.js

echo.
echo [已停止] 工作台服务已退出。
pause
endlocal
