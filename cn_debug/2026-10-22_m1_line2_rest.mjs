/**
 * line2 全链真机取证（剩余步骤：scenic_tf 起 9 步，全链 index 13..21）。
 *
 * 机制全部来自 cn_debug/lib/chain_runner.mjs（ssh / 台账快照差集 / preflight /
 * 产物核对 / setsid nohup 下发）。本文件只保留「步骤表 + 日志格式 + 结果落盘」。
 *
 * 用法：
 *   PROJECT_ID=default SEED=20261021 KO_GENE=TNF \
 *     node cn_debug/2026-10-22_m1_line2_rest.mjs            # 跑剩余全部
 *   ONLY_STEP=scenic_tf ... node cn_debug/2026-10-22_m1_line2_rest.mjs
 *   START_INDEX=16 ...    从第 4 条（全链 index）开始
 * 产物：cn_debug/2026-10-22_m1_line2_rest.result.md
 *
 * 2026-10-23 注意：PRJ_E2E_SCRNA 已被用户确认废弃并归档到
 * projects/_archive/PRJ_E2E_SCRNA_deprecated_20261023，默认项目已改为 default
 * （default 项目 line2 全链 59 个产物早已跑通，无需重跑）。
 */
import { writeFileSync } from 'node:fs';
import {
  LINE, PROJECT, SEED, KO_GENE, REMOTE_ROOT, P,
  ledgerWaitMsForStep, runStepDetached, renderTable,
} from './lib/chain_runner.mjs';

const OUT = process.cwd() + '/cn_debug/2026-10-22_m1_line2_rest.result.md';
const lines = [];
function say(tag, msg) { const l = `${tag} | ${msg}`; console.log(l); lines.push(l); }
const log = (tag, label, detail) => say(tag, `${label} | ${detail}`);

// 剩余 9 步（全链 index 13..21）——inputs 与 line2 母版真实读取一致。
// ledgerWaitMs 按步骤分档（P-27）：scenic_tf / virtual_knockout 固定 40 分钟，
// 其余慢收尾步骤保留分钟档，固定 180s 必然假失败。
const STEPS = [
  { idx: 13, step: 'scenic_tf', ledgerWaitMs: ledgerWaitMsForStep('scenic_tf'), inputs: [`${P}/processed/scrna_annotated.h5ad`, `${P}/processed/scrna_norm.h5ad`] },
  { idx: 14, step: 'scenic_figures', ledgerWaitMs: 1200000, inputs: [`${P}/processed/scrna_scenic.h5ad`] },
  { idx: 15, step: 'tf_activity', ledgerWaitMs: 1800000, inputs: [`${P}/processed/scrna_scenic.h5ad`, `${P}/processed/deg_all_by_celltype.tsv`] },
  { idx: 16, step: 'virtual_knockout', ledgerWaitMs: ledgerWaitMsForStep('virtual_knockout'), ko: true, inputs: [`${P}/processed/scrna_annotated.h5ad`, `${P}/processed/deg_all_by_celltype.tsv`] },
  { idx: 17, step: 'summarize_dr', ledgerWaitMs: 1800000, inputs: [`${P}/processed/scrna_knockout.h5ad`] },
  { idx: 18, step: 'target_gene_localization', ledgerWaitMs: 1800000, inputs: [`${P}/processed/scrna_annotated.h5ad`, `${P}/processed/scrna_dr_summary.tsv`] },
  { idx: 19, step: 'gsva_pathways', ledgerWaitMs: 3600000, inputs: [`${P}/processed/scrna_annotated.h5ad`] },
  { idx: 20, step: 'dr_post_analysis', ledgerWaitMs: 3600000, inputs: [`${P}/processed/scrna_knockout.h5ad`, `${P}/processed/scrna_gsva.h5ad`] },
  { idx: 21, step: 'scrna_figures', ledgerWaitMs: 1800000, inputs: [`${P}/processed`] },
];

const only = process.env.ONLY_STEP || '';
const startIdx = Number(process.env.START_INDEX || '13');
const rows = [];

say('INFO', `project=${PROJECT} line=${LINE} seed=${SEED} ko=${KO_GENE} start=${startIdx}`);

for (const spec of STEPS) {
  if (spec.idx < startIdx) continue;
  if (only && spec.step !== only) continue;
  const label = `${spec.idx}. ${spec.step}`;
  const res = runStepDetached({ ...spec, label }, { log, koGene: KO_GENE });
  const wallSec = res.wallSec;
  if (res.status === 'skipped') {
    say('FAIL', `${label} 预检 | ${res.detail}（上一步产物未就绪，跳过）`);
    rows.push({ idx: spec.idx, step: spec.step, status: 'skipped', exit: '-', wall: 0, checkpoint: '-', note: res.detail });
    continue;
  }
  if (res.status === 'launch-failed') {
    say('FAIL', `${label} 启动 | ${res.detail}`);
    rows.push({ idx: spec.idx, step: spec.step, status: 'launch-failed', exit: '?', wall: wallSec, checkpoint: '?', note: 'wrapper 未就绪' });
    break;
  }
  if (res.ledger) {
    const led = res.ledger;
    const ok = res.status === 'ok';
    say(ok ? 'PASS' : 'FAIL', `${label} 结果 | ${res.detail}`
      + (ok ? '' : `\n    error=${String(led.error_log || '').slice(0, 1000)}`));
    rows.push({ idx: spec.idx, step: spec.step, status: led.status, exit: led.exit_code, wall: wallSec, checkpoint: led.checkpoint_status, note: ok ? '' : res.detail });
    if (!ok) { say('FAIL', `${label} 中断：后续步骤依赖其产物`); break; }
  } else {
    say('FAIL', `${label} 台账 | ${res.detail}`);
    rows.push({ idx: spec.idx, step: spec.step, status: res.status, exit: '?', wall: wallSec, checkpoint: '?', note: res.detail });
    break;
  }
}

const cols = [
  { key: 'idx', label: '#' }, { key: 'step', label: 'step' }, { key: 'status', label: 'status' },
  { key: 'exit', label: 'exit' }, { key: 'wall', label: '耗时(s)' }, { key: 'checkpoint', label: 'checkpoint' }, { key: 'note', label: '备注' },
];
const md = ['# line2 剩余步骤真机取证（setsid 直跑版）', '', `- project=${PROJECT} line=${LINE} seed=${SEED} ko=${KO_GENE}`, '', '## 执行日志', '', '~~~', lines.join('\n'), '~~~', '', '## 结果表', '', renderTable(rows, cols), ''].join('\n');
writeFileSync(OUT, md, 'utf8');
console.log('结果表已写 ' + OUT);
