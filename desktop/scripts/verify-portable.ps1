param(
  [string]$Target = 'D:\00.AIagent\codespace\bioworkbench'
)

$exe = Join-Path $Target 'BioanalysWorkbench.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "missing exe: $exe" }

$out = Join-Path $env:TEMP 'bio-portable-smoke.out.log'
$err = Join-Path $env:TEMP 'bio-portable-smoke.err.log'
$proc = Start-Process -FilePath $exe -ArgumentList '--no-sandbox','--disable-gpu','--smoke-test' -WorkingDirectory $Target -PassThru -Wait -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
Write-Output "smoke exit: $($proc.ExitCode)"
Get-Content -LiteralPath $out -ErrorAction SilentlyContinue
Get-Content -LiteralPath $err -ErrorAction SilentlyContinue | Select-Object -Last 3

$checks = @(
  @{ name = 'data root'; path = Join-Path $Target 'data' },
  @{ name = 'data config'; path = Join-Path $Target 'data\config.json' },
  @{ name = 'data logs'; path = Join-Path $Target 'data\logs' },
  @{ name = 'raw_data scaffold'; path = Join-Path $Target 'data\raw_data' },
  @{ name = 'venv python'; path = Join-Path $Target 'venv\Scripts\python.exe' },
  @{ name = 'portable index'; path = Join-Path $Target 'index.json' }
)
$failed = $false
foreach ($check in $checks) {
  $ok = Test-Path -LiteralPath $check.path
  if (-not $ok) { $failed = $true }
  Write-Output ('{0} [{1}] {2}' -f ($(if ($ok) {'PASS'} else {'FAIL'})), $check.name, $check.path)
}

$appdata = Join-Path $env:APPDATA 'BioanalysWorkbench'
$appdataGone = -not (Test-Path -LiteralPath $appdata)
Write-Output ('{0} [appdata abandoned] {1}' -f ($(if ($appdataGone) {'PASS'} else {'FAIL'})), $appdata)
if (-not $appdataGone) { $failed = $true }

if ($proc.ExitCode -ne 0 -or $failed) { exit 1 }
exit 0
