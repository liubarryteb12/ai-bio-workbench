<#
.SYNOPSIS
  Bridge the Windows Clash proxy into the K40 compute plane over ADB reverse.
.DESCRIPTION
  The phone has no usable direct route to GitHub, so downloads time out at a
  few hundred KB per minute. AGENTS.md requires the compute plane to reach the
  outside world through the host proxy on 127.0.0.1:7890. This script sets up
  the ADB reverse mapping and verifies the proxy from inside Termux.
#>
[CmdletBinding()]
param(
    [string]$DeviceSerial = '3a3e1f52',
    [int]$ProxyPort = 7890,
    [string]$ProbeUrl = 'https://api.github.com/repos/openai/codex/releases/latest'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$adb = 'adb'

function Test-AdbDevice {
    $devices = & $adb devices
    if ($LASTEXITCODE -ne 0) {
        throw 'adb is not available on PATH'
    }
    $match = $devices | Where-Object { $_ -match "^$DeviceSerial\s+device$" }
    if (-not $match) {
        throw "device $DeviceSerial is not in the adb device list"
    }
}

function Test-ProxyListener {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $ProxyPort -ErrorAction SilentlyContinue
    if (-not $listener) {
        throw "no listener on 127.0.0.1:$ProxyPort, start Clash first"
    }
}

Test-AdbDevice
Test-ProxyListener

& $adb -s $DeviceSerial reverse "tcp:$ProxyPort" "tcp:$ProxyPort" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "adb reverse tcp:$ProxyPort failed"
}

Write-Output "PROXY_REVERSE_OK device=$DeviceSerial port=$ProxyPort"

$probe = "export http_proxy=http://127.0.0.1:$ProxyPort https_proxy=http://127.0.0.1:$ProxyPort; " +
         "curl -fsSL --max-time 25 -o /dev/null -w '%{http_code} %{time_total}' '$ProbeUrl'"

$result = & ssh k40 $probe 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output "PROXY_PROBE_FAIL $result"
    exit 1
}

Write-Output "PROXY_PROBE_OK $($result -join ' ')"
