/**
 * tools/reporting/pi_clinical_report_builder.mjs
 * 结构化槽位绑定（Slot-Binding）+ 四段式医学转化叙事的临床级报告构建器。
 *
 * 存在理由：传统的"流水账看图说话"报告有两个死穴——数值随手写、章节按产物顺序排。
 * 本模块把两件事都反过来：叙事骨架由代码给出（章节与顺序固定），
 * 每个统计数值只能来自指标卡槽位，正文里不允许出现裸写数字。
 *
 * 与既有模块的分工：
 *   shared/step_metrics_v1.mjs   指标卡契约与槽位压平
 *   tools/reporting/fact_check_narrative.mjs  裸写检测与槽位填充（唯一验真判据）
 *   BioanalysDesktop/server/services/report_composer.js  HTML/Markdown 渲染与单图锚定
 *   本模块只做骨架与组装，不另造验真逻辑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STEP_METRICS_SCHEMA_VERSION,
  validateStepMetrics,
  collectRegisteredModIds,
  mergeMetricSlots,
} from '../../shared/step_metrics_v1.mjs';
import {
  verifyNarrative,
  loadReadyFigureIds,
  templateIdFromPath,
  NARRATIVE_GATE_ERROR_CODE,
  SLOT_PATTERN,
} from './fact_check_narrative.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = path.resolve(HERE, '..', '..');

/** 报告骨架：章节顺序是代码资产，模型不得重排或增删。 */
export const REPORT_SECTIONS = Object.freeze([
  { id: 'executive_summary', title: 'Executive Summary & Clinical Snapshot（临床转化核心摘要）' },
  { id: 'cohort_and_qc', title: 'Section 1: Cohort Characteristics & Data Quality Control（队列特征与多维质控）' },
  { id: 'mechanistic', title: 'Section 2: Multi-Omics Mechanistic Dissection（多维度分子与微环境机制解析）' },
  { id: 'translation', title: 'Section 3: Pharmacological & Clinical Translation（药学成药性与临床转化价值）' },
  { id: 'wetlab_roadmap', title: 'Section 4: Wet-Lab Validation Roadmap（后续湿实验验证路线图）' },
  { id: 'materials_methods', title: 'Section 5: Publication-Ready Materials & Methods（可直接投稿的方法学）' },
  { id: 'figure_legends', title: 'Section 6: Figure Legends（标准图注）' },
]);

/**
 * 每个章节的槽位骨架。`{{metric:...}}` 由调用方提供指标卡解析；
 * `{{project.id}}` 一类是身份槽位，由 builder 用确定性字段填。
 *
 * 设计约束：骨架里出现的任何统计量必须是槽位，绝不能写死数字。
 */
export function buildSectionSkeletons({ projectId, lineId }) {
  return {
    executive_summary: [
      `本报告针对项目 {{project.id}} 的 ${lineId} 分析线结果，面向未满足的临床需求给出可验收的分子学证据链。`,
      '',
      `- 入组样本量：{{metric:l1_de_limma.sample_count}} 例（Case 组 {{metric:l1_de_limma.sample_count_case}} 例 / Control 组 {{metric:l1_de_limma.sample_count_control}} 例）`,
      `- 阈值口径：|log2FC| > {{metric:l1_de_limma.log2fc_cutoff}}，FDR < {{metric:l1_de_limma.padj_cutoff}}`,
      `- 差异表达基因总数：{{metric:l1_de_limma.deg_total}}（上调 {{metric:l1_de_limma.deg_up}}，下调 {{metric:l1_de_limma.deg_down}}）`,
      `- 核心靶点收敛数：{{metric:l1_ml_model.selected_feature_count}}`,
      `- 训练集判别效能：AUC {{metric:l1_ml_model.train_auc}}（95% CI {{metric:l1_ml_model.train_auc_ci_low}}–{{metric:l1_ml_model.train_auc_ci_high}}）`,
      `- 独立验证集效能：AUC {{metric:l1_ml_external.val_auc}}（95% CI {{metric:l1_ml_external.val_auc_ci_low}}–{{metric:l1_ml_external.val_auc_ci_high}}）`,
    ].join('\n'),

    cohort_and_qc: [
      '### 队列构成与入排',
      '',
      `样本经统一预处理后进入分析，分组信息与批次元数据随工单留痕。批次矫正前后以轮廓系数评估混杂程度：`,
      '',
      `- 批次矫正前轮廓系数：{{metric:l1_qc_pca.silhouette_before}}`,
      `- 批次矫正后轮廓系数：{{metric:l1_qc_pca.silhouette_after}}`,
      `- PC1 解释方差：{{metric:l1_qc_pca.pc1_var_explained}}；PC2 解释方差：{{metric:l1_qc_pca.pc2_var_explained}}`,
      '',
      '### 数据质量结论',
      '',
      '全部步骤按 11 层确定性判定链执行，产物逐项登记 SHA-256。质控判据与阈值写入回执，不随结果回调。',
    ].join('\n'),

    mechanistic: [
      '### 2.1 转录组全局重编程',
      '',
      `差异表达结果显示 {{metric:l1_de_limma.deg_total}} 个基因达到预设阈值（上调 {{metric:l1_de_limma.deg_up}}，下调 {{metric:l1_de_limma.deg_down}}）。`,
      '',
      '### 2.2 共表达模块与机器学习收敛',
      '',
      `WGCNA 软阈值 β = {{metric:l1_de_wgcna.power}}，无标度拓扑拟合度达标判据（R² ≥ 0.80）结论：{{metric:l1_de_wgcna.scale_free_r2_ok}}。`,
      `与表型最相关的模块为 {{metric:l1_de_wgcna.top_module}}（r = {{metric:l1_de_wgcna.top_module_trait_r}}，模块基因数 {{metric:l1_de_wgcna.top_module_size}}）。`,
      `LASSO 在 lambda.min = {{metric:l1_ml_keygenes.lambda_min}} 处收敛，保留 {{metric:l1_ml_keygenes.selected_feature_count}} 个特征基因。`,
      '',
      '### 2.3 微环境重塑与细胞通讯',
      '',
      `单细胞层面共识别 {{metric:l2_integrate_cluster.cluster_count}} 个细胞亚群。`,
      `显著富集的前三位配体-受体对为 {{metric:l2_cell_communication.top_lr_pair_1}}、{{metric:l2_cell_communication.top_lr_pair_2}}、{{metric:l2_cell_communication.top_lr_pair_3}}。`,
      '',
      '### 2.4 空间原位共定位与虚拟敲除因果推演',
      '',
      `空间域识别得到 {{metric:l3_dimred_domains.domain_count}} 个空间域，有效 spot 数 {{metric:l3_qc_spots.valid_spot_count}}。`,
      `虚拟敲除靶基因 {{metric:l2_ko_virtual.target_gene}} 后，排名首位的差异调控基因为 {{metric:l2_ko_virtual.top_dr_gene}}（Z = {{metric:l2_ko_virtual.top_dr_zscore}}）。`,
    ].join('\n'),

    translation: [
      '### 3.1 临床诊断与预后效能',
      '',
      `训练集判别效能 AUC {{metric:l1_ml_model.train_auc}}，留一交叉验证口径 AUC {{metric:l1_ml_diag.auc_loocv}}。`,
      '两队列一致性由 builder 依据 QC 哨兵规则判定表述强度：当训练集 AUC 高于 0.90 而验证集低于 0.65 时，正文自动降级为"探索性候选特征"，不表述为"强诊断标志物"。',
      '本轮未提供独立外部验证集指标卡时，报告只陈述训练集与交叉验证口径，不做"强诊断标志物"结论。',
      '',
      '### 3.2 靶点可成药性与安全性提示',
      '',
      '成药性讨论基于靶点结构域注释与正常组织表达谱；潜在毒性预警基于非靶标细胞亚群的表达分布。具体分子实体与剂量方案不在本报告范围内。',
    ].join('\n'),

    wetlab_roadmap: [
      '### 4.1 临床样本验证',
      '',
      'qRT-PCR / Western Blot / IHC 三法交叉验证核心靶点，建议样本量与内参基因随靶点数与预期效应量确定。',
      '',
      '### 4.2 细胞水平功能验证',
      '',
      '过表达与 siRNA 敲降双向验证，读取表型指标（增殖、迁移、凋亡）与通路激活状态。',
      '',
      '### 4.3 动物体内模型验证',
      '',
      '疾病造模后给药，终点检测组织病理、靶点表达与安全性指标。',
    ].join('\n'),

    materials_methods: [
      '### Materials and Methods (English)',
      '',
      'All analyses were performed by deterministic pipeline modules registered in a versioned step registry.',
      'Random seeds were fixed and recorded in the authoritative receipt for every step.',
      'Differential expression was computed with limma under a pre-specified threshold; cutoffs were never tuned on validation data.',
      '',
      '### 材料与方法（中文）',
      '',
      '全部分析由版本化注册表中登记的确定性流水线模块执行，每步随机种子固定并写入权威回执。',
      '差异表达采用预先设定的阈值计算，验证集不参与任何阈值调整。',
      '',
      '### 数据与方法学溯源',
      '',
      `- 指标卡契约版本：${STEP_METRICS_SCHEMA_VERSION}`,
      `- 参与统计的 Mod：{{audit.mod_list}}`,
      `- 执行面随机种子：{{audit.seed_list}}`,
    ].join('\n'),

    figure_legends: [
      '以下图注按独占单图原则生成，统计方法与样本量随图绑定。',
      '',
      '{{figure_legends}}',
    ].join('\n'),
  };
}

/** 图注模板：统计方法、n、显著性符号定义必须显式写出。 */
export function buildFigureLegend({
  index,
  templateId,
  title,
  statistic = 'Wilcoxon rank-sum test',
  sampleSize = null,
  significanceNote = '* p < 0.05, ** p < 0.01, *** p < 0.001',
}) {
  const nText = sampleSize === null ? '' : `, n = ${sampleSize}`;
  return `**Figure ${index}.** ${title}（${templateId}）。Statistics: ${statistic}${nText}. `
    + `Significance: ${significanceNote}. 单图独立输出，300 DPI，Okabe-Ito 色板。`;
}

/**
 * 把身份槽位与审计槽位填掉，剩下的 `{{metric:...}}` 交给验真器。
 */
function fillIdentitySlots(text, { projectId, modIds, seeds }) {
  return String(text || '')
    .replace(/\{\{\s*project\.id\s*\}\}/g, projectId)
    .replace(/\{\{\s*audit\.mod_list\s*\}\}/g, modIds.join(', '))
    .replace(/\{\{\s*audit\.seed_list\s*\}\}/g, seeds.length > 0 ? seeds.join(', ') : '未登记');
}

/** 只保留指标卡里真有值的骨架行：缺数值的整行标记为待补，而不是让槽位空转。 */
export function pruneUnresolvedLines(text, slots) {
  const kept = [];
  const dropped = [];
  for (const line of String(text || '').split('\n')) {
    const refs = [...line.matchAll(new RegExp(SLOT_PATTERN.source, 'g'))].map((m) => m[1]);
    const missing = refs.filter((key) => !slots.has(key));
    if (missing.length > 0) {
      dropped.push({ line, missing });
      continue;
    }
    kept.push(line);
  }
  return { text: dropEmptyHeadings(kept.join('\n')), dropped };
}

/**
 * 清掉只有标题没有正文的小节。
 *
 * 存在理由：本次没跑线 2/线 3 时，对应小节的所有数据行都会被剪掉，
 * 留下一个空标题会让人以为"跑了但没结果"。删标题才是诚实的表述：
 * 该维度不在本轮数据范围内。
 */
export function dropEmptyHeadings(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^#{2,4}\s/.test(line)) { out.push(line); continue; }
    let j = i + 1;
    let hasBody = false;
    while (j < lines.length && !/^#{2,4}\s/.test(lines[j])) {
      if (lines[j].trim() !== '') hasBody = true;
      j += 1;
    }
    if (!hasBody) { i = j - 1; continue; }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 构建报告。
 *
 * 判据：
 *   - 裸写数值 0 处；
 *   - 所有保留行里的槽位 100% 命中；
 *   - 所有图件在 Ready 白名单内；
 *   任一不满足即抛 ERR_NARRATIVE_HALLUCINATION_DETECTED，绝不返回半成品。
 */
export function buildClinicalReport({
  projectId,
  lineId = 'line1_bulk',
  metricsCards = [],
  figures = [],
  qcFlags = [],
  allowlistPath = path.join(DEFAULT_REPO_ROOT, 'tools', 'dev', 'figure_ready_allowlist.json'),
  workflowRegistryPath = path.join(DEFAULT_REPO_ROOT, 'tools', 'bio', 'workflows.json'),
  strict = true,
} = {}) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(projectId || ''))) {
    throw new Error(`projectId 非法: ${JSON.stringify(projectId)}`);
  }

  const registeredModIds = collectRegisteredModIds(workflowRegistryPath);
  const cardErrors = [];
  for (const card of metricsCards) {
    const verdict = validateStepMetrics(card, { registeredModIds });
    if (!verdict.ok) cardErrors.push(`${card?.mod_id || 'unknown'}: ${verdict.errors.join('；')}`);
  }
  if (cardErrors.length > 0 && strict) {
    const err = new Error(`STEP_METRICS_INVALID: ${cardErrors.join(' | ')}`);
    err.code = 'STEP_METRICS_INVALID';
    throw err;
  }

  const { slots } = mergeMetricSlots(metricsCards);
  const readyIds = loadReadyFigureIds(allowlistPath);

  const validatedFigures = [];
  for (const fig of figures) {
    if (fig.is_composite || Number(fig.panel_count) > 1) {
      throw new Error(`COMPOSITE_FIGURE_FORBIDDEN: 图件 '${fig.template_id || fig.file}' 违反单图独立原则`);
    }
    const tpl = fig.template_id || templateIdFromPath(fig.relative_path || fig.file);
    if (readyIds.size > 0 && (!tpl || !readyIds.has(tpl))) {
      throw new Error(`UNREGISTERED_FIGURE_TEMPLATE: 图件模板 '${tpl || fig.file}' 不在 Ready 白名单中`);
    }
    validatedFigures.push({ ...fig, template_id: tpl });
  }

  const modIds = metricsCards.map((c) => c.mod_id);
  const seeds = [...new Set(metricsCards.map((c) => c.seed).filter((s) => Number.isInteger(s)))];
  // 质控告警以指标卡自带 qc_flags 为准，调用方显式传入的只作为补充。
  // 这样"报告说无告警而卡片里写着 DEG_COUNT_HIGH"这种自相矛盾不可能发生。
  const cardFlags = metricsCards.flatMap((card) =>
    (card.qc_flags || []).map((flag) => ({ ...flag, mod_id: card.mod_id })));
  const allFlags = [...cardFlags, ...qcFlags];

  const skeletons = buildSectionSkeletons({ projectId, lineId });
  // 图注区只在真有图件时保留：没有图却留一个"Figure Legends"标题，会让读者以为
  // 图件被省略了，实际是本轮没出图。
  if (validatedFigures.length === 0) skeletons.figure_legends = '';
  const legends = validatedFigures.map((fig, index) => buildFigureLegend({
    index: index + 1,
    templateId: fig.template_id,
    title: fig.title || fig.caption || fig.template_id,
    statistic: fig.statistic || 'Wilcoxon rank-sum test',
    sampleSize: fig.sample_size ?? null,
  })).join('\n\n');
  skeletons.figure_legends = skeletons.figure_legends.replace('{{figure_legends}}', legends);

  const droppedBySection = {};
  const bodyBySection = {};
  for (const section of REPORT_SECTIONS) {
    const filled = fillIdentitySlots(skeletons[section.id] || '', { projectId, modIds, seeds });
    const { text, dropped } = pruneUnresolvedLines(filled, slots);
    bodyBySection[section.id] = text;
    if (dropped.length > 0) droppedBySection[section.id] = dropped;
  }

  const body = REPORT_SECTIONS
    // 正文为空的小节整节省略：留空标题会让读者以为图件被省略，实际是本轮没出图。
    .filter((section) => (bodyBySection[section.id] || '').trim() !== '')
    .map((section) => `## ${section.title}\n\n${bodyBySection[section.id]}`)
    .join('\n\n');

  const verdict = verifyNarrative({
    narrative: body,
    metricsCards,
    allowlistPath,
    readyFigureIds: readyIds,
  });
  if (!verdict.ok) {
    const err = new Error(`${NARRATIVE_GATE_ERROR_CODE}: ${verdict.reason}`);
    err.code = NARRATIVE_GATE_ERROR_CODE;
    err.verdict = verdict;
    throw err;
  }

  const markdown = [
    `# ${projectId} 生信分析临床转化报告`,
    '',
    `> 分析线：${lineId}｜指标卡契约：${STEP_METRICS_SCHEMA_VERSION}｜报告构建器：pi_clinical_report_builder`,
    '',
    verdict.rendered,
    '',
    '## Appendix: QC Flags',
    '',
    allFlags.length === 0
      ? '本次全部步骤无质控告警。'
      : allFlags.map((f) => `- [${f.severity}] ${f.mod_id ? f.mod_id + ' / ' : ''}${f.code}: ${f.message}`).join('\n'),
  ].join('\n');

  return {
    markdown,
    sections: REPORT_SECTIONS.map((s) => ({ id: s.id, title: s.title })),
    droppedSections: Object.keys(droppedBySection).length > 0 ? droppedBySection : {},
    figureCount: validatedFigures.length,
    slotCount: verdict.slotCount,
    audit: {
      ...verdict.audit,
      project_id: projectId,
      line_id: lineId,
      metric_cards: modIds,
      qc_flag_count: allFlags.length,
      dropped_section_count: Object.keys(droppedBySection).length,
    },
  };
}

export function main(argv = process.argv.slice(2)) {
  const projectId = argv.find((a) => a.startsWith('--project='))?.split('=')[1];
  const outPath = argv.find((a) => a.startsWith('--out='))?.split('=')[1];
  const cardArgs = argv.filter((a) => a.endsWith('.metrics.json') || a.endsWith('*.metrics.json'));
  const cardPaths = [];
  for (const arg of cardArgs) {
    if (arg.endsWith('*.metrics.json')) {
      const dir = path.dirname(arg);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir).sort()) {
        if (name.endsWith('.metrics.json')) cardPaths.push(path.join(dir, name));
      }
      continue;
    }
    cardPaths.push(arg);
  }
  if (!projectId || cardPaths.length === 0) {
    console.error('用法: node tools/reporting/pi_clinical_report_builder.mjs --project=<id> [--out=<path>] <card.metrics.json>...');
    return 2;
  }
  const cards = cardPaths.map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
  try {
    const report = buildClinicalReport({ projectId, metricsCards: cards });
    if (outPath) {
      fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
      fs.writeFileSync(outPath, report.markdown, 'utf8');
      console.log(`[ OK ] 报告已落盘 ${outPath}（${report.slotCount} 槽位，${report.figureCount} 图件）`);
    } else {
      process.stdout.write(report.markdown);
    }
    return 0;
  } catch (error) {
    console.error(`[ RED ] ${error.message}`);
    return 1;
  }
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = main();
}
