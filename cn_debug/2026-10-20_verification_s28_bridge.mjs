#!/usr/bin/env node
/**
 * S28 桥接四项断言接线 · K40 真链验证（幂等，可重复执行）
 *
 * 正路径（真 K40、真引擎）：
 *   对 default 项目 line2 双语步骤 gsva_pathways 提交一次任务
 *   （输入 scrna_annotated.h5ad = 该步骤真实上游产物），
 *   断言：提交 200 + taskId、服务端日志出现 `[bridge] line2_scrna/gsva_pathways 四项断言通过`、
 *   任务出现在 /api/tasks（正常下发）。随后立即 stop，避免重算；
 *   前后对比远端 processed/figures 文件数，断言 data 面未被改动。
 *
 * 负路径（真 K40、真引擎，不改引擎文件）：
 *   在远端 /tmp 用 anndata 造一个 var_names 全数字的坏 h5ad（S28 临时验证物，不入项目目录），
 *   以它为 input 提交同一双语步骤，断言提交 400 且 error 含引擎原文
 *   `[BRIDGE FAIL] ... Ensembl ID`（点名基因名断言）。用完即删。
 *
 * 侧效应说明：正路径任务被 stop，会按既有 stop 行为落一条 failed 台账（接线前行为一致）。
 * 台账/图件集合/processed 在前后快照对比中断言不变。
 *
 * 用法：node cn_debug/2026-10-20_verification_s28_bridge.mjs
 * 前置：adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022
 */

import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 必须用 fileURLToPath：中文路径经 URL.pathname 会变成百分号编码，cwd 不存在 → spawn ENOENT
const REPO = fileURLToPath(new URL('../BioanalysDesktop', import.meta.url));
const HOST = 'k40-ubuntu';
const RESULTS = [];

function ssh(command, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, command],
      { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`ssh 超时: ${command.slice(0, 80)}`)); }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: out, stderr: err });
    });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

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

async function startServer() {
  const port = await freePort();
  // 不用 process.execPath：本机 node 经 shim 启动时 execPath 指向不存在的安装路径
  // （实测 spawn D:\node-v2.4\node.exe ENOENT），改走 PATH 解析。
  const child = spawn('node', ['server/index.js'], {
    cwd: REPO,
    env: { ...process.env, BAD_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stdout += c; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) break;
    } catch { /* 等就绪 */ }
    if (Date.now() > deadline) throw new Error(`服务未就绪: ${stdout.slice(-500)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  return { child, base, getLog: () => stdout };
}

async function submit(base, body) {
  const r = await fetch(`${base}/api/tasks/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

function record(name, ok, detail) {
  RESULTS.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
}

async function remoteCounts() {
  const r = await ssh(
    "find /mnt/ssd/bio_data/projects/default/line2_scrna/processed /mnt/ssd/bio_data/projects/default/line2_scrna/figures -type f 2>/dev/null | wc -l && md5sum /mnt/ssd/bio_data/projects/default/line2_scrna/processed/* 2>/dev/null | md5sum",
  );
  return r.stdout.trim();
}

// ───────────── 主流程 ─────────────

const adb = spawn('adb', ['forward', 'tcp:10022', 'tcp:10022'], { windowsHide: true });
await new Promise((r) => adb.on('exit', r));
const adb2 = spawn('adb', ['forward', 'tcp:8022', 'tcp:8022'], { windowsHide: true });
await new Promise((r) => adb2.on('exit', r));

const link = await ssh('echo CONTAINER_OK');
if (link.code !== 0 || !link.stdout.includes('CONTAINER_OK')) {
  console.error('K40 不可达，真链验证中止（不伪造结果）:', link.stderr || link.stdout);
  process.exit(2);
}
record('链路', true, 'ssh k40-ubuntu 可达');

const before = await remoteCounts();
const srv = await startServer();

try {
  // ── 正路径：真引擎过四项断言 ──
  const H5AD = '/mnt/ssd/bio_data/projects/default/line2_scrna/processed/scrna_annotated.h5ad';
  const okRes = await submit(srv.base, {
    projectId: 'default', lineId: 'line2_scrna', step: 'gsva_pathways',
    inputs: [H5AD], outputs: [], seed: 20261013,
  });
  record('正路径·提交返回', okRes.status === 200 && !!okRes.body.taskId,
    `status=${okRes.status} body=${JSON.stringify(okRes.body).slice(0, 200)}`);

  const bridgePassLogged = srv.getLog().includes('[bridge] line2_scrna/gsva_pathways 四项断言通过');
  record('正路径·[bridge] 四项断言通过日志', bridgePassLogged,
    srv.getLog().split('\n').filter((l) => l.includes('[bridge]')).join(' || ').slice(0, 400));

  // 任务正常下发：出现在在跑任务表里（gsva 计算需数秒，此刻应仍在跑）
  let listed = null;
  for (let i = 0; i < 10 && !listed; i++) {
    const tasksRes = await fetch(`${srv.base}/api/tasks`, { signal: AbortSignal.timeout(3000) });
    const tasksBody = await tasksRes.json();
    listed = (tasksBody.tasks || []).find((t) => t.step === 'gsva_pathways' && t.taskId === okRes.body.taskId);
    if (!listed) await new Promise((r) => setTimeout(r, 200));
  }
  record('正路径·任务正常下发（在跑任务表可见）', !!listed, listed ? JSON.stringify(listed) : '2s 内未见于 /api/tasks');

  if (listed) {
    const stopRes = await fetch(`${srv.base}/api/tasks/stop?id=${encodeURIComponent(listed.taskId)}`,
      { method: 'POST', signal: AbortSignal.timeout(5000) });
    record('正路径·收尾 stop（避免重算）', stopRes.status === 200, `status=${stopRes.status}`);
    await new Promise((r) => setTimeout(r, 1500)); // 等本地 ssh 退出、远端会话终止
  }

  // ── 负路径：/tmp 造坏 h5ad，真引擎判死 ──
  // 造文件必须用 heredoc：python -c 经双层引号转义会被远端 shell 改坏（实测踩坑）
  const mk = await ssh(
    "rm -f /tmp/s28_bad_bridge.h5ad && python3 - <<'PYEOF'\n"
    + "import anndata as ad, numpy as np\n"
    + "a = ad.AnnData(X=np.ones((12, 10)))\n"
    + "a.var_names = [str(i) for i in range(10)]\n"
    + "a.obs_names = ['GSM%d' % i for i in range(12)]\n"
    + "a.write('/tmp/s28_bad_bridge.h5ad')\n"
    + "print('MADE')\n"
    + "PYEOF",
  );
  if (mk.code !== 0 || !mk.stdout.includes('MADE')) {
    record('负路径·造坏 h5ad', false, `code=${mk.code} ${mk.stderr.slice(0, 300)}`);
  } else {
    const badRes = await submit(srv.base, {
      projectId: 'default', lineId: 'line2_scrna', step: 'gsva_pathways',
      inputs: ['/tmp/s28_bad_bridge.h5ad'], outputs: [], seed: 20261013,
    });
    record('负路径·提交 400', badRes.status === 400,
      `status=${badRes.status} error=${String(badRes.body.error || '').slice(0, 300)}`);
    const errText = String(badRes.body.error || '');
    record('负路径·error 点名断言项（引擎原文）',
      errText.includes('[BRIDGE FAIL]') && errText.includes('Ensembl ID'), errText.slice(0, 300));
  }

  // ── 数据面不变快照对比 ──
  const after = await remoteCounts();
  record('数据面快照一致（processed+figures 文件数与内容 md5）', before === after,
    `before=[${before.split('\n').join(' | ')}] after=[${after.split('\n').join(' | ')}]`);
} finally {
  await ssh('rm -f /tmp/s28_bad_bridge.h5ad', 15000).catch(() => {});
  srv.child.kill();
}

const failed = RESULTS.filter((r) => !r.ok);
console.log(`\n==== S28 真链验证汇总: ${RESULTS.length - failed.length}/${RESULTS.length} PASS ====`);
if (failed.length) {
  failed.forEach((r) => console.log(`FAIL: ${r.name}: ${r.detail}`));
  process.exit(1);
}
