/**
 * Milestone 4 Contract Test:
 * 阶段三末尾立即清零时序、阶段四 AI 报告防幻觉核验、全交付包商业脱敏扫描与 Ed25519 签名出库。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { PiJobOrchestrator } from '../server/pi_runner.js';
import { PI_JOB_STATUS, closePiStateDb } from '../server/services/pi_state_store.js';
import { composeStandaloneReport, verifyNarrativeFactCheck } from '../server/services/report_composer.js';
import { packageDeliverables, scanDirectoryForRedactionLeaks } from '../server/services/delivery_packager.js';
import { verifyDelivery } from '../../tools/reporting/ed25519_tools.mjs';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'm4_delivery_'));
const DB_PATH = path.join(TMP_DIR, '.ops_state', 'pi_jobs.sqlite');
const DELIVERABLES_ROOT = path.join(TMP_DIR, 'data', 'workspace', 'deliverables');

// 生成测试用 Ed25519 密钥对
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const PRIV_KEY_PATH = path.join(TMP_DIR, 'ed25519_private.pem');
const PUB_KEY_PATH = path.join(TMP_DIR, 'ed25519_public.pem');
fs.writeFileSync(PRIV_KEY_PATH, privateKey, 'utf8');
fs.writeFileSync(PUB_KEY_PATH, publicKey, 'utf8');

test.after(() => {
  closePiStateDb(DB_PATH);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

test('1. 修正时序：wipe_remote 必须在进入刹车片二 (SUSPENDED_WAITING_FINAL_ACCEPTANCE) 之前完成', async () => {
  const orch = new PiJobOrchestrator({ dbPath: DB_PATH });
  const job = await orch.startFromIntake({
    intake_id: 'sub_m4_1',
    submission_mode: 'geo_accession',
    pipeline: 'line1_bulk',
    requires_external_download: true,
  }, { jobId: 'job_m4_wipe' });

  assert.equal(job.status, PI_JOB_STATUS.SUSPENDED_EXTERNAL);

  // 未清零时显式拒绝进入刹车片二
  assert.throws(
    () => orch.suspendForFinalAcceptance('job_m4_wipe', { verified_sha256: true, remote_wiped: false }),
    /INVALID_STATE_TRANSITION/,
  );

  // 缺少 .verify_passed 时阻断清零
  await assert.rejects(
    () => orch.completeStage3PullAndWipe('job_m4_wipe', {
      verifyPassedTokenPath: path.join(TMP_DIR, 'nonexistent.verify_passed'),
      remoteJobDir: '/workspace/runs/job_m4_wipe',
      wipeExecutor: async () => ({ ok: true }),
    }),
    /STAGE3_WIPE_BLOCKED/,
  );

  // 签发合法 .verify_passed 后，立即触发 wipeExecutor 并进入刹车片二
  const verifyTokenPath = path.join(TMP_DIR, '.verify_passed');
  fs.writeFileSync(verifyTokenPath, 'VERIFIED_AT_2026-11-14T23:20:00Z\n', 'utf8');
  let wipeCalledBeforeSuspend = false;
  const suspended = await orch.completeStage3PullAndWipe('job_m4_wipe', {
    verifyPassedTokenPath: verifyTokenPath,
    remoteJobDir: '/workspace/runs/job_m4_wipe',
    wipeExecutor: async ({ jobId }) => {
      wipeCalledBeforeSuspend = orch.getJob(jobId).status !== PI_JOB_STATUS.SUSPENDED_ACCEPTANCE;
      return { ok: true };
    },
  });

  assert.equal(wipeCalledBeforeSuspend, true, '必须先完成远端清零再进入刹车片二');
  assert.equal(suspended.status, PI_JOB_STATUS.SUSPENDED_ACCEPTANCE);
  assert.equal(suspended.context.compute_facts.remote_wiped, true);
});

test('2. 阶段四防幻觉核验 (Fact-Check Gate) 与单图独立原则', () => {
  const summaryStats = { sample_count: 12, deg_up: 120, deg_down: 85, seed: 2026 };
  const topDegsTsv = 'gene\tlog2FC\tpadj\nTP53\t2.4\t0.012\nHLA-DRA\t-1.8\t0.004\n';

  // 幻觉测试 A：篡改 padj（0.012 -> 0.001）
  assert.throws(
    () => verifyNarrativeFactCheck({
      narrativeText: '本研究发现 TP53 (log2FC=2.4, padj=0.001) 显著上调。',
      summaryStats,
      topDegsTsv,
    }),
    /FACT_CHECK_HALLUCINATION_ABORT/,
  );

  // 幻觉测试 B：编造不存在的基因
  assert.throws(
    () => verifyNarrativeFactCheck({
      narrativeText: '核心基因 FAKE999 显著富集。',
      summaryStats,
      topDegsTsv,
    }),
    /FACT_CHECK_HALLUCINATION_ABORT/,
  );

  // 幻觉测试 C：全局样本数错误
  assert.throws(
    () => verifyNarrativeFactCheck({
      narrativeText: '共纳入样本数 99 例，随机种子 2026。',
      summaryStats,
      topDegsTsv,
    }),
    /FACT_CHECK_HALLUCINATION_ABORT/,
  );

  // 复合大图拦截
  assert.throws(
    () => composeStandaloneReport({
      jobId: 'job_m4_comp',
      narrativeText: '本研究共纳入样本数 12 例，发现 TP53 (log2FC=2.4, padj=0.012) 上调。',
      summaryStats,
      topDegsTsv,
      figures: [{ template_id: 'comp_1', is_composite: true, panel_count: 4 }],
    }),
    /COMPOSITE_FIGURE_FORBIDDEN/,
  );

  // 合法单图报告合成通过
  const composed = composeStandaloneReport({
    jobId: 'job_m4_ok',
    narrativeText: '本研究共纳入样本数 12 例，上调 120 个基因，下调 85 个基因，随机种子 2026。核心基因 TP53 (log2FC=2.4, padj=0.012) 显著升高。',
    summaryStats,
    topDegsTsv,
    figures: [{ producing_mod_id: 'mod_05_volcano', caption: 'Volcano Plot', relative_path: 'figures/volcano.png' }],
  });
  assert.equal(composed.figureCount, 1);
  assert.ok(composed.html.includes('data-mod-id="mod_05_volcano"'));
});

test('3. 全交付包商业脱敏拦截 (REDACTION_LEAK_ABORT) 与 Ed25519 签名出库', () => {
  // 泄露敏感硬件与绝对路径必须被拦截，且不残留 deliverables 目录
  assert.throws(
    () => packageDeliverables({
      jobId: 'job_m4_leak',
      reportHtml: '<html><body>本报告由 D:\\00.AIagent\\scripts 在 K40 proot 端口 10022 运行生成。</body></html>',
      deliverablesRoot: DELIVERABLES_ROOT,
      privateKeyPath: PRIV_KEY_PATH,
      publicKeyPath: PUB_KEY_PATH,
    }),
    /REDACTION_LEAK_ABORT/,
  );
  assert.equal(fs.existsSync(path.join(DELIVERABLES_ROOT, 'job_m4_leak')), false);

  // 准备纯净摘要、图件与故意混入的 01_work 缓存文件（应被剔除）
  const runDir = path.join(TMP_DIR, 'runs', 'job_m4_clean');
  fs.mkdirSync(path.join(runDir, '01_work'), { recursive: true });
  fs.mkdirSync(path.join(runDir, '02_output'), { recursive: true });
  const tempWorkFile = path.join(runDir, '01_work', 'intermediate.tsv');
  const summaryFile = path.join(runDir, '02_output', 'top_degs.tsv');
  const figFile = path.join(runDir, '02_output', 'volcano.png');
  fs.writeFileSync(tempWorkFile, 'tmp\n', 'utf8');
  fs.writeFileSync(summaryFile, 'gene\tlog2FC\tpadj\nTP53\t2.4\t0.012\n', 'utf8');
  fs.writeFileSync(figFile, 'PNG_FAKE_BINARY', 'utf8');

  // 含 base64 图片载荷（即使 base64 随机串内出现 adb/k40 也不应误报）
  const safeHtml = '<html><body><h1>分析解读报告</h1><img src="data:image/png;base64,a240YWRicHJvb3Q=" /><p>核心基因 TP53 显著上调。</p></body></html>';

  const res = packageDeliverables({
    jobId: 'job_m4_clean',
    reportHtml: safeHtml,
    reportMarkdown: '# 分析解读报告\n\n核心基因 TP53 显著上调。\n',
    summaryFiles: [tempWorkFile, summaryFile],
    figureFiles: [figFile],
    deliverablesRoot: DELIVERABLES_ROOT,
    privateKeyPath: PRIV_KEY_PATH,
    publicKeyPath: PUB_KEY_PATH,
    actor: 'dr_wang',
    deliveryGrade: 'EXPLORATORY_DEGRADED',
    adaptationTrace: [{ mod_id: 'l1_de_limma', target: 'params', note: 'BLKR-01' }],
  });

  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(res.receiptPath));
  assert.ok(fs.existsSync(res.checksumsPath));
  assert.ok(fs.existsSync(res.sigPath));
  assert.equal(fs.existsSync(path.join(res.deliverableDir, 'tables', 'intermediate.tsv')), false, '必须剔除 01_work 缓存');
  assert.equal(fs.existsSync(path.join(res.deliverableDir, 'tables', 'top_degs.tsv')), true);

  // 验证脱敏扫描通过与 Ed25519 验签通过
  scanDirectoryForRedactionLeaks(res.deliverableDir);
  const receipt = JSON.parse(fs.readFileSync(res.receiptPath, 'utf8'));
  assert.equal(receipt.redaction_verified, true);
  assert.equal(receipt.delivery_grade, 'EXPLORATORY_DEGRADED');
  assert.deepEqual(receipt.adaptation_trace, [{ mod_id: 'l1_de_limma', target: 'params', note: 'BLKR-01' }]);
  assert.ok(typeof receipt.ed25519_signature === 'string' && receipt.ed25519_signature.length > 20);

  const verifyRes = verifyDelivery(res.deliverableDir, { publicKeyPath: PUB_KEY_PATH });
  assert.equal(verifyRes.ok, true, verifyRes.detail || '');
});
