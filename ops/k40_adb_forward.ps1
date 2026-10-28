<#
.SYNOPSIS
  Establish the ADB forwards used by the A2A gate: ssh ports plus the
  codex-a2a and pi-a2a service ports.
.DESCRIPTION
  Tailscale is not installed on the phone yet, so the PC reaches the K40
  services through ADB port forwarding. This script makes that mapping
  explicit and reproducible instead of depending on ad hoc shell history.
#>
[CmdletBinding()]
param(
    [string]$DeviceSerial = '3a3e1f52',
    [int[]]$Ports = @(8000, 8022, 9910, 10022)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$devices = & adb devices
if (-not ($devices | Where-Object { $_ -match "^$DeviceSerial\s+device$" })) {
    throw "device $DeviceSerial is not in the adb device list"
}

foreach ($port in $Ports) {
    & adb -s $DeviceSerial forward "tcp:$port" "tcp:$port" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "adb forward tcp:$port failed"
    }
}

Write-Output ("ADB_FORWARD_OK device={0} ports={1}" -f $DeviceSerial, ($Ports -join ','))
