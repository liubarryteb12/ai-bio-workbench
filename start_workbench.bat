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

pwsh -NoProfile -File "%~dp0tools\ops\port_preflight.ps1" -Port 18787 -ExpectedPattern "server[\\/]index\.js" >nul 2>nul
if not errorlevel 1 goto workbench_port_free
echo [提示] 18787 端口已被 Bound 或 Listen 状态占用，启动已取消。
echo         请运行以下命令查看占用者，禁止直接结束未知进程：
echo         pwsh -File ops\port_preflight.ps1 -Port 18787 -ExpectedPattern "server[\\/]index\.js"
echo.
pause
exit /b 1
:workbench_port_free

echo [配置] 本地信任环境：已禁用工作台登录验证（BIO_ALLOW_DEV_NOAUTH=1）。
set "BIO_ALLOW_DEV_NOAUTH=1"
set "BIO_COMPUTE_ADAPTER=adb"

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

echo 工作台地址: http://127.0.0.1:18787/
echo 按 Ctrl+C 可停止服务。
echo.

start "" "http://127.0.0.1:18787/"
cd /d "%~dp0BioanalysDesktop"
node server\index.js

echo.
echo [已停止] 工作台服务已退出。
pause
endlocal
