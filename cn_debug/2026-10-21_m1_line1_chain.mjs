/**
 * M1 DoD 取证：line1_bulk 全步骤真机跑批（14 个 LINE_STEPS + cox_analysis）。
 *
 * 机制（ssh 重试、台账快照差集、preflight、产物核对）全部来自
 * cn_debug/lib/chain_runner.mjs；本文件只保留「line1 步骤表 + 结果汇总」。
 *
 * 用法：BAD_PORT=8791 node server/index.js 另起一进程，然后
 *   BASE=http://127.0.0.1:8791 node cn_debug/2026-10-21_m1_line1_chain.mjs
 *   START_INDEX=6 / ONLY_STEP=deg_limma 可断点续跑或单步复跑
 *
 * 历史：2026-10-21 首跑 15/15 exit 0（第九轮）。当时台账定位用 start_time 时间比较，
 * 踩了容器 UTC / 本地 CST 跨时区 + enrichment 误命中 enrichment_figures 两个坑（P-25），
 * 已改为快照差集 + 严格正则；判活不再读 proot etime / loadavg（P-22/P-23/P-24）。
 */
import { runStepHttp, P, PROJECT } from './lib/chain_runner.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const LINE = 'line1_bulk';
const SEED = Number(process.env.SEED || 20261013);
const START = Number(process.env.START_INDEX || 0);
const ONLY = process.env.ONLY_STEP || '';

const results = [];
const warns = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
};
const warn = (name, detail = '') => {
  warns.push({ name, detail });
  console.log(`WARN | ${name}${detail ? ' | ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 逐步 inputs 按母版真实读取的文件名写（不是照抄 line2/line3 的命名）
const STEPS = [
  { step: 'prep_matrix', inputs: [`${P}/raw_data/GSE277173_series_matrix.txt.gz`, `${P}/raw_data/GPL11532-32230.txt`, `${P}/raw_data/grouping.txt`], outputs: ['expr_genes.tsv', 'group_map.tsv', 'prep_report.txt'] },
  { step: 'qc_matrix', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`], outputs: ['qc_report.txt', 'sample_qc.tsv'] },
  { step: 'pca_matrix', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`], outputs: ['pca_scores.tsv', 'pca_report.txt'] },
  { step: 'deg_limma', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`], outputs: ['deg_all.tsv', 'deg_sig.tsv', 'deg_report.txt'] },
  { step: 'wgcna_modules', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`], outputs: ['wgcna_modules.tsv', 'wgcna_module_trait.tsv'] },
  { step: 'enrichment_bulk', inputs: [`${P}/processed/deg_all.tsv`, `${P}/processed/wgcna_modules.tsv`], outputs: ['enrichment_gsea_go.tsv', 'enrichment_kegg.tsv'] },
  { step: 'enrichment_figures', inputs: [`${P}/processed`], outputs: ['l1_13_gsea_top.png', 'l1_14_module_ora_top.png'], outputsDir: 'figures' },
  { step: 'ppi_string', inputs: [`${P}/processed/wgcna_modules.tsv`, `${P}/processed/wgcna_module_trait.tsv`], outputs: ['ppi_edges.tsv', 'ppi_hubs.tsv'] },
  { step: 'key_genes', inputs: [`${P}/processed/deg_all.tsv`, `${P}/processed/wgcna_modules.tsv`, `${P}/processed/wgcna_module_trait.tsv`, `${P}/processed/wgcna_hub_genes.tsv`, `${P}/processed/ppi_hubs.tsv`], outputs: ['key_genes.tsv'] },
  { step: 'ml_model', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`, `${P}/processed/key_genes.tsv`], outputs: ['ml_report.txt'] },
  { step: 'ml_hub_analysis', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`, `${P}/processed/key_genes.tsv`, `${P}/processed/deg_all.tsv`], outputs: ['ml_core_hub_genes.tsv'] },
  { step: 'ml_diagnostics', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`, `${P}/processed/ml_core_hub_genes.tsv`], outputs: ['ml_diagnostics_report.txt'] },
  { step: 'external_validation', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`, `${P}/processed/key_genes.tsv`], outputs: ['external_validation_preds.tsv'] },
  { step: 'cox_analysis', inputs: [`${P}/processed/expr_genes.tsv`, `${P}/processed/group_map.tsv`, `${P}/processed/key_genes.tsv`], outputs: ['cox_report.txt'] },
  { step: 'bulk_figures', inputs: [`${P}/processed`], outputs: ['l1_01_sample_corr.png'], outputsDir: 'figures' },
];

async function main() {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check('工作台在线', health.ok === true, `port=${health.port}`);

  for (let i = START; i < STEPS.length; i += 1) {
    if (ONLY && STEPS[i].step !== ONLY) continue;
    const spec = { ...STEPS[i], index: i, label: `${i + 1}. ${STEPS[i].step}` };
    // 失败重试一次：K40 7.5GB 跑重步骤有 OOM / 容器重启前科（第九轮 ppi_string 就这样过）
    let out = await runStepHttp(spec, { base: BASE, projectId: PROJECT, lineId: LINE, seed: SEED });
    if (!out.ok && !out.skipped) {
      console.log('  失败，20s 后重试一次（容器可能重启过）');
      await sleep(20000);
      out = await runStepHttp(spec, { base: BASE, projectId: PROJECT, lineId: LINE, seed: SEED });
    }
    if (out.skipped) {
      check(`${spec.label} 输入预检`, false, out.detail);
    } else if (out.ok) {
      check(`${spec.label} 结果`, true, out.detail);
    } else {
      check(`${spec.label} 结果`, false, out.detail);
      if (out.ledger && out.ledger.error_log) {
        console.log('    error_log=' + String(out.ledger.error_log).replace(/\n/g, '\n    ').slice(0, 1200));
      }
      console.log('\n中断：该步骤失败，后续步骤依赖其产物，停止下发。');
      break;
    }
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果：${pass}/${results.length} 通过，WARN ${warns.length} 条`);
  for (const row of warns) console.log(`  WARN ${row.name}${row.detail ? ' | ' + row.detail : ''}`);
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((cause) => {
  console.error('脚本异常:', cause.message);
  process.exitCode = 1;
});
