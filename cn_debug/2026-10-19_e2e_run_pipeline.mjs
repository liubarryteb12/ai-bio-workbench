/**
 * 端到端验证 · 第 3 段：工作台下发 line1_bulk 全链任务，逐步等待并核对台账。
 *
 * 每步都走真实 HTTP 契约 POST /api/tasks/submit，完成判定靠 /api/tasks 列表消失，
 * 结果判定读远端台账（status / exit_code / error_log），不靠"看起来成功"。
 */

import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:8787';
const PROJECT = process.env.PROJECT_ID || 'PRJ_E2E_GSE277173';
const LINE = 'line1_bulk';
const SEED = 20261013;
const P = `/mnt/ssd/bio_data/projects/${PROJECT}/${LINE}`;
// 支持从中间步骤续跑（前几步已通过时不必重跑）
const START = Number(process.env.START_INDEX || 0);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ssh(cmd) {
  return execFileSync('ssh', ['k40-ubuntu', cmd], { encoding: 'utf8', timeout: 120000 });
}

function latestLedger(step) {
  try {
    const out = ssh(`ls -t /mnt/ssd/bio_data/system_logs/*${PROJECT}*_${step}_*.json 2>/dev/null | head -1`);
    const file = out.trim().split('\n')[0];
    if (!file) return null;
    const raw = ssh(`cat '${file}'`);
    return { file, ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

/**
 * 等台账落盘。任务退出与台账写入是两件事：persistEntry 在 exit 回调里异步执行，
 * WGCNA 这类产物大的步骤落盘可能慢于 1.5s。固定 sleep 会误判"未找到台账"。
 *
 * since：只认本次提交之后的台账（重跑同一步时不能拿旧账当结果）。
 */
async function waitLedger(step, since, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ledger = latestLedger(step);
    if (ledger && (!since || ledger.start_time >= since)) return ledger;
    await sleep(2000);
  }
  return null;
}

const STEPS = [
  {
    step: 'prep_matrix',
    inputs: [
      `${P}/raw_data/GSE277173_series_matrix.txt.gz`,
      `${P}/raw_data/GPL11532-32230.txt`,
      `${P}/raw_data/grouping.txt`,
    ],
  },
  { step: 'qc_matrix', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`] },
  { step: 'pca_matrix', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`] },
  { step: 'deg_limma', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`] },
  { step: 'wgcna_modules',
    inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`],
    outputs: [
      `${P}/processed/wgcna_modules.tsv`,
      `${P}/processed/wgcna_module_trait.tsv`,
      `${P}/processed/wgcna_gene_traits.tsv`,
      `${P}/processed/wgcna_hub_genes.tsv`,
      `${P}/processed/wgcna_module_eigengenes.tsv`,
      `${P}/processed/wgcna_sample_outliers.txt`,
      `${P}/processed/wgcna_input_genes.txt`,
      `${P}/processed/wgcna_report.txt`,
      `${P}/figures/l1_28_wgcna_softpower.png`,
      `${P}/figures/l1_29_wgcna_module_trait.png`,
      `${P}/figures/l1_30_wgcna_sample_tree.png`,
      `${P}/figures/l1_31_wgcna_mm_gs.png`,
    ] },
  { step: 'enrichment_bulk', inputs: [`${P}/processed/deg_all.tsv`, `${P}/processed/wgcna_modules.tsv`] },
  { step: 'enrichment_figures', inputs: [`${P}/processed`] },
  { step: 'ppi_string', inputs: [`${P}/processed/wgcna_modules.tsv`] },
  {
    step: 'key_genes',
    inputs: [
      `${P}/processed/deg_all.tsv`,
      `${P}/processed/wgcna_modules.tsv`,
      `${P}/processed/wgcna_module_trait.tsv`,
      `${P}/processed/wgcna_hub_genes.tsv`,
      `${P}/processed/ppi_hubs.tsv`,
    ],
  },
  {
    step: 'ml_hub_analysis',
    inputs: [
      `${P}/processed/expr_genes.tsv`,
      `${P}/processed/group_map.tsv`,
      `${P}/processed/key_genes.tsv`,
      `${P}/processed/deg_all.tsv`,
    ],
  },
  { step: 'bulk_figures', inputs: [`${P}/processed`] },
];

async function runningIds() {
  const res = await fetch(`${BASE}/api/tasks`);
  const body = await res.json();
  return new Set((body.tasks || []).map((t) => t.taskId));
}

async function runStep(spec, index) {
  const label = `${index + 1}. ${spec.step}`;
  const submittedAt = new Date().toISOString();
  const submit = await fetch(`${BASE}/api/tasks/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: PROJECT, lineId: LINE, step: spec.step,
      inputs: spec.inputs, outputs: spec.outputs || [], seed: SEED,
    }),
  });
  const payload = await submit.json();
  if (!submit.ok) {
    check(`${label} 下发`, false, payload.error || `HTTP ${submit.status}`);
    return false;
  }
  check(`${label} 下发`, true, payload.taskId);

  const deadline = Date.now() + 25 * 60 * 1000;
  let stillRunning = true;
  while (Date.now() < deadline) {
    await sleep(3000);
    const ids = await runningIds();
    if (!ids.has(payload.taskId)) { stillRunning = false; break; }
  }
  if (stillRunning) {
    check(`${label} 完成`, false, '超时 25 分钟仍在运行');
    return false;
  }

  await sleep(1500);
  const ledger = await waitLedger(spec.step, submittedAt);
  if (!ledger) {
    check(`${label} 台账`, false, '60s 内未找到台账文件');
    return false;
  }
  const ok = ledger.status === 'completed';
  check(`${label} 结果`, ok,
    `status=${ledger.status} exit=${ledger.exit_code} 耗时=${ledger.start_time}→${ledger.end_time}`
    + (ok ? '' : `\n    error=${String(ledger.error_log || '').replace(/\n/g, '\n    ').slice(0, 800)}`));
  return ok;
}

async function main() {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check('工作台在线', health.ok === true);

  for (let i = START; i < STEPS.length; i += 1) {
    const ok = await runStep(STEPS[i], i);
    if (!ok) {
      console.log('\n中断：该步骤失败，后续步骤依赖其产物，停止下发。');
      break;
    }
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果：${pass}/${results.length} 通过`);
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((cause) => {
  console.error('脚本异常:', cause.message);
  process.exitCode = 1;
});
