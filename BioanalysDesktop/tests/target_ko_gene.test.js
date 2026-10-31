/**
 * P14 虚拟敲除靶基因（target_ko_gene）必填打通测试
 *
 * 覆盖四块：
 *   A. 纯函数：KNOCKOUT_STEPS / requiresKoGene / isValidKoGene 的形态边界；
 *   B. buildTaskScript：注入 BIO_KO_GENE、与 BIOANALYS_SEED 共存、非敲除步骤不注入、
 *      缺基因抛错、throttled 包装下注入行仍排在包装命令之前（变量能穿过 run_throttled_task.sh）；
 *   C. 提交层真 HTTP：两个敲除步骤缺基因各 400、非法字符 400、非敲除步骤不受影响、
 *      合法基因 200 且 ssh 下发命令里真的带 BIO_KO_GENE；
 *   D. 前端静态断言：TaskPanel 有 targetKoGene 字段、有必填文案、只在敲除步骤渲染。
 *
 * in-process 起服务 + 假 ssh 垫片的写法沿用 tests/bridge_checkpoint.test.js /
 * tests/task_submit_validation.test.js（子进程形态在 Windows 下替换不了 ssh.exe）。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
// default 导入：task.js/run.js 同款接缝，mock.method 拦得到的才是真调用点
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

import {
  buildTaskScript, requiresKoGene, isValidKoGene, KNOCKOUT_STEPS, KO_GENE_PATTERN,
} from '../server/task.js';

const APP_TSX = path.resolve(import.meta.dirname, '../src/App.tsx');

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

/** 垫片配置：calls 记录全部 ssh 调用，用于断言下发命令里真的带了 BIO_KO_GENE */
const shim = {
  taskExit: 17, // 任务本体退出码（非 0，避免触发真实回搬 scp）
  calls: [],
};

function fakeSshChild(exitCode) {
  const child = new EventEmitter();
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  child.kill = () => child.emit('exit', exitCode, null);
  setImmediate(() => {
    child.stdout.push(null);
    child.stderr.push(null);
    setImmediate(() => child.emit('exit', exitCode, null));
  });
  return child;
}

before(async () => {
  process.env.BAD_PORT = String(PORT);
  const { mock } = await import('node:test');
  mock.method(childProcess, 'spawnSync', (cmd, args) => {
    shim.calls.push({ kind: 'spawnSync', cmd, joined: (args || []).join(' ') });
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(childProcess, 'spawn', (cmd, args) => {
    shim.calls.push({ kind: 'spawn', cmd, joined: (args || []).join(' ') });
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

async function stopTask(taskId) {
  if (!taskId) return;
  await fetch(`${BASE}/api/tasks/stop?id=${encodeURIComponent(taskId)}`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
}

// ───────────── A. 纯函数：判据表与基因符号形态 ─────────────

test('P14: 敲除步骤表恰为 virtual_knockout / spatial_knockout，其余步骤都不要求靶基因', () => {
  assert.deepEqual(KNOCKOUT_STEPS, ['virtual_knockout', 'spatial_knockout']);
  assert.equal(requiresKoGene('virtual_knockout'), true);
  assert.equal(requiresKoGene('spatial_knockout'), true);
  for (const other of ['prep_matrix', 'deg_limma', 'summarize_dr', 'spatial_localization', '', undefined]) {
    assert.equal(requiresKoGene(other), false, `${String(other)} 不该要求靶基因`);
  }
});

test('P14: 合法基因符号通过（含连字符、点、下划线、数字开头与 32 字符边界）', () => {
  for (const gene of ['TNF', 'Spp1', 'HLA-DRA', 'C1orf56', 'a1.2_x-y', '1-Mar', 'A'.repeat(32)]) {
    assert.equal(isValidKoGene(gene), true, `${gene} 应合法`);
    assert.match(gene, KO_GENE_PATTERN);
  }
});

test('P14: 非法基因符号一律拒（空串、空格、shell 元字符、路径、超长、非字符串）', () => {
  for (const bad of ['', ' ', 'TNF ', ' TN F', 'TNF;rm -rf /', 'TNF|x', 'TNF$x', '../etc/passwd', '-x', '.hidden', 'A'.repeat(33), 'TNF/../x']) {
    assert.equal(isValidKoGene(bad), false, `${JSON.stringify(bad)} 应被拒`);
  }
  for (const notString of [null, undefined, 42, {}, []]) {
    assert.equal(isValidKoGene(notString), false, `${JSON.stringify(notString)} 应被拒`);
  }
});

// ───────────── B. buildTaskScript 注入 ─────────────

test('P14: virtual_knockout 生成脚本注入 BIO_KO_GENE，且 cd 与 PATH 注入形态不变', () => {
  const script = buildTaskScript({
    projectId: 'default', lineId: 'line2_scrna', step: 'virtual_knockout',
    inputs: [], outputs: [], seed: 20261013, targetKoGene: 'TNF',
  });
  assert.match(script, /^export BIO_KO_GENE='TNF'$/m, `脚本应注入靶基因: ${script}`);
  assert.match(script, /^cd \/mnt\/ssd\/bio_data\/projects\/default\/line2_scrna\/processed$/m);
  // 用 includes 而非正则：这段字面量里同时含双引号与斜杠，正则转义太容易出错
  assert.ok(script.includes('export PATH="/mnt/ssd/bio_data/bin/line2_scrna:$PATH"'), `PATH 垫片形态应保持: ${script}`);
  assert.match(script, /^'virtual_knockout'/m);
});

test('P14: 靶基因注入与 BIOANALYS_SEED 共存（种子语义不被打断）', () => {
  const script = buildTaskScript({
    projectId: 'default', lineId: 'line3_spatial', step: 'spatial_knockout',
    inputs: [], outputs: [], seed: 20261013, targetKoGene: 'Spp1',
  });
  assert.match(script, /^export BIOANALYS_SEED="\$SEED"$/m);
  assert.match(script, /^SEED=20261013$/m);
  assert.match(script, /^export BIO_KO_GENE='Spp1'$/m);
  assert.match(script, /--seed 20261013/);
});

test('P14: 非敲除步骤即使传了 targetKoGene 也不注入（语义：忽略）', () => {
  const script = buildTaskScript({
    projectId: 'default', lineId: 'line1_bulk', step: 'deg_limma',
    inputs: ['expr_genes.tsv'], outputs: [], seed: 1, targetKoGene: 'TNF',
  });
  assert.equal(/BIO_KO_GENE/.test(script), false, `非敲除步骤不该出现 BIO_KO_GENE: ${script}`);
});

test('P14: 敲除步骤缺基因或基因非法时 buildTaskScript 抛错（不许静默退回 TNF）', () => {
  for (const targetKoGene of [undefined, null, '', 'TNF;rm -rf /', '../x']) {
    assert.throws(
      () => buildTaskScript({ projectId: 'default', lineId: 'line2_scrna', step: 'virtual_knockout', inputs: [], outputs: [], targetKoGene }),
      /虚拟敲除步骤必须指定合法 target_ko_gene/,
      `${JSON.stringify(targetKoGene)} 应抛错`,
    );
  }
});

test('P14: throttled 包装下 BIO_KO_GENE 的 export 仍排在 run_throttled_task.sh 之前（变量能穿过包装器到母版）', () => {
  const script = buildTaskScript({
    projectId: 'default', lineId: 'line2_scrna', step: 'virtual_knockout',
    inputs: [], outputs: [], seed: 20261013, targetKoGene: 'TNF', throttled: true,
  });
  const exportAt = script.indexOf("export BIO_KO_GENE='TNF'");
  const wrapperAt = script.indexOf('run_throttled_task.sh');
  assert.ok(exportAt > 0, `应有 export 行: ${script}`);
  assert.ok(wrapperAt > exportAt, 'export 必须在包装器调用之前（bash 子进程继承环境）');
  // D-21：包装器 $5 现在是母版绝对路径（bin/<线>/<步骤名>），不再把整条命令串当脚本路径
  assert.match(script, /self '\/mnt\/ssd\/bio_data\/bin\/line2_scrna\/virtual_knockout'/);
});

// ───────────── C. 提交层真 HTTP ─────────────

test('P14: virtual_knockout 缺 targetKoGene → 400，error 点名必须指定靶基因', async () => {
  shim.calls = [];
  const response = await submit({ projectId: 'p14a', lineId: 'line2_scrna', step: 'virtual_knockout', inputs: [], outputs: [] });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /虚拟敲除必须指定 target_ko_gene/);
  assert.match(body.error, /virtual_knockout/);
  assert.equal(shim.calls.filter((c) => c.kind === 'spawn').length, 0, '缺基因必须在提交前拦下，不许 ssh 下发');
});

test('P14: spatial_knockout 缺 targetKoGene → 400（第二条线同口径）', async () => {
  shim.calls = [];
  const response = await submit({ projectId: 'p14b', lineId: 'line3_spatial', step: 'spatial_knockout', inputs: [], outputs: [] });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /虚拟敲除必须指定 target_ko_gene/);
  assert.match(body.error, /spatial_knockout/);
  assert.equal(shim.calls.filter((c) => c.kind === 'spawn').length, 0);
});

test('P14: 靶基因含非法字符 → 400，error 点名字段与原文', async () => {
  shim.calls = [];
  const response = await submit({
    projectId: 'p14c', lineId: 'line2_scrna', step: 'virtual_knockout',
    inputs: [], outputs: [], targetKoGene: 'TNF;rm -rf /',
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /targetKoGene 非法/);
  assert.ok(body.error.includes('TNF;rm -rf /'), `error 应含违规原文: ${body.error}`);
  assert.equal(shim.calls.filter((c) => c.kind === 'spawn').length, 0);
});

test('P14: 非敲除步骤不受影响（不传 targetKoGene 仍 200 下发）', async () => {
  shim.calls = [];
  const response = await submit({ projectId: 'p14d', lineId: 'line1_bulk', step: 'p14_plain_probe', inputs: [], outputs: [], seed: 20261013 });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.taskId);
  const taskCall = shim.calls.find((c) => c.kind === 'spawn' && c.joined.includes('p14_plain_probe'));
  assert.ok(taskCall, `应正常下发: ${JSON.stringify(shim.calls)}`);
  assert.equal(/BIO_KO_GENE/.test(taskCall.joined), false, '非敲除步骤的下发命令不该带 BIO_KO_GENE');
  await stopTask(body.taskId);
});

test('P14: 合法基因的 virtual_knockout 下发 200，且 ssh 命令里带 BIO_KO_GENE（端到端串通）', async () => {
  shim.calls = [];
  const response = await submit({
    projectId: 'p14e', lineId: 'line2_scrna', step: 'virtual_knockout',
    inputs: [], outputs: [], seed: 20261013, targetKoGene: 'TNF',
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.taskId, `应下发成功: ${JSON.stringify(body)}`);
  const taskCall = shim.calls.find((c) => c.kind === 'spawn' && c.joined.includes('virtual_knockout'));
  assert.ok(taskCall, `应有任务 ssh 下发: ${JSON.stringify(shim.calls)}`);
  assert.ok(taskCall.joined.includes("export BIO_KO_GENE='TNF'"), `下发命令应注入靶基因: ${taskCall.joined}`);
  await stopTask(body.taskId);
});

// ───────────── D. 前端静态断言（TaskPanel）─────────────

const appSource = fs.readFileSync(APP_TSX, 'utf8');

test('P14: TaskPanel 提交体带 targetKoGene 字段，且只在敲除步骤传值', () => {
  assert.match(appSource, /targetKoGene: needsKoGene \? gene : undefined/);
  assert.match(appSource, /const KO_STEPS = \['virtual_knockout', 'spatial_knockout'\]/);
  assert.match(appSource, /const needsKoGene = KO_STEPS\.includes\(step\.trim\(\)\)/);
});

test('P14: TaskPanel 有必填提示文案与靶基因输入框，且渲染条件挂在 needsKoGene 上', () => {
  assert.match(appSource, /敲除靶基因 target_ko_gene（必填）/);
  assert.match(appSource, /\{needsKoGene && \(/, '输入框必须只在敲除步骤渲染');
  assert.match(appSource, /setKoGene\(e\.target\.value\)/);
  assert.match(appSource, /BIO_KO_GENE/, '界面要说明注入的环境变量名');
});

test('P14: 空值或非法基因时下发按钮禁用，且 submit 里还有一道前端拦截', () => {
  assert.match(appSource, /disabled=\{submitting \|\| running \|\| \(needsKoGene && !KO_GENE_RE\.test\(koGene\.trim\(\)\)\)\}/);
  assert.match(appSource, /虚拟敲除必须指定靶基因（target_ko_gene）/);
  assert.match(appSource, /靶基因非法：只允许字母数字与 \. _ -/);
});
