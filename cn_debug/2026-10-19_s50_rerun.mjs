/**
 * S5-00 重跑驱动：源级图例外置修复后，按 seed=20261013 经真实 HTTP 契约
 * POST /api/tasks/submit 重跑受影响的 5 个 line1_bulk 步骤，判完成靠
 * /api/tasks 列表消失 + 远端台账（status / exit_code / checkpoint_status / error_log）。
 *
 * 与 2026-10-19_e2e_run_pipeline.mjs 的差别：
 *   1) 只跑 S5-00 涉及的五步，且步骤顺序与派发单一致；
 *   2) outputs 按各步骤实际产物逐个声明（不声明则不校验产物完整性）；
 *   3) 额外打印 checkpoint_status、error_log 长度、io_files.output 长度（派发单 A3）。
 *
 * 用法：node cn_debug/2026-10-19_s50_rerun.mjs
 */
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:8787';
const PROJECT = process.env.PROJECT_ID || 'PRJ_E2E_GSE277173';
const LINE = 'line1_bulk';
const SEED = 20261013;
const P = `/mnt/ssd/bio_data/projects/${PROJECT}/${LINE}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ssh(cmd) {
  return execFileSync('ssh', ['k40-ubuntu', cmd], { encoding: 'utf8', timeout: 120000 });
}

function latestLedger(step) {
  try {
    const out = ssh(`ls -t /mnt/ssd/bio_data/system_logs/*${PROJECT}*_${step}_*.json 2>/dev/null | head -1`);
    const file = out.trim().split('\n')[0];
    if (!file) return null;
    return { file, ...JSON.parse(ssh(`cat '${file}'`)) };
  } catch {
    return null;
  }
}

async function waitLedger(step, since, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ledger = latestLedger(step);
    if (ledger && (!since || ledger.start_time >= since)) return ledger;
    await sleep(2000);
  }
  return null;
}

async function runningIds() {
  const res = await fetch(`${BASE}/api/tasks`);
  const body = await res.json();
  return new Set((body.tasks || []).map((t) => t.taskId));
}

const FIG = (n) => `${P}/figures/${n}`;
const PRC = (n) => `${P}/processed/${n}`;

const STEPS = [
  {
    step: 'bulk_figures',
    inputs: [`${P}/processed`],
    outputs: [
      FIG('l1_01_correlation.png'), FIG('l1_02_pca.png'), FIG('l1_03_volcano_fdr.png'),
      FIG('l1_03_volcano_nominal.png'), FIG('l1_04_topvar_heatmap.png'),
      FIG('l1_05a_genes_detected.png'), FIG('l1_05b_within_group_cor.png'),
      FIG('l1_06_ma_fdr.png'), FIG('l1_06_ma_nominal.png'),
    ],
  },
  {
    step: 'enrichment_figures',
    inputs: [`${P}/processed`],
    outputs: [
      FIG('l1_13_gsea_top.png'), FIG('l1_14_module_ora_top.png'),
      FIG('l1_15_kegg_top.png'), FIG('l1_25_kegg_gsea_top.png'),
    ],
  },
  {
    step: 'ml_hub_analysis',
    inputs: [
      PRC('expr_genes.tsv'), PRC('group_map.tsv'), PRC('key_genes.tsv'), PRC('deg_all.tsv'),
    ],
    outputs: [
      FIG('l1_16_lasso_path.png'), FIG('l1_17_lasso_cv.png'), FIG('l1_18_rfe_curve.png'),
      FIG('l1_19_univariate.png'), FIG('l1_20_hub_overlap.png'), FIG('l1_21_importance.png'),
      FIG('l1_22_shap.png'), FIG('l1_23_cluster_heatmap.png'), FIG('l1_24_corr_network.png'),
      FIG('l1_26_shap_waterfall.png'), PRC('ml_hub_report.txt'),
    ],
  },
  {
    step: 'ml_model',
    inputs: [
      PRC('expr_genes.tsv'), PRC('group_map.tsv'), PRC('key_genes.tsv'), PRC('deg_all.tsv'),
    ],
    outputs: [
      FIG('l1_10_ml_roc.png'), FIG('l1_11_ml_importance.png'),
      PRC('ml_feature_importance.tsv'), PRC('ml_report.txt'),
    ],
  },
  {
    step: 'external_validation',
    inputs: [PRC('expr_genes.tsv'), PRC('group_map.tsv'), PRC('key_genes.tsv')],
    outputs: [
      FIG('l1_12_external_roc.png'), PRC('external_validation_preds.tsv'),
      PRC('external_frozen_coefs.tsv'), PRC('external_validation_report.txt'),
    ],
  },
];

const summary = [];

async function runStep(spec, index) {
  const label = `${index + 1}. ${spec.step}`;
  const submittedAt = new Date().toISOString();
  const submit = await fetch(`${BASE}/api/tasks/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: PROJECT, lineId: LINE, step: spec.step,
      inputs: spec.inputs, outputs: spec.outputs, seed: SEED,
    }),
  });
  const payload = await submit.json();
  if (!submit.ok) {
    console.log(`FAIL | ${label} 下发 | ${payload.error || `HTTP ${submit.status}`}`);
    summary.push({ step: spec.step, ok: false, note: payload.error || `HTTP ${submit.status}` });
    return false;
  }
  console.log(`PASS | ${label} 下发 | taskId=${payload.taskId}`);

  const deadline = Date.now() + 25 * 60 * 1000;
  let stillRunning = true;
  while (Date.now() < deadline) {
    await sleep(3000);
    const ids = await runningIds();
    if (!ids.has(payload.taskId)) { stillRunning = false; break; }
  }
  if (stillRunning) {
    console.log(`FAIL | ${label} 完成 | 超时 25 分钟仍在运行`);
    summary.push({ step: spec.step, ok: false, note: 'timeout' });
    return false;
  }

  await sleep(1500);
  const ledger = await waitLedger(spec.step, submittedAt);
  if (!ledger) {
    console.log(`FAIL | ${label} 台账 | 60s 内未找到台账`);
    summary.push({ step: spec.step, ok: false, note: 'no ledger' });
    return false;
  }
  const errLen = String(ledger.error_log || '').length;
  const outLen = Array.isArray(ledger.io_files?.output) ? ledger.io_files.output.length : -1;
  const ok = ledger.status === 'completed' && ledger.exit_code === 0;
  console.log(`      ledger=${ledger.file.split('/').pop()}`);
  console.log(`      status=${ledger.status} exit_code=${ledger.exit_code}`
    + ` checkpoint_status=${ledger.checkpoint_status}`
    + ` error_log.len=${errLen} io_files.output.len=${outLen}`
    + ` start=${ledger.start_time} end=${ledger.end_time}`);
  if (errLen) console.log(`      error_log=${String(ledger.error_log).replace(/\n/g, ' | ').slice(0, 400)}`);
  summary.push({ step: spec.step, ok, ledger: ledger.file.split('/').pop(), status: ledger.status,
    exit: ledger.exit_code, checkpoint: ledger.checkpoint_status, errLen, outLen });
  return ok;
}

async function main() {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  console.log(`health.ok=${health.ok}`);
  // ONLY=step1,step2 只跑指定步骤（单步复核用；不设则按 STEPS 全序跑）
  const only = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
  const queue = only.length ? STEPS.filter((s) => only.includes(s.step)) : STEPS;
  for (let i = 0; i < queue.length; i += 1) {
    const ok = await runStep(queue[i], i);
    if (!ok) {
      console.log('\n中断：该步骤失败，停止下发后续步骤。');
      break;
    }
  }
  const pass = summary.filter((s) => s.ok).length;
  console.log(`\n结果：${pass}/${summary.length} 通过`);
  process.exitCode = pass === summary.length && summary.length === queue.length ? 0 : 1;
}

main().catch((cause) => {
  console.error('脚本异常:', cause.message);
  process.exitCode = 1;
});
