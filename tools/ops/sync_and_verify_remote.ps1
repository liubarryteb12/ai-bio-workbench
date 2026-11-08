<#
.SYNOPSIS
    tools/ops/sync_and_verify_remote.ps1：把仓库内的运维/母版脚本同步到 K40 并做 SHA256 对账。

.DESCRIPTION
    aims v2.5 六.4 的落地实现。解决的问题是"本地改了、远端还是旧版"的静默漂移：
    远端 /mnt/ssd/bio_data/ops/ 下的脚本由 bridge_guard.sh、check_storage_and_isolation.sh、
    build_client_report.py 直接执行，一旦远端落后于仓库，界面绿灯、脚本红灯。

    五步闭环：
      1. LF 校验：CRLF 会让 awk 数值比较退化成字符串比较（踩坑台账 #103），先拦；
      2. 本地哈希：Get-FileHash -Algorithm SHA256；
      3. 远端预检：先算远端现状，报告"缺失/漂移"，否则"先传后比"永远相等，发现不了远端被手改；
      4. 传输：ssh mkdir -p 后 scp -q 覆盖；
      5. 远端对账：远端 sha256sum 回读，与本地逐文件比对，任一不一致即失败。

    每次运行追加一条记录到 con_hf/ops_ledger.md（运维台账），并把机器可读清单
    合并进远端 system_logs/sync_manifest.json（保留最近 50 次）。

.PARAMETER Files
    仓库根相对路径列表。默认同步 core/bridge_guard.sh 与 ops/ 下的 .sh/.py/.R。

.PARAMETER All
    连同 tools/bio/<line>/scripts/ 下的全部分析母版一起同步。

.PARAMETER DryRun
    只做 LF 校验、本地哈希与远端预检，不传输、不写台账。

.PARAMETER FailOnDrift
    检测到远端与本地不一致时不传输、直接失败（默认是覆盖并如实记录）。

.EXAMPLE
    pwsh -File tools/ops/sync_and_verify_remote.ps1 -DryRun
    pwsh -File tools/ops/sync_and_verify_remote.ps1
    pwsh -File tools/ops/sync_and_verify_remote.ps1 -Files tools/reporting/verify_bridge_checkpoint.py,core/bridge_guard.sh

.NOTES
    退出码：0 全部一致 / 1 有文件不一致或传输失败 / 2 参数或前置条件错误。
#>
[CmdletBinding()]
param(
    [string[]]$Files,
    [switch]$All,
    [switch]$DryRun,
    [switch]$FailOnDrift,
    [string]$SshTarget = 'k40-ubuntu',
    [string]$RemoteRoot = '/mnt/ssd/bio_data',
    [string]$LedgerPath = 'con_hf/ops_ledger.md'
)

$ErrorActionPreference = 'Stop'
$NL = [string][char]10
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $RepoRoot

function Get-DefaultFiles {
    $list = New-Object System.Collections.Generic.List[string]
    $list.Add('core/bridge_guard.sh')
    foreach ($f in (Get-ChildItem -Path 'ops' -File | Sort-Object Name)) {
        if ($f.Extension -in @('.sh', '.py', '.R', '.mjs')) { $list.Add(('ops/' + $f.Name)) }
    }
    if ($All) {
        foreach ($line in (Get-ChildItem -Path 'tools/bio' -Directory)) {
            $scripts = Join-Path $line.FullName 'scripts'
            if (-not (Test-Path $scripts)) { continue }
            foreach ($f in (Get-ChildItem -Path $scripts -File | Sort-Object Name)) {
                $list.Add(('tools/bio/' + $line.Name + '/scripts/' + $f.Name))
            }
        }
    }
    return $list
}

function Test-LfOnly {
    param([string]$RelPath)
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $RepoRoot $RelPath))
    for ($i = 0; $i -lt $bytes.Length - 1; $i++) {
        if ($bytes[$i] -eq 13 -and $bytes[$i + 1] -eq 10) { return $false }
    }
    return $true
}

function Get-LocalHash {
    param([string]$RelPath)
    return (Get-FileHash -Path (Join-Path $RepoRoot $RelPath) -Algorithm SHA256).Hash.ToLower()
}

function Invoke-Remote {
    param([string]$Command)
    $out = & ssh -o BatchMode=yes -o ConnectTimeout=15 $SshTarget $Command 2>&1
    # ssh 的 known_hosts 提示走 stderr，混进来会破坏「按行首锚定」的解析
    # （2026-10-21 踩到：镜像校验的正则 ^[0-9a-f]{64} 被 Warning 行顶掉）
    $clean = @($out | Where-Object { $_ -notmatch '^Warning: Permanently added' })
    return @{ Output = ($clean -join $NL); Code = $LASTEXITCODE }
}

# 解析 sha256sum / MISSING 混合输出为 {相对路径 -> 哈希}，同时收集缺失项
function Read-RemoteHashes {
    param([string]$Text)
    $map = @{}
    $absent = @()
    foreach ($line in ($Text -split $NL)) {
        $line = $line.Trim()
        if ($line -match '^([0-9a-f]{64})\s+\*?(.+)$') {
            $p = $Matches[2].Trim()
            $map[$p.Substring([Math]::Min($p.Length, ($RemoteRoot.Length + 1)))] = $Matches[1]
        } elseif ($line -match '^MISSING\s+(.+)$') {
            $p = $Matches[1].Trim()
            $absent += $p.Substring([Math]::Min($p.Length, ($RemoteRoot.Length + 1)))
        }
    }
    return @{ Map = $map; Absent = $absent }
}

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Error '本机没有 ssh 客户端，无法同步（用 -DryRun 可只做本地校验）'
    exit 2
}

if ($null -eq $Files -or $Files.Count -eq 0) { $Files = Get-DefaultFiles }
if ($Files.Count -eq 0) { Write-Error '没有可同步的文件'; exit 2 }

$missing = @()
foreach ($rel in $Files) {
    if (-not (Test-Path (Join-Path $RepoRoot $rel))) { $missing += $rel }
}
if ($missing.Count -gt 0) {
    Write-Error ('以下文件在仓库里不存在：' + ($missing -join ', '))
    exit 2
}

Write-Host ('== 同步清单：{0} 个文件 -> {1}:{2}' -f $Files.Count, $SshTarget, $RemoteRoot)

# 第 1 步：LF 校验（CRLF 一律拦下，不放行到远端）
$crlf = @()
foreach ($rel in $Files) {
    if (-not (Test-LfOnly -RelPath $rel)) { $crlf += $rel }
}
if ($crlf.Count -gt 0) {
    Write-Host '[FAIL] 以下文件含 CRLF 换行（踩坑 #103：awk 数值比较会退化成字符串比较）：' -ForegroundColor Red
    $crlf | ForEach-Object { Write-Host ('       ' + $_) }
    exit 1
}
Write-Host '[ OK ] LF 校验通过'

# 第 2 步：本地哈希
$local = @{}
foreach ($rel in $Files) { $local[$rel] = Get-LocalHash -RelPath $rel }
Write-Host '[ OK ] 本地 SHA256 已计算'

# 第 3 步：远端预检（漂移检测）。必须"先比后传"，否则永远相等。
# 101 个文件拼成一条 ssh 命令会被远端提前关闭；按 20 个一批聚合结果。
$preflightBatchSize = 20
$preflightOutputs = New-Object System.Collections.Generic.List[string]
$preflightFailure = $null
for ($offset = 0; $offset -lt $Files.Count; $offset += $preflightBatchSize) {
    $end = [Math]::Min($offset + $preflightBatchSize - 1, $Files.Count - 1)
    $batch = @($Files[$offset..$end])
    $preCmd = (($batch | ForEach-Object {
        $abs = ($RemoteRoot + '/' + $_).Replace([char]92, [char]47)
        "if [ -f '" + $abs + "' ]; then sha256sum '" + $abs + "'; else echo 'MISSING " + $abs + "'; fi"
    }) -join '; ')
    $batchResult = Invoke-Remote -Command $preCmd
    if ($batchResult.Code -ne 0) {
        $preflightFailure = $batchResult
        break
    }
    $preflightOutputs.Add($batchResult.Output)
}
$drift = @()
$absent = @()
$remoteKnown = $false
$pre = if ($preflightFailure) {
    $preflightFailure
} else {
    @{ Code = 0; Output = ($preflightOutputs -join $NL) }
}
if ($pre.Code -eq 0) {
    $remoteKnown = $true
    $parsed = Read-RemoteHashes -Text $pre.Output
    $absent = @($parsed.Absent)
    foreach ($rel in $Files) {
        if ($absent -contains $rel) { continue }
        if ($parsed.Map.ContainsKey($rel) -and $parsed.Map[$rel] -ne $local[$rel]) { $drift += $rel }
    }
    Write-Host ('[PRE ] 远端现状：{0} 个缺失（首次同步）、{1} 个与本地不一致（漂移）' -f $absent.Count, $drift.Count)
    if ($drift.Count -gt 0) {
        Write-Host '[WARN] 远端存在落后于仓库的旧版本（本次将被覆盖）：' -ForegroundColor Yellow
        $drift | ForEach-Object { Write-Host ('       ' + $_) }
        if ($FailOnDrift) {
            Write-Host '[FAIL] -FailOnDrift：检测到漂移，未做任何传输' -ForegroundColor Red
            exit 1
        }
    }
} else {
    Write-Host ('[WARN] 远端预检失败（ssh 退出码 {0}），跳过漂移检测：{1}' -f $pre.Code, $pre.Output) -ForegroundColor Yellow
    if ($FailOnDrift) {
        Write-Host '[FAIL] 远端预检失败，-FailOnDrift 不允许继续（未知不等于无漂移）' -ForegroundColor Red
        exit 1
    }
}

if ($DryRun) {
    Write-Host '[DRY ] -DryRun：不传输、不写台账、不碰远端'
    foreach ($rel in $Files) {
        $mark = if (-not $remoteKnown) { 'UNKNOWN' } elseif ($drift -contains $rel) { 'DRIFT' } elseif ($absent -contains $rel) { 'NEW  ' } else { 'SAME ' }
        Write-Host ('       {0} {1}  {2}' -f $mark, $local[$rel].Substring(0, 16), $rel)
    }
    exit 0
}

# 第 4 步：建远端目录并传输
$remoteDirs = $Files | ForEach-Object { $RemoteRoot + '/' + (Split-Path $_ -Parent).Replace([char]92, [char]47) } | Sort-Object -Unique
$mkdirCmd = ($remoteDirs | ForEach-Object { "mkdir -p '$_'" }) -join ' && '
$r = Invoke-Remote -Command $mkdirCmd
if ($r.Code -ne 0) {
    Write-Host ('[FAIL] 远端建目录失败（ssh 退出码 {0}）：{1}' -f $r.Code, $r.Output) -ForegroundColor Red
    exit 1
}

$scpFailed = @()
foreach ($rel in $Files) {
    $dest = ($RemoteRoot + '/' + $rel).Replace([char]92, [char]47)
    & scp -q (Join-Path $RepoRoot $rel) ('{0}:{1}' -f $SshTarget, $dest) 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { $scpFailed += $rel }
}
if ($scpFailed.Count -gt 0) {
    Write-Host ('[FAIL] scp 失败：' + ($scpFailed -join ', ')) -ForegroundColor Red
    exit 1
}

# scp 不带 -p，落盘权限退化为 0644：母版是按名字直接调用 ops 脚本的（不带 bash 前缀），
# 少了执行位就会 Permission denied。所以传完立刻按后缀归一化权限。
$chmodSh = (($Files | Where-Object { $_ -like '*.sh' } | ForEach-Object { 'chmod 755 ' + "'" + ($RemoteRoot + '/' + $_).Replace([char]92, [char]47) + "'" }) -join ' && ')
$chmodOther = (($Files | Where-Object { $_ -notlike '*.sh' } | ForEach-Object { 'chmod 644 ' + "'" + ($RemoteRoot + '/' + $_).Replace([char]92, [char]47) + "'" }) -join ' && ')
$chmodCmd = @($chmodSh, $chmodOther) | Where-Object { $_ -ne '' } | Join-String -Separator ' && '
$r = Invoke-Remote -Command $chmodCmd
if ($r.Code -ne 0) {
    Write-Host ('[FAIL] 远端 chmod 失败（退出码 {0}）：{1}' -f $r.Code, $r.Output) -ForegroundColor Red
    exit 1
}
Write-Host '[ OK ] 传输完成（权限已归一化：.sh 755 / 其余 644）'

# 第 5 步：远端对账
# 必须用 printf 把路径喂给 xargs：直接把引号路径串管道给 xargs 会让 shell 去
# **执行**这些脚本（2026-10-21 真跑踩到，bridge_guard.sh 报 Permission denied、
# run_throttled_task.sh 被无参执行），这是本脚本最危险的一处坑，改前务必保留 printf。
$sumCmd = "printf '%s" + [char]92 + "n' " + (($Files | ForEach-Object { "'" + ($RemoteRoot + '/' + $_).Replace([char]92, [char]47) + "'" }) -join ' ') + ' | xargs sha256sum'
$r = Invoke-Remote -Command $sumCmd
if ($r.Code -ne 0) {
    Write-Host ('[FAIL] 远端 sha256sum 失败（退出码 {0}）：{1}' -f $r.Code, $r.Output) -ForegroundColor Red
    exit 1
}
$after = (Read-RemoteHashes -Text $r.Output).Map

$mismatch = @()
$matched = 0
foreach ($rel in $Files) {
    $want = $local[$rel]
    $got = $after[$rel]
    if ($null -eq $got) { $mismatch += ('{0}（远端无回读）' -f $rel); continue }
    if ($got -eq $want) { $matched++ } else { $mismatch += ('{0}（本地 {1} != 远端 {2}）' -f $rel, $want.Substring(0, 12), $got.Substring(0, 12)) }
}

# 第 5.5 步：镜像部署。core/bridge_guard.sh 在仓库里位于 core/ 根（母版按
# "$(dirname $0)/../../bridge_guard.sh" 找它），部署到 K40 后母版落在
# /mnt/ssd/bio_data/bin/<线>/ 下，相对路径指向 /mnt/ssd/bio_data/ —— 所以同一份
# 守卫必须再镜像一份到 ops/ 下，母版按候选路径列表自行解析。
$mirrorOk = 0
$mirrorTotal = 0
$mirrorNote = '未执行'
if ($Files -contains 'core/bridge_guard.sh') {
    $mirrorTotal = 1
    $mirrorDest = $RemoteRoot + '/ops/bridge_guard.sh'
    & scp -q (Join-Path $RepoRoot 'core/bridge_guard.sh') ('{0}:{1}' -f $SshTarget, $mirrorDest) 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $null = Invoke-Remote -Command ("chmod 755 '" + $mirrorDest + "'")
        $mirrorParsed = Read-RemoteHashes -Text ((Invoke-Remote -Command ("sha256sum '" + $mirrorDest + "'")).Output)
        $mirrorRemote = $mirrorParsed.Map['ops/bridge_guard.sh']
        if ($mirrorRemote -eq $local['core/bridge_guard.sh']) {
            $mirrorOk = 1
            $mirrorNote = '镜像 1/1 一致'
            Write-Host '[ OK ] 镜像部署：ops/bridge_guard.sh 与 core/bridge_guard.sh 一致'
        } else {
            $mirrorNote = '镜像不一致'
            Write-Host '[FAIL] 镜像部署后哈希不一致：ops/bridge_guard.sh' -ForegroundColor Red
        }
    } else {
        $mirrorNote = '镜像 scp 失败'
        Write-Host '[FAIL] 镜像部署 scp 失败：ops/bridge_guard.sh' -ForegroundColor Red
    }
}

# 第 6 步：部署一致性（仓库 -> 引擎真正执行的 bin/<线>/）
# 本脚本只写 $RemoteRoot/tools/bio/...（仓库镜像，供审计与哈希对账）；任务引擎通过 PATH 执行的却是
# $RemoteRoot/bin/<线>/<步骤名>（由 tools/ops/06_deploy_scripts.ps1 部署）。两个落点长期可能不一致
# （2026-10-21 实测 3 个母版落后：ml_diagnostics / ml_hub_analysis / virtual_knockout），
# 而自检第 4 维只比「仓库 vs 镜像」，看不到这种漂移 —— 所以在同步末尾单独比一次。
$deployPairs = @()
foreach ($rel in $Files) {
    # 只比步骤脚本：README.md 这类文档不进 bin/（部署通道只送可执行步骤），不是漂移。
    if ($rel -notlike '*.md' -and $rel -match '^tools/bio/(line\d_[a-z0-9_]+)/scripts/(.+)$') {
        $deployPairs += [pscustomobject]@{
            Repo = $rel
            Bin  = ($RemoteRoot + '/bin/' + $Matches[1] + '/' + $Matches[2])
        }
    }
}
$deployDrift = @()
$deployChecked = 0
$deployNote = '未执行'
if ($deployPairs.Count -gt 0) {
    # xargs 只要有一个文件读不到就整体退 123（路径不存在是常态，例如 bin/ 里没部署的文档），
    # 所以必须 `|| true`：否则退出码非 0 会让下面的解析整段跳过，把全部文件误判成缺失。
    $binCmd = "printf '%s" + [char]92 + "n' " + (($deployPairs | ForEach-Object { "'" + $_.Bin + "'" }) -join ' ') + ' | xargs sha256sum 2>/dev/null || true'
    $binRes = Invoke-Remote -Command $binCmd
    $binMap = @{}
    if ($binRes.Code -eq 0) {
        foreach ($line in ($binRes.Output -split $NL)) {
            $line = $line.Trim()
            if ($line -match '^([0-9a-f]{64})\s+\*?(.+)$') { $binMap[$Matches[2].Trim()] = $Matches[1] }
        }
    }
    foreach ($pair in $deployPairs) {
        $deployChecked++
        $want = $local[$pair.Repo]
        $got = $binMap[$pair.Bin]
        if ($null -eq $got) {
            $deployDrift += ('{0}（bin 落点缺失或不可读）' -f $pair.Repo)
        } elseif ($got -ne $want) {
            $deployDrift += ('{0}（仓库 {1} != bin {2}）' -f $pair.Repo, $want.Substring(0, 12), $got.Substring(0, 12))
        }
    }
    if ($deployDrift.Count -eq 0) {
        $deployNote = ('部署 {0}/{0} 一致' -f $deployChecked)
        Write-Host ('[ OK ] 部署一致性：仓库与 bin/ 落点 {0}/{0} 一致' -f $deployChecked)
    } else {
        $deployNote = ('部署漂移 {0}/{1}' -f $deployDrift.Count, $deployChecked)
        Write-Host ('[WARN] 部署漂移 {0}/{1}：仓库已改但 bin/ 未重新部署，引擎仍跑旧版本；跑 tools/ops/06_deploy_scripts.ps1 -Force 修复：' -f $deployDrift.Count, $deployChecked) -ForegroundColor Yellow
        $deployDrift | ForEach-Object { Write-Host ('       ' + $_) }
        if ($FailOnDrift) {
            Write-Host '[FAIL] -FailOnDrift：检测到部署漂移（仓库 vs bin/）' -ForegroundColor Red
            exit 1
        }
    }
}

$stamp = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
$status = if ($mismatch.Count -eq 0) { 'OK' } else { 'MISMATCH' }
Write-Host ('== 对账结果：{0}/{1} 一致，状态 {2}' -f $matched, $Files.Count, $status)

# 远端机器可读清单（system_logs/sync_manifest.json，保留最近 50 次）
$entries = @()
foreach ($rel in $Files) {
    $entries += [pscustomobject]@{ path = $rel; sha256 = $local[$rel]; verified = ($after[$rel] -eq $local[$rel]) }
}
$manifest = [pscustomobject]@{
    synced_at = $stamp
    ssh_target = $SshTarget
    remote_root = $RemoteRoot
    status = $status
    matched = $matched
    total = $Files.Count
    drift = @($drift)
    new_files = @($absent)
    mirror = $mirrorNote
    deploy = $deployNote
    files = $entries
}
$manifestJson = ($manifest | ConvertTo-Json -Depth 5 -Compress)
$tmpJson = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tmpJson, $manifestJson, (New-Object System.Text.UTF8Encoding($false)))

$mergePy = @'
import json
import sys

root = sys.argv[1]
with open('/tmp/_sync_new.json', encoding='utf-8') as fh:
    new = json.load(fh)
path = root + '/system_logs/sync_manifest.json'
try:
    with open(path, encoding='utf-8') as fh:
        hist = json.load(fh)
except Exception:
    hist = []
if isinstance(hist, dict):
    hist = hist.get('runs', [])
hist.append(new)
hist = hist[-50:]
with open(path, 'w', encoding='utf-8') as fh:
    json.dump(hist, fh, ensure_ascii=False, indent=2)
print('manifest entries=%d' % len(hist))
'@
$tmpPy = [System.IO.Path]::GetTempFileName() + '.py'
[System.IO.File]::WriteAllText($tmpPy, $mergePy, (New-Object System.Text.UTF8Encoding($false)))

$manifestNote = '未写入（scp 失败）'
& scp -q $tmpJson ('{0}:/tmp/_sync_new.json' -f $SshTarget) 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    & scp -q $tmpPy ('{0}:/tmp/_sync_merge.py' -f $SshTarget) 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $r2 = Invoke-Remote -Command ("python3 /tmp/_sync_merge.py '" + $RemoteRoot + "'")
        if ($r2.Code -eq 0) { $manifestNote = $r2.Output.Trim() } else { $manifestNote = '写入失败：' + $r2.Output }
    }
}
Remove-Item $tmpJson -Force -ErrorAction SilentlyContinue
Remove-Item $tmpPy -Force -ErrorAction SilentlyContinue

# 本地运维台账（con_hf/ops_ledger.md，追加不重写）
$ledgerFile = Join-Path $RepoRoot $LedgerPath
$ledgerDir = Split-Path -Parent $ledgerFile
if (-not (Test-Path $ledgerDir)) { New-Item -ItemType Directory -Path $ledgerDir -Force | Out-Null }
if (-not (Test-Path $ledgerFile)) {
    $headText = '# 运维同步台账（ops_ledger）' + $NL + $NL + '由 tools/ops/sync_and_verify_remote.ps1 自动追加，一行一次同步。禁止手工删改历史行。' + $NL + $NL + '| 时间 | 状态 | 目标 | 一致 | 漂移 | manifest |' + $NL + '| --- | --- | --- | --- | --- | --- |' + $NL
    [System.IO.File]::WriteAllText($ledgerFile, $headText, (New-Object System.Text.UTF8Encoding($false)))
}
$row = '- {0} | {1} | {2}:{3} | {4}/{5} 一致 | 漂移 {6} | {9} | {7} | manifest: {8}' -f $stamp, $status, $SshTarget, $RemoteRoot, $matched, $Files.Count, $drift.Count, (($Files) -join ' '), $manifestNote, $mirrorNote
$row += ' | 部署: ' + $deployNote
if ($mismatch.Count -gt 0) {
    $row += ' | 不一致: ' + ($mismatch -join '; ')
}
[System.IO.File]::AppendAllText($ledgerFile, ($row + $NL), (New-Object System.Text.UTF8Encoding($false)))
Write-Host ('[ OK ] 台账已追加：{0}' -f $LedgerPath)

if ($mirrorTotal -gt 0 -and $mirrorOk -lt $mirrorTotal) { $mismatch += 'ops/bridge_guard.sh（镜像）' }

if ($mismatch.Count -gt 0) {
    Write-Host '[FAIL] 以下文件本地与远端不一致：' -ForegroundColor Red
    $mismatch | ForEach-Object { Write-Host ('       ' + $_) }
    exit 1
}
Write-Host '[ OK ] 本地与远端 SHA256 全部一致' -ForegroundColor Green
exit 0
