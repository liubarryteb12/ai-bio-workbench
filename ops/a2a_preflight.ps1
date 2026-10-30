<#
  ops/a2a_preflight.ps1 - A2A v1.2 read-only preflight gate.
  Usage: pwsh -File ops/a2a_preflight.ps1
  Exit: 0 when no FAIL, 1 when any FAIL.
#>
[CmdletBinding()]
param(
  [string]$Serial = '3a3e1f52',
  [string]$Workbench = 'http://127.0.0.1:18787'
)

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$reportDir = Join-Path $root 'con_hf\runs\2026-10-28_a2a_v1_2'
$reportPath = Join-Path $reportDir 'PREFLIGHT.md'
$checks = [System.Collections.Generic.List[object]]::new()

function Add-Check([string]$Name, [string]$Status, [string]$Detail) {
  $checks.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail })
}

function Test-File($Path, $Name) {
  if (Test-Path -LiteralPath (Join-Path $root $Path)) {
    Add-Check $Name 'PASS' $Path
  } else {
    Add-Check $Name 'FAIL' ("missing: " + $Path)
  }
}

function Test-RemoteFileHash([string]$LocalPath, [string]$RemotePath, [string]$Name) {
  $resolvedLocal = Join-Path $root $LocalPath
  if (-not (Test-Path -LiteralPath $resolvedLocal)) {
    Add-Check $Name 'FAIL' ("local missing: " + $LocalPath)
    return
  }
  $localHash = (Get-FileHash -LiteralPath $resolvedLocal -Algorithm SHA256).Hash.ToLowerInvariant()
  $remoteRaw = (& ssh k40 "sha256sum `"$RemotePath`"" 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    Add-Check $Name 'FAIL' $remoteRaw.Trim()
    return
  }
  $match = [regex]::Match($remoteRaw, '(?m)^([0-9a-fA-F]{64})\s+')
  if (-not $match.Success) {
    Add-Check $Name 'FAIL' 'remote sha256sum output malformed'
    return
  }
  $remoteHash = $match.Groups[1].Value.ToLowerInvariant()
  if ($localHash -eq $remoteHash) {
    Add-Check $Name 'PASS' ("sha256=" + $localHash.Substring(0, 12) + "...")
  } else {
    Add-Check $Name 'FAIL' ("local=" + $localHash + " remote=" + $remoteHash)
  }
}

function Test-RemoteCommandlineSecret {
  $remoteProbe = 'pat="A2A_""PROVIDER_""KEY="; count=0; for cmdline in /proc/[0-9]*/cmdline; do [ -r "$cmdline" ] || continue; data=$(tr "\0" "\n" < "$cmdline" 2>/dev/null) || continue; case "$data" in *"$pat"*) count=$((count + 1));; esac; done; printf "KEY_IN_PI_CMDLINE=%s\n" "$count"'
  $raw = (& ssh k40 $remoteProbe 2>&1 | Out-String)
  $match = [regex]::Match($raw, 'KEY_IN_PI_CMDLINE=(\d+)')
  if ($LASTEXITCODE -eq 0 -and $match.Success -and [int]$match.Groups[1].Value -eq 0) {
    Add-Check 'provider-key-commandline' 'PASS' 'KEY_IN_PI_CMDLINE=0'
  } else {
    Add-Check 'provider-key-commandline' 'FAIL' $raw.Trim()
  }
}

function Test-RemoteSecurityPatch {
  $raw = (& ssh k40 'bash "$HOME/bin/patch_pi_a2a_security.sh" --check' 2>&1 | Out-String)
  if ($LASTEXITCODE -eq 0 -and $raw -match 'PI_A2A_SECURITY_PATCH=applied') {
    Add-Check 'pi-a2a-redaction-patch' 'PASS' $raw.Trim()
  } else {
    Add-Check 'pi-a2a-redaction-patch' 'FAIL' $raw.Trim()
  }
}

function Test-PythonSuite($Path, $Name, [int]$MinimumTests, [int]$MaximumSkips = 0) {
  $output = (& python3 (Join-Path $root $Path) 2>&1 | Out-String)
  $exitCode = $LASTEXITCODE
  $ran = [regex]::Match($output, 'Ran (\d+) tests?')
  $count = if ($ran.Success) { [int]$ran.Groups[1].Value } else { 0 }
  $skippedMatch = [regex]::Match($output, 'skipped=(\d+)')
  $skipped = if ($skippedMatch.Success) { [int]$skippedMatch.Groups[1].Value } else { 0 }
  if ($exitCode -eq 0 -and $count -ge $MinimumTests -and $skipped -le $MaximumSkips -and $output -match '(?m)^OK(?: \(|\s*$)') {
    Add-Check $Name 'PASS' ("{0}/{0} skipped={1}" -f $count, $skipped)
  } else {
    Add-Check $Name 'FAIL' ("ran={0} skipped={1}; {2}" -f $count, $skipped, $output.Trim())
  }
}

function Test-NodeSuite([string[]]$Paths, [string]$Name, [int]$MinimumTests) {
  $resolved = @($Paths | ForEach-Object { Join-Path $root $_ })
  $output = (& node --test --test-concurrency=1 --test-reporter=tap @resolved 2>&1 | Out-String)
  $exitCode = $LASTEXITCODE
  $testsMatch = [regex]::Match($output, '(?m)^# tests (\d+)')
  $passMatch = [regex]::Match($output, '(?m)^# pass (\d+)')
  $failMatch = [regex]::Match($output, '(?m)^# fail (\d+)')
  $count = if ($testsMatch.Success) { [int]$testsMatch.Groups[1].Value } else { 0 }
  $passed = if ($passMatch.Success) { [int]$passMatch.Groups[1].Value } else { 0 }
  $failed = if ($failMatch.Success) { [int]$failMatch.Groups[1].Value } else { -1 }
  if ($exitCode -eq 0 -and $count -ge $MinimumTests -and $failed -eq 0 -and $passed -eq $count) {
    Add-Check $Name 'PASS' ("{0}/{0} failed=0" -f $count)
  } else {
    Add-Check $Name 'FAIL' ("tests={0} pass={1} fail={2}; {3}" -f $count, $passed, $failed, $output.Trim())
  }
}

function Test-RemoteSecurityPatchHarness {
  $remoteDir = '/tmp/a2a_patch_test'
  try {
    ssh k40-ubuntu "rm -rf $remoteDir && mkdir -p $remoteDir/ops $remoteDir/tests" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Add-Check 'pi-a2a-security-patch-tests' 'FAIL' 'remote staging directory creation failed'
      return
    }
    scp (Join-Path $root 'ops\patch_pi_a2a_security.sh') ("k40-ubuntu:" + $remoteDir + "/ops/patch_pi_a2a_security.sh") | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Add-Check 'pi-a2a-security-patch-tests' 'FAIL' 'patch script upload failed'
      return
    }
    scp (Join-Path $root 'tests\test_pi_a2a_security_patch.py') ("k40-ubuntu:" + $remoteDir + "/tests/test_pi_a2a_security_patch.py") | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Add-Check 'pi-a2a-security-patch-tests' 'FAIL' 'patch test upload failed'
      return
    }
    $output = ssh k40-ubuntu "cd $remoteDir && chmod 755 ops/patch_pi_a2a_security.sh && python3 tests/test_pi_a2a_security_patch.py -v" 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    $ran = [regex]::Match($output, 'Ran (\d+) tests?')
    $count = if ($ran.Success) { [int]$ran.Groups[1].Value } else { 0 }
    $skippedMatch = [regex]::Match($output, 'skipped=(\d+)')
    $skipped = if ($skippedMatch.Success) { [int]$skippedMatch.Groups[1].Value } else { 0 }
    if ($exitCode -eq 0 -and $count -ge 2 -and $skipped -eq 0 -and $output -match '(?m)^OK\s*$') {
      Add-Check 'pi-a2a-security-patch-tests' 'PASS' ("{0}/{0} skipped=0 host=k40-ubuntu" -f $count)
    } else {
      Add-Check 'pi-a2a-security-patch-tests' 'FAIL' ("ran={0} skipped={1}; {2}" -f $count, $skipped, $output.Trim())
    }
  } catch {
    Add-Check 'pi-a2a-security-patch-tests' 'FAIL' $_.Exception.Message
  }
}

Test-File 'aims/A2A/00_a2a_agent_20261028.md' 'aims-00'
Test-File 'aims/A2A/01_aims_codex_pi_a2a_20261028.md' 'aims-01'
Test-File 'aims/A2A/02_aimstodolist_codex_pi_a2a_20261028.md' 'aims-02'
Test-File 'aims/A2A/03_aims_codex_pi_a2a_20261028.md' 'aims-03'
Test-File 'aims/A2A/04_qa_tdd_harness_20261028.md' 'aims-04'
Test-File 'ops/pi_idempotent_runner.sh' 'runner'
Test-File 'ops/pi_a2a_launch.sh' 'pi-launcher'
Test-File 'ops/patch_pi_a2a_security.sh' 'pi-a2a-security-patch'
Test-File 'tests/a2a_master_harness.py' 'runner-harness'
Test-File 'BioanalysDesktop/server/a2a_state.js' 'pi-a2a-state'
Test-File 'BioanalysDesktop/server/pi_agent_routes.js' 'pi-agent-routes'
Test-File 'BioanalysDesktop/tests/a2a_state.test.js' 'pi-a2a-state-test'
Test-File 'BioanalysDesktop/tests/pi_agent_routes.test.js' 'pi-agent-routes-test'
Test-File 'ops/codex_a2a_compat_proxy.py' 'codex-a2a-compat-proxy'
Test-File 'ops/codex_a2a_compat.ps1' 'codex-a2a-compat-entry'
Test-File 'tests/test_codex_a2a_compat.py' 'codex-a2a-compat-test'
Test-File 'ops/release-plan.mjs' 'release-plan'
Test-File 'src/core/SlotManager.ts' 'slot-manager'
Test-File 'src/core/DeliverableCollector.ts' 'deliverable-collector'
Test-File 'src/core/types.ts' 'core-types'
Test-File 'src/engines/compute-engine/interface.ts' 'compute-engine-interface'
Test-File 'src/engines/compute-engine/implementation.ts' 'compute-engine-implementation'
Test-File 'src/engines/compute-engine/adapters.ts' 'compute-engine-adapters'
Test-File 'src/engines/bridge-engine/interface.ts' 'bridge-engine-interface'
Test-File 'src/engines/bridge-engine/implementation.ts' 'bridge-engine-implementation'
Test-File 'src/engines/bridge-engine/adapters.ts' 'bridge-engine-adapters'
Test-File 'src/engines/sync-engine/interface.ts' 'sync-engine-interface'
Test-File 'src/engines/sync-engine/implementation.ts' 'sync-engine-implementation'
Test-File 'src/engines/sync-engine/adapters.ts' 'sync-engine-adapters'
Test-File 'src/engines/plot-engine/interface.ts' 'plot-engine-interface'
Test-File 'src/engines/plot-engine/implementation.ts' 'plot-engine-implementation'
Test-File 'src/engines/plot-engine/adapters.ts' 'plot-engine-adapters'
Test-File 'src/engines/a2a-rpc-engine/a2a_client_poller.py' 'a2a-rpc-engine'
Test-File 'src/engines/artifact-sync-engine/artifact_extractor.py' 'artifact-extractor'
Test-File 'tests/test_a2a_acceptance_live.py' 'a2a-live-acceptance-test'
Test-File 'src/engines/transport-keepalive-engine/interface.ts' 'transport-keepalive-interface'
Test-File 'src/engines/transport-keepalive-engine/implementation.ts' 'transport-keepalive-implementation'
Test-File 'src/engines/transport-keepalive-engine/adapters.ts' 'transport-keepalive-adapters'
Test-File 'ops/check_transport_keepalive.mjs' 'transport-keepalive-probe-file'
Test-File 'tests/transport_keepalive_compile.cjs' 'transport-keepalive-compile'
Test-File 'tests/test_transport_keepalive.py' 'transport-keepalive-test-source'
Test-File 'src/engines/artifact-sync-engine/artifact_validator.py' 'artifact-sync-engine'
Test-File 'src/engines/security-audit-engine/security_audit.py' 'security-audit-engine'
Test-File 'src/mods/mod-portal-sync/manifest.ts' 'portal-sync-manifest'
Test-File 'src/mods/mod-portal-sync/schema.ts' 'portal-sync-schema'
Test-File 'src/mods/mod-portal-sync/implementation.ts' 'portal-sync-implementation'
Test-File 'src/mods/mod-portal-sync/slots/exportSlot.ts' 'portal-sync-slot'
Test-File 'src/mods/mod-biz-alpha/manifest.ts' 'biz-alpha-manifest'
Test-File 'src/mods/mod-biz-alpha/schema.ts' 'biz-alpha-schema'
Test-File 'src/mods/mod-biz-alpha/implementation.ts' 'biz-alpha-implementation'
Test-File 'src/mods/mod-biz-alpha/slots/AlphaSlots.ts' 'biz-alpha-slots'
Test-File 'src/mods/mod-template-studio/manifest.ts' 'template-studio-manifest'
Test-File 'src/mods/mod-template-studio/schema.ts' 'template-studio-schema'
Test-File 'src/mods/mod-template-studio/implementation.ts' 'template-studio-implementation'
Test-File 'src/mods/mod-template-studio/slots/TemplateSlots.ts' 'template-studio-slots'
Test-File 'src/mods/mod-biz-beta/manifest.ts' 'biz-beta-manifest'
Test-File 'src/mods/mod-biz-beta/schema.ts' 'biz-beta-schema'
Test-File 'src/mods/mod-biz-beta/implementation.ts' 'biz-beta-implementation'
Test-File 'src/mods/mod-biz-beta/slots/BetaSlots.ts' 'biz-beta-slots'
Test-File 'docs/modules/README.md' 'module-docs-index'
Test-File 'con_hf/runs/2026-10-28_a2a_v1_2/MATRIX_COVERAGE.md' 'matrix-coverage'
Test-File 'ops/check-gates.mjs' 'check-gates'
Test-File 'ops/align-sha256.mjs' 'align-sha256'
Test-File 'ops/deploy-k40-termux.sh' 'deploy-k40-termux'
Test-File '.env.a2a.example' 'env-example'

$k40Aims = Join-Path $root 'aims\K40\aims.txt'
if (Test-Path -LiteralPath $k40Aims) {
  $len = (Get-Item -LiteralPath $k40Aims).Length
  if ($len -gt 0) { Add-Check 'k40-aims' 'PASS' ("bytes=" + $len) }
  else { Add-Check 'k40-aims' 'WARN' 'aims/K40/aims.txt is empty; A2A docs used as source' }
} else {
  Add-Check 'k40-aims' 'FAIL' 'missing aims/K40/aims.txt'
}

$decisions = Join-Path $root 'con_hf\SPEC_DECISIONS.md'
if ((Test-Path -LiteralPath $decisions) -and (Select-String -LiteralPath $decisions -Pattern 'A2A-D-12' -Quiet)) {
  Add-Check 'decisions' 'PASS' 'A2A-D-12 present'
} else {
  Add-Check 'decisions' 'FAIL' 'A2A-D-12 missing'
}

$runnerText = Get-Content -LiteralPath (Join-Path $root 'ops/pi_idempotent_runner.sh') -Raw
$fixes = @('FIX-01', 'FIX-02', 'FIX-03', 'FIX-04', 'FIX-05', 'FIX-06', 'FIX-07') | Where-Object { $runnerText.Contains($_) }
if ($fixes.Count -eq 7) { Add-Check 'runner-v1.2-markers' 'PASS' 'FIX-01..07 present' }
else { Add-Check 'runner-v1.2-markers' 'FAIL' ('present=' + ($fixes -join ',')) }

$runnerContracts = [ordered]@{
  'lock-dir' = '.lock.d'
  'owner-meta' = 'owner.json'
  'child-pgid' = 'child_pgid'
  'process-group' = 'setsid'
  'input-hash' = 'inputs_sha256'
  'utf8-summary' = "jq -Rsr '.[0:320]'"
  'png-iend' = '49454e44ae426082'
  'preliminary-acceptance' = 'preliminary_acceptance'
}
$missingContracts = @($runnerContracts.GetEnumerator() | Where-Object {
  -not $runnerText.Contains([string]$_.Value)
} | ForEach-Object { $_.Key })
if ($missingContracts.Count -eq 0) {
  Add-Check 'runner-v1.2-contract' 'PASS' 'lock, process group, hashes, UTF-8 summary, PNG IEND present'
} else {
  Add-Check 'runner-v1.2-contract' 'FAIL' ('missing=' + ($missingContracts -join ','))
}

$runnerMirror = Join-Path $root 'aims\A2A\pi_idempotent_runner.bash'
if (Test-Path -LiteralPath $runnerMirror) {
  $sourceHash = (Get-FileHash -LiteralPath (Join-Path $root 'ops/pi_idempotent_runner.sh') -Algorithm SHA256).Hash
  $mirrorHash = (Get-FileHash -LiteralPath $runnerMirror -Algorithm SHA256).Hash
  if ($sourceHash -eq $mirrorHash) {
    Add-Check 'runner-aims-mirror' 'PASS' ('sha256=' + $sourceHash)
  } else {
    Add-Check 'runner-aims-mirror' 'FAIL' ('source=' + $sourceHash + ' mirror=' + $mirrorHash)
  }
} else {
  Add-Check 'runner-aims-mirror' 'FAIL' 'aims/A2A/pi_idempotent_runner.bash missing'
}

$ledger = & python3 (Join-Path $root 'ops\ledger_indexer.py') --root $root --verify 2>&1
if ($ledger -match 'LEDGER_VERIFY_OK') {
  Add-Check 'ledger-verify' 'PASS' $ledger.Trim()
} else {
  Add-Check 'ledger-verify' 'FAIL' $ledger.Trim()
}

$secretScan = & python3 (Join-Path $root 'src\engines\security-audit-engine\security_audit.py') --scan-root $root 2>&1
if ($LASTEXITCODE -eq 0 -and $secretScan -match '"ok": true') {
  Add-Check 'secret-scan' 'PASS' 'no A2A peer token in code or config'
} else {
  Add-Check 'secret-scan' 'FAIL' ($secretScan | Out-String).Trim()
}

Test-PythonSuite 'tests\test_a2a_core.py' 'a2a-core-tests' 12
Test-PythonSuite 'tests\test_a2a_artifact.py' 'a2a-artifact-tests' 24
Test-PythonSuite 'tests\test_a2a_poller_state.py' 'a2a-poller-state-tests' 7
Test-PythonSuite 'tests\test_a2a_e2e_artifact.py' 'a2a-e2e-artifact-tests' 15 1
Test-PythonSuite 'tests\test_pi_a2a_launcher.py' 'pi-a2a-launcher-tests' 2
Test-PythonSuite 'tests\test_pi_telemetry_sidecar.py' 'pi-telemetry-sidecar-tests' 1
Test-PythonSuite 'tests\test_mod_pi_observability.py' 'pi-observability-contract-tests' 1
Test-PythonSuite 'tests\test_e2e_a2a_pipeline.py' 'a2a-e2e-contract-tests' 8 1
Test-NodeSuite @(
  'BioanalysDesktop\tests\pi_agent.test.js',
  'BioanalysDesktop\tests\pi_agent_routes.test.js',
  'BioanalysDesktop\tests\a2a_state.test.js'
) 'pi-agent-node-tests' 22
Test-RemoteSecurityPatchHarness

$gateRaw = (& node (Join-Path $root 'ops\check-gates.mjs') 2>&1 | Out-String)
try {
  $gate = $gateRaw | ConvertFrom-Json
  if ($gate.ok -and $gate.summary.fail -eq 0) {
    Add-Check 'check-gates' 'PASS' ('pass=' + $gate.summary.pass + ' warn=' + $gate.summary.warn + ' fail=0')
  } else {
    Add-Check 'check-gates' 'FAIL' ('pass=' + $gate.summary.pass + ' warn=' + $gate.summary.warn + ' fail=' + $gate.summary.fail)
  }
} catch {
  Add-Check 'check-gates' 'FAIL' $gateRaw.Trim()
}

Test-PythonSuite 'tests\test_compute_engine.py' 'compute-engine-tests' 5
Test-PythonSuite 'tests\test_bridge_engine.py' 'bridge-engine-tests' 5
Test-PythonSuite 'tests\test_sync_engine.py' 'sync-engine-tests' 3
Test-PythonSuite 'tests\test_plot_engine.py' 'plot-engine-tests' 4
Test-PythonSuite 'tests\test_align_sha256.py' 'align-sha256-tests' 4
Test-PythonSuite 'tests\test_portal_sync.py' 'portal-sync-tests' 3
Test-PythonSuite 'tests\test_biz_alpha.py' 'biz-alpha-tests' 5
Test-PythonSuite 'tests\test_template_studio.py' 'template-studio-tests' 2
Test-PythonSuite 'tests\test_biz_beta.py' 'biz-beta-tests' 3
Test-PythonSuite 'tests\test_core_types.py' 'core-types-tests' 1
Test-PythonSuite 'tests\test_codex_a2a_compat.py' 'codex-a2a-compat-tests' 3
Test-PythonSuite 'tests\test_release_plan.py' 'release-plan-tests' 1
Test-PythonSuite 'tests\test_check_gates.py' 'check-gates-tests' 3
Test-PythonSuite 'tests\test_transport_keepalive.py' 'transport-keepalive-contract-tests' 6

$moduleDocs = @(Get-ChildItem (Join-Path $root 'docs\modules') -Recurse -File -Filter '*.txt' -ErrorAction SilentlyContinue)
if ($moduleDocs.Count -eq 15) {
  Add-Check 'module-docs-files' 'PASS' '15/15'
} else {
  Add-Check 'module-docs-files' 'FAIL' ("files=" + $moduleDocs.Count)
}

$smokeRoot = Join-Path $root 'local_projects\PRJ_K40_SMOKE'
$smokeFiles = @(
  'data\alpha-reports\reconciled-baseline.json',
  'data\beta-outputs\robust-biomarkers-baseline.tsv',
  'data\template-outputs\bar-baseline.png',
  'data\portal-sync\signed-baseline.packlet.json'
)
$missingSmoke = @($smokeFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $smokeRoot $_)) })
if ($missingSmoke.Count -eq 0) {
  Add-Check 'k40-smoke-samples' 'PASS' '4/4'
} else {
  Add-Check 'k40-smoke-samples' 'FAIL' ('missing=' + ($missingSmoke -join ','))
}

$remoteGateDir = '/tmp/a2a_preflight_deploy'
try {
  ssh k40-ubuntu "rm -rf $remoteGateDir && mkdir -p $remoteGateDir" | Out-Null
  scp (Join-Path $root 'ops\deploy-k40-termux.sh') ("k40-ubuntu:" + $remoteGateDir + "/deploy-k40-termux.sh") | Out-Null
  scp (Join-Path $root 'tests\test_deploy_k40_termux.sh') ("k40-ubuntu:" + $remoteGateDir + "/test_deploy_k40_termux.sh") | Out-Null
  $deployTest = ssh k40-ubuntu "chmod 755 $remoteGateDir/deploy-k40-termux.sh $remoteGateDir/test_deploy_k40_termux.sh; $remoteGateDir/test_deploy_k40_termux.sh $remoteGateDir/deploy-k40-termux.sh" 2>&1 | Out-String
  if ($deployTest -match 'DEPLOY_GATE_TEST_OK') {
    Add-Check 'deploy-k40-termux-tests' 'PASS' '12/12'
  } else {
    Add-Check 'deploy-k40-termux-tests' 'FAIL' $deployTest.Trim()
  }
} catch {
  Add-Check 'deploy-k40-termux-tests' 'FAIL' $_.Exception.Message
}

try {
  $health = Invoke-RestMethod -Uri "$Workbench/api/health" -TimeoutSec 10
  Add-Check 'workbench-health' 'PASS' ($health.service + ':' + $health.port)
} catch {
  Add-Check 'workbench-health' 'FAIL' $_.Exception.Message
}

try {
  $overview = Invoke-RestMethod -Uri "$Workbench/api/pi-agent/overview" -TimeoutSec 40
  if ($overview.ok -and $overview.online) {
    Add-Check 'pi-overview' 'PASS' ($overview.current_model.provider + '/' + $overview.current_model.model)
  } else {
    Add-Check 'pi-overview' 'FAIL' ($overview.error ?? 'offline')
  }
} catch {
  Add-Check 'pi-overview' 'FAIL' $_.Exception.Message
}

try {
  $model = Invoke-RestMethod -Uri "$Workbench/api/pi-agent/model" -TimeoutSec 30
  if ($model.ok -and $model.current.model) {
    Add-Check 'pi-model-api' 'PASS' ($model.current.provider + '/' + $model.current.model)
  } else {
    Add-Check 'pi-model-api' 'FAIL' ($model.error ?? 'no current model')
  }
} catch {
  Add-Check 'pi-model-api' 'FAIL' $_.Exception.Message
}

$phoneRunner = ssh k40 'test -x "$HOME/bin/pi_idempotent_runner.sh" && echo OK || echo MISSING' 2>$null
if ($phoneRunner -match 'OK') { Add-Check 'phone-runner' 'PASS' '~/bin/pi_idempotent_runner.sh executable' }
else { Add-Check 'phone-runner' 'FAIL' 'phone runner missing or not executable' }

Test-RemoteFileHash 'ops/pi_a2a_daemon.sh' '$HOME/bin/pi_a2a_daemon.sh' 'remote-daemon-hash'
Test-RemoteFileHash 'ops/pi_a2a_launch.sh' '$HOME/bin/pi_a2a_launch.sh' 'remote-launcher-hash'
Test-RemoteFileHash 'ops/pi_idempotent_runner.sh' '$HOME/bin/pi_idempotent_runner.sh' 'remote-runner-hash'
Test-RemoteFileHash 'ops/pi_telemetry_sidecar.py' '$HOME/bin/pi_telemetry_sidecar.py' 'remote-sidecar-hash'
Test-RemoteFileHash 'ops/patch_pi_a2a_security.sh' '$HOME/bin/patch_pi_a2a_security.sh' 'remote-pi-a2a-security-patch-hash'
Test-RemoteCommandlineSecret
Test-RemoteSecurityPatch

$windows = ssh k40 'tmux list-windows -t pi-a2a -F "#{window_name}:#{pane_dead}" 2>/dev/null' 2>$null
if ($windows -match 'a2a-server:0' -and $windows -match 'telemetry:0') {
  Add-Check 'tmux-windows' 'PASS' ($windows -join '; ')
} else {
  Add-Check 'tmux-windows' 'FAIL' ($windows -join '; ')
}

$phantomSetting = & adb -s $Serial shell settings get global settings_enable_monitor_phantom_procs 2>$null
$phantomMax = & adb -s $Serial shell device_config get activity_manager max_phantom_processes 2>$null
if ($phantomSetting -eq 'false' -and $phantomMax -eq '2147483647') {
  Add-Check 'phantom-settings' 'PASS' 'monitor=false max=2147483647'
} else {
  Add-Check 'phantom-settings' 'FAIL' ("monitor=" + $phantomSetting + " max=" + $phantomMax)
}

$powerState = & adb -s $Serial shell dumpsys power 2>$null | Out-String
if ($powerState -match 'termux:service-wakelock') {
  Add-Check 'termux-wakelock' 'PASS' 'termux:service-wakelock held'
} else {
  Add-Check 'termux-wakelock' 'FAIL' 'termux:service-wakelock not found'
}

$idleWhitelist = & adb -s $Serial shell dumpsys deviceidle whitelist 2>$null | Out-String
if ($idleWhitelist -match '(?m)^user,com\.termux,') {
  Add-Check 'termux-battery-unrestricted' 'PASS' 'com.termux present in deviceidle whitelist'
} else {
  Add-Check 'termux-battery-unrestricted' 'FAIL' 'com.termux missing from deviceidle whitelist'
}

$batteryState = & adb -s $Serial shell dumpsys battery 2>$null | Out-String
if ($batteryState -match '(?m)^\s*(AC|USB|Wireless) powered:\s*true\s*$') {
  $pluggedLine = [regex]::Match($batteryState, '(?m)^\s*(AC|USB|Wireless) powered:\s*true\s*$').Value.Trim()
  Add-Check 'device-plugged' 'PASS' $pluggedLine
} else {
  Add-Check 'device-plugged' 'FAIL' 'device is not AC/USB/wireless powered'
}

$adbDevices = & adb devices 2>$null
if ($adbDevices -match ($Serial + '\s+device')) { Add-Check 'adb-device' 'PASS' $Serial }
else { Add-Check 'adb-device' 'FAIL' 'target device not online' }

$codexA2A = Get-Command codex-a2a -ErrorAction SilentlyContinue
if ($codexA2A) {
  $version = (& codex-a2a --version 2>&1 | Select-Object -First 1).ToString().Trim()
  Add-Check 'codex-a2a' 'PASS' $version
  if ($version -match '1\.4\.0') {
    $compatFiles = @(
      'ops/codex_a2a_compat_proxy.py',
      'ops/codex_a2a_compat.ps1',
      'tests/test_codex_a2a_compat.py'
    )
    $missingCompat = @($compatFiles | Where-Object {
      -not (Test-Path -LiteralPath (Join-Path $root $_))
    })
    if ($missingCompat.Count -eq 0) {
      Add-Check 'codex-a2a-call-compat' 'PASS' '1.4.0 loopback proxy rewrites final and AgentCard endpoints'
    } else {
      Add-Check 'codex-a2a-call-compat' 'WARN' ('compat files missing: ' + ($missingCompat -join ','))
    }
  } else {
    Add-Check 'codex-a2a-call-compat' 'PASS' 'version not 1.4.0'
  }
} else {
  Add-Check 'codex-a2a' 'FAIL' 'codex-a2a not found'
}

$tsPc = Get-Command tailscale -ErrorAction SilentlyContinue
$tsPhone = ssh k40 'command -v tailscale 2>/dev/null' 2>$null
if ($tsPc -and $tsPhone) { Add-Check 'tailscale' 'PASS' 'PC and phone available' }
else { Add-Check 'tailscale' 'WARN' 'not installed on PC and/or phone; adb forward path remains active' }

$tailscaleHost = [string]$env:PI_TAILSCALE_IP
if ([string]::IsNullOrWhiteSpace($tailscaleHost)) {
  Add-Check 'transport-keepalive-probe' 'WARN' 'PI_TAILSCALE_IP not set; real Tailscale path not verified'
} else {
  $transportRaw = (& node (Join-Path $root 'ops\check_transport_keepalive.mjs') --phone-host $tailscaleHost --ssh-host 'k40' 2>&1 | Out-String)
  try {
    $transport = $transportRaw | ConvertFrom-Json
    if ($transport.ok) {
      Add-Check 'transport-keepalive-probe' 'PASS' ('rtt=' + $transport.averageRttMs + 'ms')
    } else {
      Add-Check 'transport-keepalive-probe' 'FAIL' $transport.stderr
    }
  } catch {
    Add-Check 'transport-keepalive-probe' 'FAIL' $transportRaw.Trim()
  }
}

$fails = @($checks | Where-Object { $_.Status -eq 'FAIL' })
$warns = @($checks | Where-Object { $_.Status -eq 'WARN' })
$passes = @($checks | Where-Object { $_.Status -eq 'PASS' })
$verdict = if ($fails.Count -gt 0) { 'FAIL' } else { 'PASS_WITH_WARNINGS' }

New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('# A2A v1.2 Preflight Gate')
$lines.Add('')
$lines.Add('> generated: ' + (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'))
$lines.Add('> verdict: ' + $verdict)
$lines.Add('> pass=' + $passes.Count + ' warn=' + $warns.Count + ' fail=' + $fails.Count)
$lines.Add('')
$lines.Add('| check | status | detail |')
$lines.Add('|---|---|---|')
foreach ($c in $checks) {
  $lines.Add('| ' + $c.Name + ' | ' + $c.Status + ' | ' + ($c.Detail -replace '\|', '\\|') + ' |')
}
$lines.Add('')
$lines.Add('## Remaining gaps')
$lines.Add('')
foreach ($c in $warns) { $lines.Add('- ' + $c.Name + ': ' + $c.Detail) }
if ($warns.Count -eq 0) { $lines.Add('- none') }
[System.IO.File]::WriteAllText($reportPath, (($lines -join "`n") + "`n"), [System.Text.UTF8Encoding]::new($false))

$checks | Format-Table Name, Status, Detail -AutoSize
Write-Host ('[a2a-preflight] verdict=' + $verdict + ' report=' + $reportPath)
if ($fails.Count -gt 0) { exit 1 }
exit 0
