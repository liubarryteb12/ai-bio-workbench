<#
常驻守护：保持 工作台(8787) / 用户端(8080) / frpc 三个进程在跑。

设计口径：
  - 只做运行时守护，不注册开机自启、不写启动项、不建计划任务。需要时手动启动本脚本。
  - 每轮按端口/进程探测：HTTP 探活失败才重启，活着的一律不碰（不打断在跑的分析任务）。
  - 工作台默认**不启用**口令（只在本机用，浏览器不该每次弹登录框）。
    仅当用 -RequireAuth 启动、或 frpc 里把 8787 映射到公网时，才带口令运行；
    口令来自用户主目录的 workbench_auth.json，脚本首次需要时自动生成，
    不进源码、不进仓库、不写日志。
  - 日志追加到 cn_debug/serve_guard.log。

用法：
  pwsh -File ops/serve_guard.ps1                 # 常驻，30 秒一轮（本机用，免口令）
  pwsh -File ops/serve_guard.ps1 -Once           # 只跑一轮（排障用）
  pwsh -File ops/serve_guard.ps1 -RequireAuth    # 工作台带口令启动（映射到公网时用）
  pwsh -File ops/serve_guard.ps1 -IntervalSec 60
#>
param(
  [switch]$Once,
  [switch]$RequireAuth,
  [int]$IntervalSec = 30
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'cn_debug'
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir 'serve_guard.log'

function Write-Log([string]$Message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Path $logFile -Value $line -Encoding utf8
  Write-Host $line
}

# 单实例：两个守护同时跑会互相抢着重启
$mutex = New-Object System.Threading.Mutex($false, 'Global\BioanalysServeGuard')
$acquired = $false
try {
  $acquired = $mutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
  # 上一个守护被强杀，互斥体被遗弃，这里视为已接管
  $acquired = $true
}
if (-not $acquired) {
  Write-Log '已有守护实例在运行，本实例退出'
  exit 0
}

$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { $nodeExe = 'D:\node-v2.4\node.exe' }
if (!(Test-Path $nodeExe)) {
  Write-Log "找不到 node 可执行文件：$nodeExe"
  exit 1
}

$workbenchDir = Join-Path $root 'BioanalysDesktop'
$frpcDir = 'C:\Users\18765\Desktop\旅游攻略\frp_0.69.1_windows_amd64\frp_0.69.1_windows_amd64'
$frpcExe = Join-Path $frpcDir 'frpc.exe'
$authFile = Join-Path $env:USERPROFILE '.bioanalys\workbench_auth.json'

function Get-WorkbenchAuth {
  if (Test-Path $authFile) {
    return Get-Content $authFile -Raw -Encoding utf8 | ConvertFrom-Json
  }
  $authDir = Split-Path -Parent $authFile
  if (!(Test-Path $authDir)) { New-Item -ItemType Directory -Path $authDir | Out-Null }
  $bytes = New-Object byte[] 18
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  # URL 安全字符集，避免口令里的 + / = 在 Basic 头或命令行里被解释
  $pass = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'B')
  $auth = [pscustomobject]@{ user = 'admin'; pass = $pass }
  $auth | ConvertTo-Json | Set-Content -Path $authFile -Encoding utf8
  Write-Log "首次运行，已生成工作台口令文件：$authFile"
  return $auth
}

function Test-HttpOk([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

# 口令是否真的生效：不带凭证请求业务接口，期望 401。
# 用来识别「被人手动/别的脚本免密拉起」的工作台实例，这种实例不能留在公网端口上。
function Test-AuthEnforced {
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/api/projects/list' -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -eq 401
  } catch {
    return $_.Exception.Response.StatusCode.value__ -eq 401
  }
}

# 按端口占用者杀进程，比按命令行匹配可靠（命令行里正反斜杠、参数写法都可能不同）
function Stop-PortOwner([int]$Port) {
  $owners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($ownerPid in $owners) {
    if (-not $ownerPid) { continue }
    try {
      Stop-Process -Id $ownerPid -Force -ErrorAction Stop
      Write-Log "清理占用端口 $Port 的进程 pid=$ownerPid"
    } catch {
      Write-Log "清理端口 $Port 占用进程失败 pid=$ownerPid：$($_.Exception.Message)"
    }
  }
  # 等端口真正释放，避免新进程 bind EADDRINUSE
  for ($i = 0; $i -lt 20; $i++) {
    $still = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if (-not $still) { return }
    Start-Sleep -Milliseconds 250
  }
}

function Start-Workbench($auth) {
  $env:BAD_PORT = '8787'
  if ($auth) {
    $env:BAD_AUTH_USER = $auth.user
    $env:BAD_AUTH_PASS = $auth.pass
  } else {
    # 显式清掉，避免从父进程继承到残留口令（子进程会继承当前环境）
    Remove-Item Env:\BAD_AUTH_USER -ErrorAction SilentlyContinue
    Remove-Item Env:\BAD_AUTH_PASS -ErrorAction SilentlyContinue
  }
  Start-Process -FilePath $nodeExe `
    -ArgumentList 'server/index.js' `
    -WorkingDirectory $workbenchDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'workbench_out.log') `
    -RedirectStandardError (Join-Path $logDir 'workbench_err.log')
  Write-Log '已拉起工作台 (8787)'
}

function Start-Portal {
  Start-Process -FilePath $nodeExe `
    -ArgumentList 'portal/serve.mjs' `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'portal_out.log') `
    -RedirectStandardError (Join-Path $logDir 'portal_err.log')
  Write-Log '已拉起用户端 (8080)'
}

function Start-Frpc {
  if (!(Test-Path $frpcExe)) {
    Write-Log "找不到 frpc.exe：$frpcExe"
    return
  }
  Start-Process -FilePath $frpcExe `
    -ArgumentList '-c', './frpc.toml' `
    -WorkingDirectory $frpcDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'frpc_out.log') `
    -RedirectStandardError (Join-Path $logDir 'frpc_err.log')
  Write-Log '已拉起 frpc'
}

function Invoke-GuardPass {
  $auth = if ($RequireAuth) { Get-WorkbenchAuth } else { $null }

  if (Test-HttpOk 'http://127.0.0.1:8787/api/health') {
    if ($RequireAuth -and -not (Test-AuthEnforced)) {
      Write-Log '工作台 8787 在跑但未强制口令，重启为带口令实例'
      Stop-PortOwner 8787
      Start-Workbench $auth
    } elseif ($RequireAuth) {
      Write-Log '工作台 8787 正常（口令已生效）'
    } elseif (Test-AuthEnforced) {
      # 上一轮用 -RequireAuth 起的实例仍在跑；本机用遇到登录框就手动重启该服务即可
      Write-Log '工作台 8787 正常（当前实例带口令，本机访问如需免密请重启工作台）'
    } else {
      Write-Log '工作台 8787 正常'
    }
  } else {
    Write-Log '工作台 8787 探活失败，准备重启'
    Stop-PortOwner 8787
    Start-Workbench $auth
  }

  if (Test-HttpOk 'http://127.0.0.1:8080/health') {
    Write-Log '用户端 8080 正常'
  } else {
    Write-Log '用户端 8080 探活失败，准备重启'
    Stop-PortOwner 8080
    Start-Portal
  }

  $frpc = Get-CimInstance Win32_Process -Filter "Name='frpc.exe'" -ErrorAction SilentlyContinue
  if ($frpc) {
    Write-Log "frpc 正常 pid=$($frpc[0].ProcessId)"
  } else {
    Write-Log 'frpc 不在运行，准备拉起'
    Start-Frpc
  }
}

Write-Log "守护启动 node=$nodeExe interval=${IntervalSec}s once=$Once requireAuth=$RequireAuth"
do {
  try {
    Invoke-GuardPass
  } catch {
    Write-Log "本轮守护异常：$($_.Exception.Message)"
  }
  if ($Once) { break }
  Start-Sleep -Seconds $IntervalSec
} while ($true)

$mutex.ReleaseMutex()
