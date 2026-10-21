/**
 * M1 DoD 取证：line1_bulk 全步骤真机跑批（14 个 LINE_STEPS + cox_analysis）。
 *
 * 每步都走真实 HTTP 契约 POST /api/tasks/submit，完成判定靠 /api/tasks 列表消失，
 * 结果判定读远端台账（status / exit_code / error_log）。失败重试一次（容器会重启）。
 *
 * 用法：BAD_PORT=8791 node server/index.js 另起一进程，然后
 *   BASE=http://127.0.0.1:8791 node cn_debug/2026-10-21_m1_line1_chain.mjs
 */

import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const PROJECT = process.env.PROJECT_ID || 'PRJ_E2E_GSE277173';
const LINE = 'line1_bulk';
const SEED = 20261021;
const P = `/mnt/ssd/bio_data/projects/${PROJECT}/${LINE}`;
const START = Number(process.env.START_INDEX || 0);
const ONLY = process.env.ONLY_STEP || '';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ssh(cmd) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'k40-ubuntu', cmd],
    { encoding: 'utf8', timeout: 120000 });
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

async function waitLedger(step, since, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ledger = latestLedger(step);
    if (ledger && (!since || ledger.start_time >= since)) return ledger;
    await sleep(2000);
  }
  return null;
}

const STEPS = [
  { step: 'prep_matrix', inputs: [`${P}/raw_data/GSE277173_series_matrix.txt.gz`, `${P}/raw_data/GPL11532-32230.txt`, `${P}/raw_data/grouping.txt`] },
  { step: 'qc_matrix', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`] },
  { step: 'pca_matrix', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`] },
  { step: 'deg_limma', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`] },
  { step: 'wgcna_modules', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`] },
  { step: 'enrichment_bulk', inputs: [`${P}/processed/deg_all.tsv`, `${P}/processed/wgcna_modules.tsv`] },
  { step: 'enrichment_figures', inputs: [`${P}/processed`] },
  { step: 'ppi_string', inputs: [`${P}/processed/wgcna_modules.tsv`, `${P}/processed/wgcna_module_trait.tsv`] },
  { step: 'key_genes', inputs: [`${P}/processed/deg_all.tsv`, `${P}/processed/wgcna_modules.tsv`, `${P}/processed/wgcna_module_trait.tsv`, `${P}/processed/wgcna_hub_genes.tsv`, `${P}/processed/ppi_hubs.tsv`] },
  { step: 'ml_model', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`, `${P}/processed/key_genes.tsv`] },
  { step: 'ml_hub_analysis', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`, `${P}/processed/key_genes.tsv`, `${P}/processed/deg_all.tsv`] },
  { step: 'ml_diagnostics', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`, `${P}/processed/ml_core_hub_genes.tsv`] },
  { step: 'external_validation', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`, `${P}/processed/key_genes.tsv`] },
  { step: 'cox_analysis', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`, `${P}/processed/key_genes.tsv`] },
  { step: 'bulk_figures', inputs: [`${P}/processed`] },
];

async function runningIds() {
  const res = await fetch(`${BASE}/api/tasks`);
  const body = await res.json();
  return new Set((body.tasks || []).map((t) => t.taskId));
}

async function attempt(spec, index, tryNo) {
  const label = `${index + 1}. ${spec.step}${tryNo > 1 ? ` (retry ${tryNo - 1})` : ''}`;
  const submittedAt = new Date().toISOString();
  const submit = await fetch(`${BASE}/api/tasks/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: PROJECT, lineId: LINE, step: spec.step,
      inputs: spec.inputs, outputs: [], seed: SEED,
    }),
  });
  const payload = await submit.json();
  if (!submit.ok) {
    check(`${label} 下发`, false, payload.error || `HTTP ${submit.status}`);
    return false;
  }
  check(`${label} 下发`, true, payload.taskId);

  const deadline = Date.now() + 30 * 60 * 1000;
  let stillRunning = true;
  while (Date.now() < deadline) {
    await sleep(3000);
    const ids = await runningIds();
    if (!ids.has(payload.taskId)) { stillRunning = false; break; }
  }
  if (stillRunning) {
    check(`${label} 完成`, false, '超时 30 分钟仍在运行');
    return false;
  }

  await sleep(1500);
  const ledger = await waitLedger(spec.step, submittedAt);
  if (!ledger) {
    check(`${label} 台账`, false, '90s 内未找到台账文件');
    return false;
  }
  const ok = ledger.status === 'completed';
  check(`${label} 结果`, ok,
    `status=${ledger.status} exit=${ledger.exit_code} ${ledger.start_time}→${ledger.end_time}`
    + (ok ? '' : `\n    error=${String(ledger.error_log || '').replace(/\n/g, '\n    ').slice(0, 900)}`));
  return ok;
}

async function runStep(spec, index) {
  for (let tryNo = 1; tryNo <= 2; tryNo += 1) {
    if (tryNo > 1) { console.log('  容器可能重启过，20s 后重试一次'); await sleep(20000); }
    if (await attempt(spec, index, tryNo)) return true;
  }
  return false;
}

async function main() {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check('工作台在线', health.ok === true);

  for (let i = START; i < STEPS.length; i += 1) {
    if (ONLY && STEPS[i].step !== ONLY) continue;
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
