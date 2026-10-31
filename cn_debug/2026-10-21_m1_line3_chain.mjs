/**
 * M1 DoD 取证：line3_spatial 全 17 步真机跑批（P15 切片）。
 *
 * 机制（ssh 重试 + 滤 Warning 行、台账快照差集 + 严格正则二次过滤、preflight、
 * 产物核对、失败重试）全部来自 cn_debug/lib/chain_runner.mjs；本文件只保留
 * 「line3 步骤表 + 结果汇总」。
 *
 * line3 与 line1 的差异集中在数据形态：物种后缀 _mouse / _human 成对出现，
 * 母版要求两物种输入都给；坐标口径逐样本（坑 #114）。
 *
 * 用法（先另起一个工作台进程，别占用 8787）：
 *   cd BioanalysDesktop; $env:BAD_PORT='8791'; node server/index.js
 *   BASE=http://127.0.0.1:8791 node cn_debug/2026-10-21_m1_line3_chain.mjs
 *
 * 断点续跑与单步复跑：
 *   START_INDEX=5 ...       从第 6 步（0 基）开始
 *   ONLY_STEP=spatial_domains ...  只跑这一步
 *   SKIP_PREFLIGHT=1 ...    跳过输入存在性预检（默认开，缺文件不下发）
 *   KO_GENE=... ...         空间虚拟敲除的靶基因（默认 Spp1，与母版硬编码兜底一致）
 */
import { runStepHttp, PROJECT, REMOTE_ROOT } from './lib/chain_runner.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const LINE = 'line3_spatial';
const P = `${REMOTE_ROOT}/projects/${PROJECT}/${LINE}`;
const SEED = Number(process.env.SEED || 20261013);
const START = Number(process.env.START_INDEX || 0);
const ONLY = process.env.ONLY_STEP || '';
const SKIP_PREFLIGHT = process.env.SKIP_PREFLIGHT === '1';
const KO_GENE = process.env.KO_GENE || 'Spp1';

const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;

const results = [];
const warns = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
};
const warn = (name, detail = '') => {
  warns.push({ name, detail });
  console.log('WARN | ' + name + (detail ? ' | ' + detail : ''));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 每步的输入（按母版真实读取文件名，物种成对）与预期主产物 */
const STEPS = [
  {
    step: 'ingest_spatial', timeoutMs: 90 * 60 * 1000,
    inputs: [P + '/raw_data/GSE192741_RAW.tar', P + '/raw_data/GPL24247_family.soft.gz', P + '/raw_data/GPL24676_family.soft.gz', P + '/raw_data/grouping.txt'],
    outputs: ['spatial_counts_mouse.h5ad', 'spatial_counts_human.h5ad', 'samples_meta.tsv', 'ingest_report.txt'],
  },
  {
    step: 'qc_spots',
    inputs: [P + '/processed/spatial_counts_mouse.h5ad', P + '/processed/spatial_counts_human.h5ad'],
    outputs: ['spatial_qc_mouse.h5ad', 'spatial_qc_human.h5ad', 'spot_qc_metrics.tsv', 'qc_report.txt'],
  },
  {
    step: 'normalize_hvg',
    inputs: [P + '/processed/spatial_qc_mouse.h5ad', P + '/processed/spatial_qc_human.h5ad'],
    outputs: ['spatial_norm_mouse.h5ad', 'spatial_norm_human.h5ad', 'hvg_genes_mouse.tsv', 'hvg_genes_human.tsv'],
  },
  {
    step: 'dim_reduce',
    inputs: [P + '/processed/spatial_norm_mouse.h5ad', P + '/processed/spatial_norm_human.h5ad'],
    outputs: ['spatial_dimred_mouse.h5ad', 'spatial_dimred_human.h5ad', 'dimred_report.txt'],
  },
  {
    step: 'spatial_domains',
    inputs: [P + '/processed/spatial_dimred_mouse.h5ad', P + '/processed/spatial_dimred_human.h5ad'],
    outputs: ['spatial_domains_mouse.h5ad', 'spatial_domains_human.h5ad', 'domains_report.txt'],
  },
  {
    step: 'spatial_markers',
    inputs: [P + '/processed/spatial_domains_mouse.h5ad', P + '/processed/spatial_domains_human.h5ad'],
    outputs: ['spatial_marker_mouse.h5ad', 'spatial_marker_human.h5ad', 'domain_markers_mouse.tsv', 'domain_markers_human.tsv'],
  },
  {
    step: 'spatial_autocorr',
    inputs: [P + '/processed/spatial_marker_mouse.h5ad', P + '/processed/spatial_marker_human.h5ad'],
    outputs: ['spatial_autocorr_mouse.h5ad', 'spatial_autocorr_human.h5ad', 'gene_autocorr_mouse.tsv', 'gene_autocorr_human.tsv'],
  },
  {
    step: 'spatial_cooccurrence',
    inputs: [P + '/processed/spatial_autocorr_mouse.h5ad', P + '/processed/spatial_autocorr_human.h5ad'],
    outputs: ['spatial_cooccurrence_mouse.h5ad', 'spatial_cooccurrence_human.h5ad', 'domain_cooccurrence_mouse.tsv', 'domain_cooccurrence_human.tsv'],
  },
  {
    step: 'spatial_composition',
    inputs: [P + '/processed/spatial_cooccurrence_mouse.h5ad', P + '/processed/spatial_cooccurrence_human.h5ad'],
    outputs: ['spatial_composition_mouse.h5ad', 'spatial_composition_human.h5ad', 'sample_composition_mouse.tsv', 'sample_composition_human.tsv'],
  },
  {
    step: 'spatial_communication', timeoutMs: 60 * 60 * 1000,
    inputs: [P + '/processed/spatial_composition_mouse.h5ad', P + '/processed/spatial_composition_human.h5ad'],
    outputs: ['spatial_communication_mouse.h5ad', 'spatial_communication_human.h5ad', 'sample_communication_mouse.tsv', 'sample_communication_human.tsv'],
  },
  {
    step: 'celltype_annotation',
    // 母版读 h5ad + tsv 两套（h5ad 取 uns 里的全量 marker，tsv 取 top20），两者都要给
    inputs: [P + '/processed/spatial_marker_mouse.h5ad', P + '/processed/spatial_marker_human.h5ad', P + '/processed/domain_markers_mouse.tsv', P + '/processed/domain_markers_human.tsv'],
    outputs: ['celltype_scores_mouse.tsv', 'celltype_scores_human.tsv', 'celltype_annotation_mouse.tsv', 'celltype_annotation_human.tsv'],
  },
  {
    step: 'spatial_localization',
    inputs: [P + '/processed/spatial_communication_mouse.h5ad', P + '/processed/spatial_communication_human.h5ad'],
    outputs: ['spatial_localization_mouse.h5ad', 'spatial_localization_human.h5ad', 'gene_localization_mouse.tsv', 'gene_localization_human.tsv'],
  },
  {
    step: 'spatial_knockout', timeoutMs: 90 * 60 * 1000, needsKoGene: true,
    inputs: [P + '/processed/spatial_localization_mouse.h5ad', P + '/processed/spatial_localization_human.h5ad'],
    outputs: ['spatial_knockout_mouse.h5ad', 'spatial_knockout_human.h5ad', 'ko_dr_genes_mouse.tsv', 'ko_dr_genes_human.tsv'],
  },
  {
    step: 'dr_post_analysis',
    inputs: [P + '/processed/spatial_knockout_mouse.h5ad', P + '/processed/spatial_knockout_human.h5ad', P + '/processed/ko_dr_genes_mouse.tsv', P + '/processed/ko_dr_genes_human.tsv', P + '/processed/domain_markers_mouse.tsv', P + '/processed/domain_markers_human.tsv'],
    outputs: ['dr_enrichment_mouse.tsv', 'dr_enrichment_human.tsv', 'dr_overlap_mouse.tsv', 'dr_overlap_human.tsv'],
  },
  {
    step: 'enrichment', timeoutMs: 60 * 60 * 1000,
    // 母版读 h5ad 里的全量 marker（tsv 只有 top20，不够做 ORA/GSEA）
    inputs: [P + '/processed/spatial_marker_mouse.h5ad', P + '/processed/spatial_marker_human.h5ad'],
    outputs: ['enrichment_ora_mouse.tsv', 'enrichment_ora_human.tsv', 'enrichment_gsea_mouse.tsv', 'enrichment_gsea_human.tsv'],
  },
  {
    step: 'enrichment_figures',
    inputs: [P + '/processed/enrichment_ora_mouse.tsv', P + '/processed/enrichment_ora_human.tsv', P + '/processed/enrichment_gsea_mouse.tsv', P + '/processed/enrichment_gsea_human.tsv'],
    outputs: ['l3_mouse_12_ora_top.png', 'l3_human_12_ora_top.png'], outputsDir: 'figures',
  },
  {
    step: 'spatial_figures',
    inputs: [P + '/processed/spatial_knockout_mouse.h5ad', P + '/processed/spatial_knockout_human.h5ad'],
    outputs: ['figures_manifest.txt'], outputsDir: 'figures', strictOutputs: true,
  },
];

async function main() {
  console.log('line3_spatial 全链取证 | 项目=' + PROJECT + ' 线=' + LINE + ' 种子=' + SEED + ' 工作台=' + BASE);
  console.log('步骤数=' + STEPS.length + ' 起始索引=' + START + (ONLY ? ' 仅跑=' + ONLY : '') + (SKIP_PREFLIGHT ? ' 预检=跳过' : ' 预检=开'));
  if (STEPS.some((spec) => spec.needsKoGene)) {
    console.log('空间虚拟敲除靶基因（提交层字段）=' + KO_GENE);
  }

  const health = await (await fetch(`${BASE}/api/health`)).json();
  check('工作台在线', health.ok === true, 'HTTP ' + health.status);

  for (let i = START; i < STEPS.length; i += 1) {
    if (ONLY && STEPS[i].step !== ONLY) continue;
    const spec = {
      ...STEPS[i],
      index: i,
      timeoutMs: STEPS[i].timeoutMs || DEFAULT_TIMEOUT_MS,
      label: `${i + 1}. ${STEPS[i].step}`,
      strictOutputs: STEPS[i].strictOutputs !== false,
    };
    let out = await runStepHttp(spec, { base: BASE, projectId: PROJECT, lineId: LINE, seed: SEED, koGene: KO_GENE, skipPreflight: SKIP_PREFLIGHT });
    if (!out.ok && !out.skipped) {
      console.log('  失败，20s 后重试一次（K40 7.5GB 跑重步骤有 OOM 前科）');
      await sleep(20000);
      out = await runStepHttp(spec, { base: BASE, projectId: PROJECT, lineId: LINE, seed: SEED, koGene: KO_GENE, skipPreflight: SKIP_PREFLIGHT });
    }
    if (out.skipped) {
      check(`${spec.label} 输入预检`, false, out.detail);
      continue;
    }
    if (out.ok) {
      check(`${spec.label} 结果`, true, out.detail);
      continue;
    }
    check(`${spec.label} 结果`, false, out.detail);
    if (out.ledger && out.ledger.error_log) {
      console.log('    error_log=' + String(out.ledger.error_log).replace(/\n/g, '\n    ').slice(0, 1200));
    }
    console.log('\n中断：该步骤失败，后续步骤依赖其产物，停止下发。');
    break;
  }

  const pass = results.filter((row) => row.ok).length;
  console.log('\n结果：' + pass + '/' + results.length + ' 通过，WARN ' + warns.length + ' 条');
  for (const row of warns) console.log('  WARN ' + row.name + (row.detail ? ' | ' + row.detail : ''));
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((cause) => {
  console.error('脚本异常:', cause && cause.message ? cause.message : cause);
  process.exitCode = 1;
});
