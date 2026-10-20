/**
 * S27 E2E 真链验证：客户交付报告工作台入口 × 真实 K40。
 *
 * 验证项（幂等，可反复重跑）：
 *   1. POST /api/report/build（PRJ_E2E_GSE277173，真 ssh 跑远端引擎）→ 200，三大件 bytes>0；
 *   2. 远端 deliverables/ 与本地 localDeliverDir 三大件 md5 逐件一致；
 *   3. GET /api/report/download?file=Analysis_Report.html → 200 + 字节数一致 + HTML 头非空；
 *   4. Analysis_Report.md 无服务器真实路径（grep /mnt/ssd 应 0 命中，引擎脱敏红线）。
 *
 * 用法：node cn_debug/2026-10-20_verification_s27_report_e2e.mjs
 * 退出码 0=全过 1=有失败（逐条打印实测值，不编造）。
 */

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runSync } from '../BioanalysDesktop/server/proc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.join(HERE, '..', 'BioanalysDesktop');
const PROJECT_ID = 'PRJ_E2E_GSE277173';
const REMOTE_DELIVER_DIR = `/mnt/ssd/bio_data/projects/${PROJECT_ID}/deliverables`;

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

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  | ${detail}` : ''}`);
}

const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;

// 起真服务（真实部署形态；ssh 走本机真实 ssh.exe，不经任何垫片）
const child = spawn(process.execPath, ['server/index.js'], {
  cwd: DESKTOP,
  env: { ...process.env, BAD_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverStderr = '';
child.stderr.on('data', (chunk) => { serverStderr += chunk.toString(); });

try {
  // 等服务就绪
  let ready = false;
  const deadline = Date.now() + 10000;
  while (!ready && Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
      ready = res.ok;
    } catch { /* 未起就继续等 */ }
    if (!ready) await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error(`服务 10s 内未就绪: ${serverStderr.slice(-500)}`);
  record('服务就绪', true, `port=${PORT}`);

  // ── 1. build（真跑远端引擎，可能数分钟）──
  console.log(`[e2e] POST /api/report/build projectId=${PROJECT_ID}（远端引擎执行中...）`);
  const buildRes = await fetch(`${BASE}/api/report/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: PROJECT_ID }),
  });
  const buildBody = await buildRes.json();
  if (buildRes.status !== 200 || !buildBody.ok) {
    record('build → 200 且 ok=true', false,
      `status=${buildRes.status} error=${JSON.stringify(buildBody.error || buildBody).slice(0, 800)}`);
    throw new Error('build 失败，终止后续校验');
  }
  const files = buildBody.files || [];
  record('build → 200 且 ok=true', true, `files=${files.map((f) => `${f.name}:${f.bytes}`).join(', ')}`);
  record('三大件齐全且 bytes>0',
    files.length === 3 && files.every((f) => f.bytes > 0 && f.path === f.name),
    `count=${files.length}`);
  record('report_md_bytes / report_html_bytes 一致',
    buildBody.report_md_bytes === (files.find((f) => f.name === 'Analysis_Report.md')?.bytes ?? -1)
    && buildBody.report_html_bytes === (files.find((f) => f.name === 'Analysis_Report.html')?.bytes ?? -1),
    `md=${buildBody.report_md_bytes} html=${buildBody.report_html_bytes}`);

  // ── 2. md5 逐件比对（远端 md5sum vs 本地 crypto）──
  // 引擎实测布局：报告在 <pid>_Client_Delivery/03_Interpretation_Report/ 下，tar.gz 在根
  const localDir = path.join(HERE, '..', 'deliverables', PROJECT_ID);
  const md5Local = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
  const remoteStat = runSync(
    ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu',
      `cd '${REMOTE_DELIVER_DIR}' && find . -type f \\( -name 'Analysis_Report.md' -o -name 'Analysis_Report.html' -o -name '*_Client_Delivery.tar.gz' \\) -print0 | xargs -0 md5sum`],
    { timeoutMs: 60000 }
  );
  if (remoteStat.code !== 0) {
    record('远端 md5sum 可执行', false, `exit=${remoteStat.code} ${remoteStat.stderr.slice(0, 300)}`);
  } else {
    const remoteMd5 = new Map(
      remoteStat.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
        const [hash, relPath] = line.trim().split(/\s+/);
        return [relPath.split('/').pop(), hash];
      })
    );
    for (const file of files) {
      const localPath = path.join(localDir, file.name);
      const localHash = md5Local(localPath);
      const remoteHash = remoteMd5.get(file.name);
      record(`md5 一致: ${file.name}`,
        localHash === remoteHash && remoteHash !== undefined,
        `local=${localHash} remote=${remoteHash ?? 'MISSING'}`);
    }
  }

  // ── 3. download html ──
  const dlRes = await fetch(
    `${BASE}/api/report/download?projectId=${encodeURIComponent(PROJECT_ID)}&file=Analysis_Report.html`
  );
  const dlBuf = await dlRes.arrayBuffer();
  record('download html → 200 + 字节数一致',
    dlRes.status === 200 && dlBuf.byteLength === (files.find((f) => f.name === 'Analysis_Report.html')?.bytes ?? -1),
    `status=${dlRes.status} bytes=${dlBuf.byteLength}`);
  const head = Buffer.from(dlBuf.slice(0, 64)).toString('utf8').toLowerCase();
  record('download html 头非空且像 HTML',
    dlBuf.byteLength > 0 && (head.includes('<!doctype') || head.includes('<html') || head.includes('<head')),
    head.slice(0, 40).replace(/\s+/g, ' '));

  // ── 4. md 无服务器真实路径 ──
  const mdPath = path.join(localDir, 'Analysis_Report.md');
  const mdText = fs.readFileSync(mdPath, 'utf8');
  const hits = mdText.split(/\r?\n/).filter((line) => line.includes('/mnt/ssd'));
  record('Analysis_Report.md 无 /mnt/ssd 真实路径泄漏', hits.length === 0,
    hits.length === 0 ? `占位符命中 ${mdText.includes('{{DATA_ROOT}}') ? '有 {{DATA_ROOT}}' : '（本报告无该占位符属正常）'}` : `泄漏行: ${hits[0].slice(0, 120)}`);
} catch (cause) {
  record('E2E 流程异常终止', false, cause instanceof Error ? cause.message : String(cause));
} finally {
  child.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[e2e] 结果: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length > 0) {
  console.log('[e2e] 未过项:');
  for (const item of failed) console.log(`  - ${item.name}: ${item.detail}`);
  process.exit(1);
}
process.exit(0);
