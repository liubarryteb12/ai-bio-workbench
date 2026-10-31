/**
 * S28 桥接四项断言接线测试（只增不改既有断言）
 *
 * 覆盖三块：
 *   A. needsBridgeCheck 纯函数：用真实母版判定双语/单语言/母版缺失（不许 mock 内容）。
 *   B. buildBridgeCheckCommand：命令含引擎绝对路径与参数；stepName 含 shell 元字符必须拒绝。
 *   C. 提交层接线：in-process 起真服务打真 HTTP + 假 ssh 垫片（mock default 导入的
 *      childProcess，run.js 已验证该接缝可拦截），验证 400/放行/503/无多余 ssh 往返。
 *
 * in-process 而非子进程的原因：子进程形态没法替换 ssh（Windows 下 spawn 只认
 * ssh.exe，脚本垫片不可执行）；桥接判定/命令构造是纯逻辑，进程形态不影响其行为，
 * 崩溃类回归已由 index.test.js 的子进程冒烟覆盖。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
// default 导入：run.js/task.js 同款接缝，mock.method 拦得到的才是真调用点
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

import { needsBridgeCheck, inspectBridgeNeed, buildBridgeCheckCommand, BridgeCheckError } from '../server/task.js';

// ───────────── A. needsBridgeCheck 纯函数（真实母版）─────────────

test('S28: 双语母版 gsva_pathways 判 true，判定依据带真实行号证据', () => {
  const need = inspectBridgeNeed('line2_scrna', 'gsva_pathways');
  // 实测（grep -nE 命令位调用）：python3 - <<'PYSCRIPT' @41、@147；Rscript - <<'RSCRIPT' @98
  assert.equal(need.masterExists, true);
  assert.ok(need.rCount >= 1, `Rscript 调用数应 >=1，实测 ${need.rCount}`);
  assert.ok(need.pCount >= 1, `python 调用数应 >=1，实测 ${need.pCount}`);
  assert.equal(need.bilingual, true);
  assert.equal(needsBridgeCheck('line2_scrna', 'gsva_pathways'), true);
  testContext(need);
});

function testContext(need) {
  // 用断言外的输出记录判定依据（行号证据见文件头注释与本行输出）
  console.log(`[S28 evidence] master=${need.masterPath} R=${need.rCount} P=${need.pCount}`);
}

test('S28: 双语母版 ml_diagnostics（line1）判 true', () => {
  const need = inspectBridgeNeed('line1_bulk', 'ml_diagnostics');
  // 实测：python3 - <<'PYSCRIPT' @61；BIOANALYS_SEED="$seed" Rscript - <<'RSCRIPT' @524
  assert.equal(need.masterExists, true);
  assert.ok(need.rCount >= 1 && need.pCount >= 1, `R=${need.rCount} P=${need.pCount}`);
  assert.equal(needsBridgeCheck('line1_bulk', 'ml_diagnostics'), true);
});

test('S28: 纯 R 母版 deg_limma 与纯 Python 母版 scrna_figures 判 false（单语言不过桥）', () => {
  const rOnly = inspectBridgeNeed('line1_bulk', 'deg_limma');
  // 实测：Rscript --vanilla - <<'RSCRIPT' @62，全文无命令位 python 调用
  assert.equal(rOnly.masterExists, true);
  assert.ok(rOnly.rCount >= 1 && rOnly.pCount === 0, `R=${rOnly.rCount} P=${rOnly.pCount}`);
  assert.equal(needsBridgeCheck('line1_bulk', 'deg_limma'), false);

  const pOnly = inspectBridgeNeed('line2_scrna', 'scrna_figures');
  // 实测：纯 Python 出图脚本，无命令位 Rscript 调用
  assert.equal(pOnly.masterExists, true);
  assert.ok(pOnly.rCount === 0 && pOnly.pCount >= 1, `R=${pOnly.rCount} P=${pOnly.pCount}`);
  assert.equal(needsBridgeCheck('line2_scrna', 'scrna_figures'), false);
});

test('S28: 不存在的 step 判 false 且带母版缺失原因（可观测，不抛错）', () => {
  const need = inspectBridgeNeed('line2_scrna', 'no_such_step_s28');
  assert.equal(needsBridgeCheck('line2_scrna', 'no_such_step_s28'), false);
  assert.equal(need.masterExists, false);
  assert.match(need.reason, /母版不存在/);
  assert.ok(need.masterPath, '缺失时也要给出尝试过的母版路径，便于 warn 定位');
});

// ───────────── B. buildBridgeCheckCommand ─────────────

test('S28: 命令使用分析 venv 垫片、引擎绝对路径、--input 与 --from/--to（h5ad → Python→R）', () => {
  const plan = buildBridgeCheckCommand('line2_scrna', 'gsva_pathways', {
    inputs: ['/mnt/ssd/bio_data/projects/default/line2_scrna/processed/scrna_annotated.h5ad'],
  });
  assert.ok(plan.command.startsWith(
    '/mnt/ssd/bio_data/ops/layout_autoload/bin/python3 /mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py',
  ));
  assert.match(plan.command, /--input '\/mnt\/ssd\/bio_data\/projects\/default\/line2_scrna\/processed\/scrna_annotated\.h5ad'/);
  assert.equal(plan.fromLang, 'Python');
  assert.equal(plan.toLang, 'R');
  assert.equal(plan.command, plan.remoteScript, '契约字段 command 与 remoteScript 同值');
});

test('S28: 相对输入按项目线 processed/ 解析；rds → R→Python', () => {
  const plan = buildBridgeCheckCommand('line1_bulk', 'ml_diagnostics', {
    inputs: ['bridge_tmp.rds'],
    projectId: 'PRJ_20261019_IS_lactylation',
  });
  assert.match(plan.command, /--input '\/mnt\/ssd\/bio_data\/projects\/PRJ_20261019_IS_lactylation\/line1_bulk\/processed\/bridge_tmp\.rds'/);
  assert.equal(plan.fromLang, 'R');
  assert.equal(plan.toLang, 'Python');
});

test('S28: stepName 含分号被拒绝（元字符负路径 1）', () => {
  assert.throws(
    () => buildBridgeCheckCommand('line2_scrna', 'gsva; rm -rf /tmp'),
    BridgeCheckError,
  );
});

test('S28: stepName 含命令替换与空格被拒绝（元字符负路径 2/3）', () => {
  assert.throws(
    () => buildBridgeCheckCommand('line2_scrna', 'gsva$(id)'),
    BridgeCheckError,
  );
  assert.throws(
    () => buildBridgeCheckCommand('line2_scrna', 'gsva pathways'),
    BridgeCheckError,
  );
});

test('S28: 双语步骤但无可校验输入 → 返回 null 命令 + reason（不编造参数）', () => {
  const plan = buildBridgeCheckCommand('line2_scrna', 'gsva_pathways', { inputs: ['pseudobulk.tsv'] });
  assert.equal(plan.command, null);
  assert.match(plan.reason, /\.h5ad\/\.rds/);
});

// ───────────── C. 提交层接线（真 HTTP + 假 ssh 垫片）─────────────

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;

/** 垫片配置：每条测试改这里，calls 记录全部 ssh 调用 */
const shim = {
  bridgeExit: 0,
  bridgeStdout: '',
  bridgeStderr: '',
  taskExit: 17, // 任务本体退出码（非 0，避免触发真实回搬 scp）
  calls: [],
};

function fakeSshChild(exitCode, stdoutText = '') {
  const child = new EventEmitter();
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  child.kill = () => child.emit('exit', exitCode, null);
  setImmediate(() => {
    if (stdoutText) child.stdout.push(stdoutText);
    child.stdout.push(null);
    child.stderr.push(null);
    // exit 必须 setImmediate：先让调用方把 stdout/stderr 挂上，再落 exit（同 run.test.js 先例）
    setImmediate(() => child.emit('exit', exitCode, null));
  });
  return child;
}

before(async () => {
  process.env.BAD_PORT = String(PORT);
  // 动态 import：必须在 BAD_PORT 就位之后，index.js 顶层会按它 listen
  const { mock } = await import('node:test');
  mock.method(childProcess, 'spawnSync', (cmd, args, opts) => {
    const joined = (args || []).join(' ');
    shim.calls.push({ kind: 'spawnSync', cmd, joined });
    if (joined.includes('verify_bridge_checkpoint.py')) {
      return { status: shim.bridgeExit, stdout: shim.bridgeStdout, stderr: shim.bridgeStderr };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(childProcess, 'spawn', (cmd, args, opts) => {
    const joined = (args || []).join(' ');
    shim.calls.push({ kind: 'spawn', cmd, joined });
    if (joined.includes('verify_bridge_checkpoint.py')) {
      return fakeSshChild(shim.bridgeExit, shim.bridgeStdout);
    }
    return fakeSshChild(shim.taskExit);
  });
  await import('../server/index.js');
  const deadline = Date.now() + 25000;
  for (;;) {
    try {
      const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) break;
    } catch { /* 没起来就继续等 */ }
    if (Date.now() > deadline) throw new Error(`服务 25s 内没就绪（端口 ${PORT}）`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});

after(async () => {
  const mod = await import('../server/index.js');
  mod.server.closeAllConnections?.();
  await new Promise((resolve) => mod.server.close(resolve));
});

async function submit(body) {
  return fetch(`${BASE}/api/tasks/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
}

const H5AD = '/mnt/ssd/bio_data/projects/default/line2_scrna/processed/scrna_annotated.h5ad';
const bilingualTask = () => ({
  projectId: 'default',
  lineId: 'line2_scrna',
  step: 'gsva_pathways',
  inputs: [H5AD],
  outputs: [],
  seed: 20261013,
});

test('S28: 双语步骤 + 引擎退出码 1 → 提交 400 且 error 带引擎原文', async (t) => {
  shim.bridgeExit = 1;
  shim.bridgeStdout = '';
  shim.bridgeStderr = '[BRIDGE FAIL] var_names 超过半数为数字索引（2/4），疑似 Ensembl ID 未映射';
  shim.calls = [];
  const logs = [];
  t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));

  const response = await submit(bilingualTask());
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /桥接四项断言未通过/);
  assert.match(body.error, /BRIDGE FAIL/);
  assert.match(body.error, /Ensembl ID/, 'error 必须点名是哪个断言没过（引擎原文在内）');

  // 只有桥接这一次 ssh，任务本体绝不能下发
  assert.equal(shim.calls.filter((c) => c.joined.includes('verify_bridge_checkpoint.py')).length, 1);
  assert.equal(shim.calls.some((c) => c.kind === 'spawn' && !c.joined.includes('verify_bridge_checkpoint.py')), false);
});

test('S28: 双语步骤 + 引擎退出码 0 → 不被拦住，任务正常下发并打 [bridge] 日志', async (t) => {
  shim.bridgeExit = 0;
  shim.bridgeStdout = '[BRIDGE PASS] all 4 assertions passed';
  shim.bridgeStderr = '';
  shim.calls = [];
  const logs = [];
  t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));

  const response = await submit(bilingualTask());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.taskId, `应有 taskId: ${JSON.stringify(body)}`);

  // 桥接 ssh 恰好 1 次 + 任务本体 ssh 已启动（垫片调用计数为证）
  assert.equal(shim.calls.filter((c) => c.joined.includes('verify_bridge_checkpoint.py')).length, 1);
  assert.equal(shim.calls.some((c) => c.kind === 'spawn' && c.joined.includes('gsva_pathways')), true);
  assert.ok(
    logs.some((line) => line.includes(`[bridge] line2_scrna/gsva_pathways 四项断言通过`)),
    `应有 [bridge] 通过日志，实际: ${logs.join('\n')}`,
  );

  // 收尾：垫片里任务已在退（exit 17），但保险起见显式中止，不占并发位
  await fetch(`${BASE}/api/tasks/stop?id=${encodeURIComponent(body.taskId)}`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
});

test('S28: K40 不可达（exit 255）→ 503 且明说桥接校验无法执行，不静默放过', async (t) => {
  shim.bridgeExit = 255;
  shim.bridgeStderr = 'ssh: connect to host 127.0.0.1 port 10022: Connection refused';
  shim.calls = [];
  const response = await submit(bilingualTask());
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /K40 不可达/);
  assert.equal(shim.calls.some((c) => c.kind === 'spawn'), false, '校验都没跑成，任务本体不许下发');
});

test('S28: 单语言步骤不产生桥接 ssh 往返（垫片调用计数为证）', async (t) => {
  shim.bridgeExit = 0;
  shim.calls = [];
  const response = await submit({
    projectId: 'default',
    lineId: 'line1_bulk',
    step: 'deg_limma',
    inputs: ['/mnt/ssd/bio_data/projects/default/line1_bulk/processed/expr_genes.tsv'],
    outputs: [],
    seed: 20261013,
  });
  assert.equal(response.status, 200);
  assert.equal(
    shim.calls.filter((c) => c.joined.includes('verify_bridge_checkpoint.py')).length,
    0,
    `单语言步骤不得有桥接 ssh，实际调用: ${JSON.stringify(shim.calls)}`,
  );
  assert.equal(shim.calls.some((c) => c.kind === 'spawn' && c.joined.includes('deg_limma')), true);
  await fetch(`${BASE}/api/tasks`).catch(() => {});
});

test('S28: 母版缺失步骤提交不被桥接阻断（保持既有行为），且有可观测 warn', async (t) => {
  shim.calls = [];
  const warns = [];
  t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
  const response = await submit({
    projectId: 'default',
    lineId: 'line2_scrna',
    step: 'no_such_step_s28',
    inputs: [],
    outputs: [],
    seed: 1,
  });
  assert.equal(response.status, 200, `母版缺失不得阻断提交: ${JSON.stringify(await response.json().catch(() => ({})))}`);
  assert.equal(
    shim.calls.filter((c) => c.joined.includes('verify_bridge_checkpoint.py')).length, 0,
  );
  assert.ok(warns.some((line) => line.includes('母版缺失')), `应有 warn: ${warns.join('\n')}`);
});

test('S28: 双语步骤但无 .h5ad/.rds 输入 → 不编造参数、不阻断，warn 留痕', async (t) => {
  shim.calls = [];
  const warns = [];
  t.mock.method(console, 'warn', (...a) => warns.push(a.join(' ')));
  const response = await submit({
    projectId: 'default',
    lineId: 'line2_scrna',
    step: 'gsva_pathways',
    inputs: ['pseudobulk.tsv'],
    outputs: [],
    seed: 20261013,
  });
  assert.equal(response.status, 200);
  assert.equal(shim.calls.filter((c) => c.joined.includes('verify_bridge_checkpoint.py')).length, 0);
  assert.ok(warns.some((line) => line.includes('未过引擎')), `应有 warn: ${warns.join('\n')}`);
});
