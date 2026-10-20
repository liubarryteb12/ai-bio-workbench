@echo off
chcp 936 >nul
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

netstat -ano | findstr ":8787 " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo [提示] 8787 端口已被占用，工作台可能已经在运行。
  echo         请直接访问 http://127.0.0.1:8787/
  echo         若要重启，请先关闭已有的工作台窗口。
  echo.
  pause
  exit /b 1
)

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

echo 工作台地址: http://127.0.0.1:8787/
echo 按 Ctrl+C 可停止服务。
echo.

cd /d "%~dp0BioanalysDesktop"
node server\index.js

echo.
echo [已停止] 工作台服务已退出。
pause
endlocal
