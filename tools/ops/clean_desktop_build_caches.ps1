param()

$ErrorActionPreference = 'Continue'

$before = (Get-PSDrive C).Free

$targets = @(
  (Join-Path $env:LOCALAPPDATA 'electron\Cache'),
  (Join-Path $env:LOCALAPPDATA 'npm-cache\_npx'),
  'D:\temp-node-test.exe',
  'D:\temp-node-runtime.exe',
  'D:\electron-dist',
  (Join-Path $env:APPDATA 'BioanalysWorkbench')
)

foreach ($target in $targets) {
  $resolved = Resolve-Path -LiteralPath $target -ErrorAction SilentlyContinue
  if (-not $resolved) {
    Write-Output "already gone: $target"
    continue
  }
  $full = $resolved.Path
  $allowedRoots = @($env:LOCALAPPDATA, $env:APPDATA)
  $allowedExact = @('D:\temp-node-test.exe', 'D:\temp-node-runtime.exe', 'D:\electron-dist')
  $allowed = $false
  foreach ($root in $allowedRoots) {
    if ($full.StartsWith($root, 'OrdinalIgnoreCase')) { $allowed = $true; break }
  }
  if ($allowedExact -contains $full) { $allowed = $true }
  if ($allowed) {
    Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $full) {
      Write-Output "partial removal: $full"
    } else {
      Write-Output "removed: $full"
    }
  } else {
    Write-Output "skip (outside allowed roots): $full"
  }
}

npm cache clean --force 2>&1 | Select-Object -First 3 | ForEach-Object { Write-Output "npm: $_" }

$after = (Get-PSDrive C).Free
Write-Output ('C free before: {0:N2} GB' -f ($before / 1GB))
Write-Output ('C free after:  {1:N2} GB, freed: {2:N0} MB' -f ($before / 1GB), ($after / 1GB), (($after - $before) / 1MB))
