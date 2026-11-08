import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 2026-10-21 加固：部署通道与「仓库 -> 引擎实际执行落点」一致性校验的静态守卫。
// 背景见 con_hf/pitfalls_ledger.md P-20 / P-21 与 con_hf/SPEC_DECISIONS.md D-17 / D-18。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const deployPath = path.join(repoRoot, 'tools', 'ops', '06_deploy_scripts.ps1');
const syncPath = path.join(repoRoot, 'tools', 'ops', 'sync_and_verify_remote.ps1');

const deployText = fs.readFileSync(deployPath, 'utf8');
const syncText = fs.readFileSync(syncPath, 'utf8');
const deployBytes = fs.readFileSync(deployPath);
const syncBytes = fs.readFileSync(syncPath);

test('06_deploy_scripts.ps1 是 UTF-8 无 BOM（当前仓库硬性规范）', () => {
  assert.notDeepEqual(Array.from(deployBytes.subarray(0, 3)), [0xef, 0xbb, 0xbf]);
});

test('06_deploy_scripts.ps1 校验阶段必须是单次 ssh 批量（禁止逐文件 ssh stat）', () => {
  assert.ok(deployText.includes('while IFS= read -r p'), '缺少批量读取循环');
  assert.ok(deployText.includes('stat -c %s \"$p\"'), '缺少远端 stat 批量调用');
  assert.ok(deployText.includes('printf \"MISSING|%s'), '缺少 MISSING 标记输出');
  assert.ok(deployText.includes('FILE|%s|%s|%s'), '缺少 FILE|size|exec 行协议');
  assert.ok(!deployText.includes("stat -c '%s' '$($item.Remote)'"), '仍残留逐文件 ssh stat（P-20 假红灯根因）');
});

test('06_deploy_scripts.ps1 链路失败与文件缺失必须分开判定', () => {
  assert.ok(deployText.includes('校验链路失败（ssh 连续两次非 0，不是文件缺失）'), '缺少链路失败专属文案');
  assert.ok(deployText.includes('$attempt -le 2'), '缺少 ssh 重试');
  assert.ok(deployText.includes('NO_RESULT'), '缺少「远端没回结果」这一档');
});

test('06_deploy_scripts.ps1 可执行位一次批量置位（不再逐文件 chmod）', () => {
  assert.ok(deployText.includes('批量 chmod 755'), '缺少批量 chmod');
  assert.ok(deployText.includes('CHMOD_OK'), '缺少 chmod 成功标记');
  assert.ok(deployText.includes('NOT_EXECUTABLE'), '缺少可执行位复核');
});

test('sync_and_verify_remote.ps1 含第 6 步部署一致性（仓库 vs bin/ 执行落点）', () => {
  assert.ok(syncText.includes('第 6 步'), '缺少第 6 步');
  assert.ok(syncText.includes('$deployPairs'), '缺少部署配对集合');
  assert.ok(syncText.includes("'/bin/' + $Matches[1]"), '缺少 bin 落点拼接');
  assert.ok(syncText.includes('部署一致性'), '缺少一致性输出');
  assert.ok(syncText.includes('部署漂移'), '缺少漂移告警');
});

test('sync 第 6 步：xargs 必须 || true，否则 123 退出码会让解析整段跳过', () => {
  const binCmdLine = syncText.split('\n').find((l) => l.includes('$binCmd ='));
  assert.ok(binCmdLine, '缺少 $binCmd');
  assert.ok(binCmdLine.includes('|| true'), 'xargs 缺少 || true（P-21：任一文件缺失即退 123）');
});

test('sync 第 6 步：README.md 等文档不算部署漂移', () => {
  assert.ok(syncText.includes("$rel -notlike '*.md'"), '缺少 .md 排除');
});

test('sync 第 6 步：-FailOnDrift 时部署漂移必须 exit 1', () => {
  assert.ok(syncText.includes('-FailOnDrift：检测到部署漂移'), '缺少 FailOnDrift 分支');
});

test('sync manifest 与台账都要带部署一致性结论', () => {
  assert.ok(syncText.includes('deploy = $deployNote'), 'manifest 缺少 deploy 字段');
  assert.ok(syncText.includes("' | 部署: ' + $deployNote"), '台账行缺少部署列');
});

test('sync_and_verify_remote.ps1 保持 LF-only（gitattributes 钉 eol=lf）', () => {
  for (let i = 0; i < syncBytes.length - 1; i += 1) {
    assert.ok(!(syncBytes[i] === 13 && syncBytes[i + 1] === 10), `第 ${i} 字节处出现 CRLF`);
  }
});

test('sync 远端预检失败不得伪装成 SAME 或放行 FailOnDrift', () => {
  assert.ok(syncText.includes('$remoteKnown = $false'), '缺少远端预检-known 状态');
  assert.ok(syncText.includes("'UNKNOWN'"), 'DryRun 缺少 UNKNOWN 标记');
  assert.ok(
    syncText.includes('远端预检失败，-FailOnDrift 不允许继续'),
    'FailOnDrift 缺少预检失败硬退出',
  );
});

test('sync 远端哈希预检必须分批，避免一次 ssh 命令过长被远端关闭', () => {
  assert.ok(syncText.includes('$preflightBatchSize = 20'), '缺少远端预检批大小');
  assert.ok(syncText.includes('$preflightOutputs'), '缺少预检输出聚合');
  assert.match(syncText, /for\s*\(\s*\$offset\s*=\s*0;/, '缺少预检分批循环');
});

// 2026-10-24 部署闸门：scripts/ 是母版目录，落到 bin/ 后即可被 /api/tasks/submit 点名执行，
// 而提交层只校验 step 字符集、不校验是否登记。曾把 4 个 R 测试案例落在这里，会被原样推上
// 服务器变成线上可执行步骤。注册表 tools/bio/workflows.json 是单一事实源，闸门据此在收集文件时拦截。
test('06_deploy_scripts.ps1 收集文件后必须按注册表闸门校验', () => {
  assert.ok(deployText.includes('tools/bio/workflows.json'), '闸门未引用注册表');
  assert.ok(deployText.includes('$registryScripts'), '缺少注册表索引');
  assert.ok(deployText.includes('$unregistered'), '缺少未登记集合');
  assert.ok(deployText.includes('未登记进 tools/bio/workflows.json 的件，拒绝部署'), '缺少拒绝文案');
  assert.ok(deployText.includes('exit 1'), '未登记时必须中止部署');
});

test('闸门必须排在文件收集之后、部署之前（拦在 scp 前才有意义）', () => {
  const collectAt = deployText.indexOf("Where-Object { $_.Name -ne 'README.md' }");
  const gateAt = deployText.indexOf('部署闸门：scripts/ 下的文件必须已在');
  const scpAt = deployText.indexOf('scp 直送');
  assert.notEqual(collectAt, -1, '未找到文件收集行');
  assert.notEqual(gateAt, -1, '未找到闸门');
  assert.ok(collectAt < gateAt, '闸门必须能看见收集结果');
  assert.ok(gateAt < scpAt, '闸门必须排在 scp 之前，否则件已经上服务器了');
});

test('豁免名单只放已知的非步骤脚本，且逐个写明理由', () => {
  assert.ok(deployText.includes('$deployExempt = @{'), '缺少豁免表');
  assert.ok(deployText.includes("'probe_env'"), '缺少 probe_env 豁免');
  assert.ok(
    deployText.includes('环境自检冒烟脚本'),
    '豁免必须写明理由，否则后来人不知道该不该继续放行',
  );
  // 共享库是两个 Python 模块，不是可提交的步骤：必须有豁免，否则部署闸门会把它们
  // 当未登记母版拦下，或者更糟，放上服务器变成可点名的 step。
  for (const lib of ['h5_rows.py', 'spatial_stats.py']) {
    assert.ok(deployText.includes("'" + lib + "'"), '缺少共享库豁免: ' + lib);
  }
  // 每个豁免项都必须带非空理由：断言豁免表里每一项等号右侧都有中文说明
  const exemptBlock = deployText.slice(deployText.indexOf('$deployExempt'));
  for (const lib of ['probe_env', 'h5_rows.py', 'spatial_stats.py']) {
    const at = exemptBlock.indexOf("'" + lib + "'");
    assert.notEqual(at, -1, '豁免项缺失: ' + lib);
    const lineEnd = exemptBlock.indexOf('\n', at);
    const line = exemptBlock.slice(at, lineEnd === -1 ? undefined : lineEnd);
    assert.ok(/=\s*'[^']{4,}'/.test(line), lib + ' 的豁免理由为空或过短');
  }
});

test('闸门把测试案例指到 cn_debug/，把新母版指到注册表', () => {
  assert.ok(deployText.includes('测试案例与一次性探针请放 cn_debug/'), '缺少测试案例的引导');
  assert.ok(deployText.includes('正式母版请先登记进 tools/bio/workflows.json'), '缺少新母版的引导');
});
