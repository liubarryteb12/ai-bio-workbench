/**
 * Milestone 3 Contract Test:
 * Pi Agent RPC 无状态调度、SQLite .ops_state 双人工刹车片挂起恢复、Stage 4 Token 防幻觉边界与 SSE 流。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  PiJobOrchestrator,
  runPiRpc,
  loadLightweightReportSummaries,
  loadReadyFigureTemplateIds,
} from '../server/pi_runner.js';
import { PI_JOB_STATUS, closePiStateDb } from '../server/services/pi_state_store.js';
import { handlePiOrchestratorRoutes } from '../server/routes/pi_orchestrator.routes.js';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'm3_pi_rpc_'));
const DB_PATH = path.join(TMP_DIR, '.ops_state', 'pi_jobs.sqlite');
const MOCK_PI_BIN = path.join(TMP_DIR, 'mock_pi.mjs');

// 创建模拟 Pi CLI：校验必须收到 --mode rpc --no-session，并从 stdin 读取 prompt 输出 JSONL 事件
fs.writeFileSync(MOCK_PI_BIN, `
import fs from 'node:fs';
const args = process.argv.slice(2);
if (!args.includes('--mode') || !args.includes('rpc') || !args.includes('--no-session')) {
  console.error('MISSING_RPC_OR_NO_SESSION_FLAGS: ' + args.join(' '));
  process.exit(2);
}
const buffer = Buffer.alloc(65536);
const read = fs.readSync(0, buffer, 0, buffer.length, null);
const input = buffer.slice(0, read).toString('utf8').trim();
const req = JSON.parse(input.split(/\\r?\\n/)[0]);
console.log(JSON.stringify({ type: 'turn_start', stage: req.stage }));
const payload = JSON.stringify({ action: 'finish_stage', output: { text: 'OK:' + req.stage + ':' + req.job_id } });
console.log(JSON.stringify({ type: 'assistant_message', text: payload }));
console.log(JSON.stringify({ type: 'agent_end', ok: true }));
console.log(JSON.stringify({ type: 'agent_settled' }));
`, 'utf8');

test.after(() => {
  closePiStateDb(DB_PATH);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

test('1. runPiRpc 强制携带 --mode rpc --no-session 并解析 JSONL 事件流', async () => {
  const seen = [];
  const res = await runPiRpc({
    jobId: 'job_rpc_1',
    stage: 'STAGE_3_COMPUTE_PULL',
    prompt: 'test prompt',
    piBin: MOCK_PI_BIN,
    onEvent: (ev) => seen.push(ev),
  });
  assert.equal(res.ok, true, res.error || '');
  assert.equal(res.exitCode, 0);
  assert.equal(seen.length, 4);
  assert.equal(JSON.parse(res.finalText).output.text, 'OK:STAGE_3_COMPUTE_PULL:job_rpc_1');
});

test('2. 人工刹车片一：requires_external_download=true 立刻挂起于 SQLite 且不启动常驻进程，批准后无状态恢复', async () => {
  const orch = new PiJobOrchestrator({ dbPath: DB_PATH, piBin: MOCK_PI_BIN });

  const job = await orch.startFromIntake({
    intake_id: 'sub_geo_1',
    submission_mode: 'geo_accession',
    pipeline: 'line1_bulk',
    requires_external_download: true,
    facts: { gse: 'GSE277173', gpl: 'GPL570' },
  }, { jobId: 'job_chk1' });

  assert.equal(job.status, PI_JOB_STATUS.SUSPENDED_EXTERNAL);
  assert.ok(fs.existsSync(DB_PATH), 'SQLite .ops_state/pi_jobs.sqlite 必须落盘');

  // 非法跳级验收应被拒绝
  await assert.rejects(
    () => orch.approveFinalAcceptance('job_chk1', 'admin'),
    /INVALID_STATE_TRANSITION/,
  );

  // 人工批准外源下载：宿主读 SQLite 上下文并重新发起 --mode rpc --no-session
  const resumed = await orch.approveExternalDownload('job_chk1', 'dr_wang');
  assert.equal(resumed.approved_by, 'dr_wang');
  assert.equal(resumed.status, PI_JOB_STATUS.RUNNING);
  assert.equal(resumed.context.STAGE_2_EXTERNAL_FETCH_output.text, 'OK:STAGE_2_EXTERNAL_FETCH:job_chk1');
});

test('3. 人工刹车片二 & Stage 4 Token 防幻觉边界：拒绝原始矩阵/图像，放行轻量统计摘要并动态读模板 ID', async () => {
  const orch = new PiJobOrchestrator({ dbPath: DB_PATH, piBin: MOCK_PI_BIN });

  // 挂起到人工刹车片二
  const suspended = orch.suspendForFinalAcceptance('job_chk1', { verified_sha256: true });
  assert.equal(suspended.status, PI_JOB_STATUS.SUSPENDED_ACCEPTANCE);

  // 越界注入 .h5ad / .png 必须抛出 TOKEN_BOUNDARY_VIOLATION
  const badMatrix = path.join(TMP_DIR, 'adata.h5ad');
  fs.writeFileSync(badMatrix, 'binary', 'utf8');
  assert.throws(
    () => loadLightweightReportSummaries({ matrix: badMatrix }),
    /TOKEN_BOUNDARY_VIOLATION/,
  );

  const badImg = path.join(TMP_DIR, 'volcano.png');
  fs.writeFileSync(badImg, 'pngdata', 'utf8');
  assert.throws(
    () => loadLightweightReportSummaries({ fig: badImg }),
    /TOKEN_BOUNDARY_VIOLATION/,
  );

  // 准备合法轻量摘要
  const statsPath = path.join(TMP_DIR, 'summary_stats.json');
  const degPath = path.join(TMP_DIR, 'top_degs.tsv');
  fs.writeFileSync(statsPath, JSON.stringify({ deg_up: 120, deg_down: 85 }), 'utf8');
  fs.writeFileSync(degPath, 'gene\tlog2FC\tpadj\nTP53\t2.4\t1e-6\n', 'utf8');

  const completed = await orch.approveFinalAcceptance('job_chk1', 'dr_wang', {
    summaryPaths: { summary_stats: statsPath, top_degs: degPath },
  });

  assert.equal(completed.status, PI_JOB_STATUS.COMPLETED);
  assert.equal(completed.context.STAGE_4_REPORT_DELIVERY_output.text, 'OK:STAGE_4_REPORT_DELIVERY:job_chk1');
  assert.ok(Array.isArray(completed.context.figure_template_ids));
  const dynamicTemplates = loadReadyFigureTemplateIds();
  assert.deepEqual(completed.context.figure_template_ids, dynamicTemplates);
});

test('4. HTTP 路由与 SSE 实时事件流集成校验', async () => {
  const orch = new PiJobOrchestrator({ dbPath: DB_PATH, piBin: MOCK_PI_BIN });
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const handled = await handlePiOrchestratorRoutes(req, res, url, { json, piOrchestrator: orch });
    if (!handled) json(res, 404, { error: 'not found' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const listRes = await fetch(`${base}/api/pi/jobs`);
    const listBody = await listRes.json();
    assert.equal(listRes.status, 200);
    assert.ok(listBody.jobs.some((j) => j.job_id === 'job_chk1'));

    // SSE 历史事件回放测试
    const sseController = new AbortController();
    const sseRes = await fetch(`${base}/api/pi/jobs/job_chk1/events`, { signal: sseController.signal });
    assert.equal(sseRes.status, 200);
    assert.match(sseRes.headers.get('content-type'), /text\/event-stream/);
    const reader = sseRes.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.ok(text.includes('event: checkpoint_suspend'));
    sseController.abort();
  } finally {
    server.close();
  }
});
