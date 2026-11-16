param(
  [string]$ZipPath = 'D:\00.AIagent\codespace\PowerShell-7.7.0-win-x64.zip'
)

$log = 'D:\00.AIagent\codespace\.pwsh7-install-step.log'

function Write-StepLog([string]$message) {
  Add-Content -LiteralPath $log -Value "[$(Get-Date -Format HH:mm:ss)] $message"
}

try {
  Set-Content -LiteralPath $log -Value "[$(Get-Date -Format HH:mm:ss)] elevated step started (user=$(whoami), zip=$ZipPath)"
  $target = 'C:\Program Files\PowerShell\7'
  Write-StepLog "extracting to $target"
  Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $target -Force
  Write-StepLog 'extract done'

  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  if (($machinePath -split ';') -notcontains $target) {
    [Environment]::SetEnvironmentVariable('Path', "$machinePath;$target", 'Machine')
    Write-StepLog "added to machine PATH: $target"
  } else {
    Write-StepLog 'machine PATH already contains target'
  }

  $pwsh7 = Join-Path $target 'pwsh.exe'
  if (Test-Path -LiteralPath $pwsh7) {
    $version = & $pwsh7 -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
    Write-StepLog "installed: $pwsh7 ($version)"
    exit 0
  }

  Write-StepLog 'pwsh.exe missing after extract'
  exit 1
} catch {
  Write-StepLog "ERROR: $($_.Exception.Message)"
  Write-StepLog ($_ | Out-String)
  exit 1
}
