/**
 * S26 任务项 6 · E2E 真链验证（真 ssh 到 K40）
 *
 * 验证目标：修复后的 persistEntry（payload 走 ssh stdin + WROTE/bytes 双硬校验）
 * 在真实链路上把大台账完整落盘。手法照 cn_debug/2026-10-19_e2e_run_pipeline.mjs：
 * 真实 HTTP POST /api/tasks/submit → 等 /api/tasks 列表消失 → 读远端 system_logs 台账。
 *
 * 幂等性：每次运行提交新任务（新 taskId/新台账文件名），用提交时刻过滤台账，
 * 不拿旧账充数；临时服务实例用空闲端口，结束即杀，不碰 8787 的常驻实例
 * （常驻实例跑的可能是旧代码，不作为本验证的执行面）。
 *
 * 声明口径：outputs = figures/ 现存 38 张真实图 + 7 个 l2_e2e_pad_XX.png 占位
 * （占位命名透明可辨；scrna_figures 忽略 --output 参数，多声明不影响执行）。
 * 台账 io_files.output 记录的是提交声明，与磁盘清单本来就允许不一致（引擎口径）。
 *
 * 运行：node cn_debug/2026-10-20_verification_s26_ledger_e2e.mjs
 *   （工作台仓库根执行；服务端子进程自行拉起，无需预先启动）
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const REPO = path.resolve(fileURLToPath(import.meta.url), '..', '..', 'BioanalysDesktop');
const PROJECT = 'default';
const LINE = 'line2_scrna';
const STEP = 'scrna_figures';
const SEED = 20261018;
const P = `/mnt/ssd/bio_data/projects/${PROJECT}/${LINE}`;
const SSH = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu'];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function sshOut(cmd, timeout = 60000) {
  const { stdout } = await run('ssh', [...SSH, cmd], { timeout });
  return stdout;
}

async function main() {
  // 0. 自带服务实例（跑当前代码，含 S26 修复），stderr 落盘供 [ledger] 失败行检查
  const PORT = await freePort();
  const BASE = `http://127.0.0.1:${PORT}`;
  const serverLog = path.join(REPO, '..', 'cn_debug', '2026-10-20_s26_e2e_server_stderr.log');
  const serverErr = fs.openSync(serverLog, 'w');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: REPO,
    env: { ...process.env, BAD_PORT: String(PORT) },
    stdio: ['ignore', 'ignore', serverErr],
  });

  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i += 1) {
      try {
        const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
        up = res.ok;
      } catch { await sleep(200); }
    }
    check('临时服务实例就绪（当前代码，非 8787 常驻实例）', up, BASE);

    // 1. 远端前置检查：输入在位
    const inputCheck = await sshOut(`[ -f '${P}/processed/scrna_deg.h5ad' ] && echo EXISTS || echo MISSING`);
    check('远端输入 scrna_deg.h5ad 在位', inputCheck.trim().endsWith('EXISTS'));

    // 2. 组 outputs：figures/ 现存真实图 + 透明占位，共 ≥ 40
    const figureList = (await sshOut(`ls -1 '${P}/figures/' | grep '\\.png$'`))
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const realOutputs = figureList.map((name) => `${P}/figures/${name}`);
    const padOutputs = Array.from({ length: 7 }, (_, i) => `${P}/figures/l2_e2e_pad_${String(i + 1).padStart(2, '0')}.png`);
    const outputs = [...realOutputs, ...padOutputs];
    check('outputs 声明 ≥ 40', outputs.length >= 40, `真实 ${realOutputs.length} 张 + 占位 ${padOutputs.length} = ${outputs.length}`);

    // 3. 提交（真 HTTP 契约）
    const submittedAt = new Date().toISOString();
    const submit = await fetch(`${BASE}/api/tasks/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT, lineId: LINE, step: STEP, inputs: [`${P}/processed/scrna_deg.h5ad`], outputs, seed: SEED }),
    });
    const submitBody = await submit.json();
    check('任务下发', submit.ok, submitBody.taskId || submitBody.error || `HTTP ${submit.status}`);
    if (!submit.ok) return;
    const taskId = submitBody.taskId;

    // 4. 等任务结束（最多 25 分钟）
    const deadline = Date.now() + 25 * 60 * 1000;
    let done = false;
    let exitInfo = null;
    while (Date.now() < deadline) {
      await sleep(3000);
      const ids = await (await fetch(`${BASE}/api/tasks`)).json();
      if (!(ids.tasks || []).some((t) => t.taskId === taskId)) { done = true; break; }
    }
    check('任务结束（25 分钟内）', done);
    if (!done) return;

    // 5. 等台账落盘（persistEntry 在 exit 回调里异步执行，固定 sleep 会误判）
    let ledger = null;
    const ledgerDeadline = Date.now() + 90000;
    while (Date.now() < ledgerDeadline && !ledger) {
      const files = (await sshOut(`ls -t /mnt/ssd/bio_data/system_logs/*${PROJECT}*_${LINE}_${STEP}_*.json 2>/dev/null`))
        .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      for (const file of files) {
        try {
          const raw = await sshOut(`cat '${file}'`);
          const parsed = JSON.parse(raw);
          if (parsed.start_time >= submittedAt) { ledger = { file, raw, parsed }; break; }
        } catch { /* 半截或读不到，继续等 */ }
      }
      if (!ledger) await sleep(2000);
    }
    check('台账文件已落盘且可 JSON.parse（≥40 outputs 条目）', Boolean(ledger), ledger ? ledger.file : '90s 内未找到本次提交的台账');
    if (!ledger) return;

    const entry = ledger.parsed;
    check('io_files.output 长度与声明一致', entry.io_files.output.length === outputs.length,
      `台账 ${entry.io_files.output.length} vs 声明 ${outputs.length}`);
    check('seed 字段 = 20261018', entry.environment.random_seed === SEED, `实际 ${entry.environment.random_seed}`);
    check('line_id / step_name / project_id 一致',
      entry.line_id === LINE && entry.step_name === STEP && entry.project_id === PROJECT,
      `${entry.project_id}/${entry.line_id}/${entry.step_name}`);
    check('status=completed 且 exit_code=0', entry.status === 'completed' && entry.exit_code === 0,
      `status=${entry.status} exit=${entry.exit_code} error=${String(entry.error_log || '').slice(0, 200)}`);

    // 6. WROTE 标记证据：persistEntry 的新契约是「无 WROTE/bytes 不符即 reject」，
    //    台账能完整落盘本身就证明标记校验通过；这里再核服务端 stderr 无 [ledger] 失败行、
    //    并核对远端文件字节数与台账 JSON 一致（完整性的独立旁证）。
    const remoteBytes = (await sshOut(`wc -c < '${ledger.file}'`)).trim();
    check('远端台账字节数与 JSON 长度一致（无半截）', Number(remoteBytes) === Buffer.byteLength(ledger.raw, 'utf8'),
      `remote=${remoteBytes}`);
    const serverErrText = fs.readFileSync(serverLog, 'utf8');
    const ledgerFailLines = serverErrText.split(/\r?\n/).filter((line) => line.includes('[ledger]'));
    check('服务端 stderr 无 [ledger] 落盘失败行（WROTE/bytes 校验未拒绝）', ledgerFailLines.length === 0,
      ledgerFailLines.join(' || ').slice(0, 300));

    // 7. 给自动回搬（exit 后 setImmediate 的 scp）留时间，避免杀进程打断
    await sleep(5000);
    console.log(`\n说明：WROTE 标记由 persistEntry 内部硬校验（缺失/字节数不符即 reject 并写 stderr），`);
    console.log(`台账完整落盘 + stderr 无失败行 = 标记校验通过的运行时证据；unit 侧另有 3 条垫片用例覆盖拒绝分支。`);
  } finally {
    server.kill();
    fs.closeSync(serverErr);
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果：${pass}/${results.length} 通过`);
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((cause) => {
  console.error('脚本异常:', cause.message);
  process.exitCode = 1;
});
