#!/usr/bin/env node
/**
 * Pi 黄金样本复现脚本（pi_golden_case.mjs）。
 *
 * 存在的理由：回执 3 与回执 4 要求"用仓库内置黄金基准集实跑一次"，并贴出
 * 指标卡真实内容、检查点判读输出、报告全文与验真审计。手工拼这些产物
 * 既不可复现也容易夹带伪造数值，所以把整条链路收成一条命令。
 *
 * 跑完的产物（全部确定性，可逐字节复核）：
 *   workspace/projects/<id>/metrics/<mod>.metrics.json   指标卡
 *   workspace/projects/<id>/reports/clinical_report.md   报告全文
 *   workspace/projects/<id>/reports/fact_check_audit.json 验真审计
 *   workspace/projects/<id>/reports/checkpoint_review.json 检查点判读
 *
 * 用法：
 *   node tools/dev/pi_golden_case.mjs                      默认 DCM 基准项目
 *   node tools/dev/pi_golden_case.mjs --project=<id> --line=line1_bulk
 *   node tools/dev/pi_golden_case.mjs --dry                只打印，不落盘
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractStepMetrics, writeMetricCards } from '../reporting/extract_step_metrics.mjs';
import { buildClinicalReport } from '../reporting/pi_clinical_report_builder.mjs';
import { collectRegisteredModIds } from '../../shared/step_metrics_v1.mjs';
import { PI_CHECKPOINTS } from '../../BioanalysDesktop/server/services/pi_supervisor.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
export const DEFAULT_PROJECT = 'PRJ_DCM_BENCH_20261105';

/**
 * 检查点判读：把指标卡里的 qc_flags 转成"放行 / 调参 / 挂起"的确定性建议。
 *
 * 判据与 desktop/runtime/picli/prompts/qc_sentinel_rules.md 一一对应。
 * 这里只做确定性映射，不做自由文本生成：模型只负责叙述，不负责判定。
 */
export function reviewCheckpoints(cards) {
  const flags = cards.flatMap((card) => (card.qc_flags || []).map((f) => ({ ...f, mod_id: card.mod_id })));
  const blockers = flags.filter((f) => f.severity === 'block');
  const warns = flags.filter((f) => f.severity === 'warn');

  const remediations = [];
  for (const flag of warns) {
    if (flag.code === 'DEG_COUNT_HIGH') {
      const card = cards.find((c) => c.mod_id === flag.mod_id);
      const current = card?.metrics?.log2fc_cutoff;
      // 阶梯只在受控可调表里取值，不自由发明新阈值
      const ladder = [0.585, 1.0, 1.5].filter((v) => Number.isFinite(current) ? v > current : true);
      remediations.push({
        action: 'REMEDIATE',
        mod_id: flag.mod_id,
        param_key: 'log2fc_cutoff',
        current,
        suggested: ladder[0] ?? null,
        within_bounds: ladder.length > 0,
        reason: flag.message,
      });
    }
    if (flag.code === 'DEG_COUNT_LOW') {
      const card = cards.find((c) => c.mod_id === flag.mod_id);
      const current = card?.metrics?.log2fc_cutoff;
      const ladder = [0.585, 1.0, 1.5].filter((v) => Number.isFinite(current) ? v < current : true);
      remediations.push({
        action: 'REMEDIATE',
        mod_id: flag.mod_id,
        param_key: 'log2fc_cutoff',
        current,
        suggested: ladder[ladder.length - 1] ?? null,
        within_bounds: ladder.length > 0,
        reason: flag.message,
      });
    }
    if (flag.code === 'WGCNA_SCALE_FREE_LOW') {
      remediations.push({
        action: 'INVESTIGATE_FIRST',
        mod_id: flag.mod_id,
        param_key: null,
        suggested: null,
        within_bounds: true,
        reason: flag.message + '（先改 bicor 或复查离群样本，不动阈值）',
      });
    }
  }

  return {
    checkpoint_1: {
      id: PI_CHECKPOINTS.PLAN,
      decision: blockers.length > 0 ? 'HOLD' : 'PROCEED_WITH_PENDING_HUMAN_APPROVAL',
      blocking_flags: blockers.map((f) => `${f.mod_id}/${f.code}`),
      note: '立项与 DAG 编译后、下发算力节点前，必须由人工点击批准',
    },
    checkpoint_2: {
      id: PI_CHECKPOINTS.TARGET,
      decision: 'PENDING_HUMAN_TARGET_LOCK',
      qc_flags: flags.map((f) => ({ mod_id: f.mod_id, code: f.code, severity: f.severity, message: f.message })),
      remediations,
      note: '核心靶点收敛后、报告渲染与签名前，必须由人工确认 1–3 个靶点',
    },
    summary: {
      card_count: cards.length,
      warn_count: warns.length,
      block_count: blockers.length,
    },
  };
}

export function runGoldenCase({ projectId = DEFAULT_PROJECT, lineId = 'line1_bulk', dry = false } = {}) {
  const projectRoot = path.join(REPO, 'workspace', 'projects', projectId);
  const processedDir = path.join(projectRoot, 'data', lineId, 'processed');
  if (!fs.existsSync(processedDir)) {
    throw new Error(`黄金集产物缺失: ${path.relative(REPO, processedDir)}（本项目不可作为黄金样本）`);
  }

  const workflowsPath = path.join(REPO, 'tools', 'bio', 'workflows.json');
  const registered = collectRegisteredModIds(workflowsPath);
  const cards = extractStepMetrics({ projectId, lineId, processedDir });

  const metricsDir = path.join(projectRoot, 'metrics');
  const reportsDir = path.join(projectRoot, 'reports');
  let written = [];
  if (!dry) {
    ({ written } = writeMetricCards(cards, { outDir: metricsDir, workflowsPath }));
  }

  const report = buildClinicalReport({ projectId, lineId, metricsCards: cards });
  const review = reviewCheckpoints(cards);

  const factCheckAudit = {
    ...report.audit,
    generated_at: new Date().toISOString(),
    source: 'tools/dev/pi_golden_case.mjs',
    note: '所有数值均由指标卡槽位填充；unbounded_count 与 unresolved_count 必须为 0 才可签发',
  };

  if (!dry) {
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(path.join(reportsDir, 'clinical_report.md'), report.markdown, 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'fact_check_audit.json'), JSON.stringify(factCheckAudit, null, 2), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'checkpoint_review.json'), JSON.stringify(review, null, 2), 'utf8');
  }

  return {
    projectId,
    lineId,
    cards,
    written,
    report,
    review,
    factCheckAudit,
    paths: {
      metrics_dir: path.relative(REPO, metricsDir).split(path.sep).join('/'),
      report: path.relative(REPO, path.join(reportsDir, 'clinical_report.md')).split(path.sep).join('/'),
      audit: path.relative(REPO, path.join(reportsDir, 'fact_check_audit.json')).split(path.sep).join('/'),
      review: path.relative(REPO, path.join(reportsDir, 'checkpoint_review.json')).split(path.sep).join('/'),
    },
    registered_mod_count: registered.size,
  };
}

export function main(argv = process.argv.slice(2)) {
  const projectId = argv.find((a) => a.startsWith('--project='))?.split('=')[1] || DEFAULT_PROJECT;
  const lineId = argv.find((a) => a.startsWith('--line='))?.split('=')[1] || 'line1_bulk';
  const dry = argv.includes('--dry');

  let out;
  try {
    out = runGoldenCase({ projectId, lineId, dry });
  } catch (error) {
    console.error(`[ RED ] ${error.message}`);
    return 1;
  }

  console.log(`黄金集: ${out.projectId} / ${out.lineId}`);
  console.log(`指标卡: ${out.cards.length} 张（注册表 ${out.registered_mod_count} 个 Mod 可比对）`);
  for (const card of out.cards) {
    const bytes = Buffer.byteLength(JSON.stringify(card), 'utf8');
    const flags = (card.qc_flags || []).map((f) => f.code).join(',') || '-';
    console.log(`  ${String(card.mod_id).padEnd(22)} ${String(bytes).padStart(6)} B  flags=${flags}`);
  }
  console.log(`报告槽位: ${out.report.slotCount}，图件: ${out.report.figureCount}，裸写数值: ${out.report.audit.unbounded_count}，未命中槽位: ${out.report.audit.unresolved_count}`);
  console.log(`检查点一: ${out.review.checkpoint_1.decision}；检查点二: ${out.review.checkpoint_2.decision}`);
  for (const rem of out.review.checkpoint_2.remediations) {
    console.log(`  建议 ${rem.action} ${rem.mod_id}.${rem.param_key ?? '(不动阈值)'} -> ${rem.suggested ?? '-'}`);
  }
  if (!dry) {
    console.log(`产物: ${out.paths.metrics_dir}/ | ${out.paths.report} | ${out.paths.audit} | ${out.paths.review}`);
  } else {
    console.log('（--dry：未落盘）');
  }
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = main();
}
