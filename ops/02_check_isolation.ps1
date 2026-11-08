<#
  ops/02_check_isolation.ps1 — 三线隔离约束校验（PC 侧入口）

  按 docs/isolation.md 执行：
    [代码] tools/bio/<line>/ 下脚本不得引用其他两条线的目录名或 line_id
    [台账] 不在此处跑：台账在服务器 system_logs/，由 03_check_logs_remote.sh 在容器/底座侧执行

  用法：  pwsh -File ops/02_check_isolation.ps1
  退出码：0 = 无违规；1 = 有违规（逐条打印文件与行号）
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'

$lines = @('line1_bulk', 'line2_scrna', 'line3_spatial')
$codeExtensions = @('*.py', '*.R', '*.r', '*.sh', '*.snakefile', '*.nf', '*.yaml', '*.yml')
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$failed = $false

Write-Host '=== 检查：tools/bio/ 代码跨线引用 ==='
foreach ($line in $lines) {
  $dir = Join-Path $repoRoot "tools/bio/$line"
  if (-not (Test-Path $dir)) {
    Write-Host ("[code:{0}] SKIP 目录不存在" -f $line) -ForegroundColor DarkGray
    continue
  }
  $others = $lines | Where-Object { $_ -ne $line }
  $hits = 0
  foreach ($other in $others) {
    $matches = Get-ChildItem -Path $dir -Recurse -File -Include $codeExtensions -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch '\\(\.venv|venv|node_modules|__pycache__|bin|obj)\\' } |
      Select-String -Pattern $other -SimpleMatch -ErrorAction SilentlyContinue
    if ($matches) {
      $hits++
      $failed = $true
      Write-Host ("[code:{0}] VIOLATION 引用了 {1}:" -f $line, $other) -ForegroundColor Red
      foreach ($m in $matches) {
        $rel = $m.Path.Replace("$repoRoot\", '')
        Write-Host ("    {0}:{1}  {2}" -f $rel, $m.LineNumber, $m.Line.Trim())
      }
    }
  }
  if ($hits -eq 0) {
    Write-Host ("[code:{0}] OK 无跨线引用" -f $line) -ForegroundColor Green
  }
}

Write-Host ''
if ($failed) {
  Write-Host '总体 = FAIL（见上文 VIOLATION）' -ForegroundColor Red
  exit 1
} else {
  Write-Host '总体 = PASS' -ForegroundColor Green
  exit 0
}
