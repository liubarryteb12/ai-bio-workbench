#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from './build_figure_templates.cjs';
import { loadTemplateCatalog } from '../../BioanalysDesktop/server/figure_template_catalog.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATES = buildRegistry().templates;
const CSV = path.join(REPO, 'references', '05.可参考生信代码', '可用代码预筛选', '源码', '_meta', 'bizard_index.csv');
const OUTPUT = path.join(REPO, 'tools', 'bio', 'figure_template_profiles.json');
const DOC = path.join(REPO, 'docs', 'FIGURE_TEMPLATE_CATALOG.md');

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function snakeCase(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function csvKey(level, name, category, enName, language) {
  const normalizedLevel = level.toUpperCase();
  return (language.toLowerCase() === 'python' && !normalizedLevel.endsWith('P'))
    ? `fig_${normalizedLevel.toLowerCase()}p_${snakeCase(enName)}`
    : `fig_${normalizedLevel.toLowerCase()}_${snakeCase(enName)}`;
}

const csvRows = parseCsvRows(fs.readFileSync(CSV, 'utf8'));
const csvByKey = new Map();
for (const raw of csvRows.slice(1)) {
  const [level, name, category, enName, language, rCount, pyCount, dependencies, status, location] = raw;
  csvByKey.set(csvKey(level, name, category, enName, language), {
    level,
    name,
    category,
    enName,
    language,
    rCount,
    pyCount,
    dependencies: String(dependencies || '').replace(/[`”]/g, '').split(/[；;]/).map((item) => item.trim()).filter(Boolean),
    libraryStatus: status,
    location,
  });
}

const CATEGORY_LABELS = {
  Annotation: '注释核验',
  CellCommunication: '细胞通讯',
  Clinics: '临床统计',
  Composition: '组成结构',
  Correlation: '相关关系',
  DataOverTime: '时间趋势',
  DifferentialExpression: '差异表达',
  DimReduction: '降维嵌入',
  Distribution: '分布形态',
  Downstream: '下游网络',
  Omics: '组学统计',
  Proportion: '比例构成',
  Python: 'Python 通用统计',
  R: 'R 通用统计',
  Ranking: '排序比较',
  Spatial: '空间分布',
  SpatialStatistics: '空间统计',
};

const LEVEL_LABELS = {
  L1: '基础统计图',
  L2: '组学常用图',
  L3: '高级统计图',
};

const LANGUAGE_LABELS = { r: 'R', python: 'Python' };

const STATUS_LABELS = {
  ready: '已验证可用',
  pending: '规划中',
  blocked_r453: '受 R 版本兼容阻塞',
  pending_mapping: '待产物映射',
};

const LINE_LABELS = {
  line1_bulk: '线 1：GEO Bulk 常规挖掘',
  line2_scrna: '线 2：单细胞转录组',
  line3_spatial: '线 3：空间转录组',
};

const V2_NAMES = {
  fig_l3_banksy_domain: 'Spatial Functional Domains',
  fig_l3_nnls_deconv_pie: 'NNLS Cell Type Composition',
  fig_l3_multigene_coloc: 'Target Gene Spatial Localization',
  fig_l3_morans_i_spatial: 'Spatial Autocorrelation Ranking',
  fig_l3_niche_comm_spatial: 'Spatial Niche Communication',
  fig_l2_harmony_umap_entropy: 'Harmony UMAP with Donor Entropy',
  fig_l2_liana_lr_dotplot: 'LIANA Ligand Receptor Dotplot',
  fig_l2_canonical_marker_dotplot: 'Canonical Marker Dotplot',
  fig_l2_dr_trajectory_post: 'Downstream Regulatory Network',
  fig_l2_celltype_deg_volcano: 'Cell Type Specific DEG Volcano',
};

const PURPOSE_RULES = [
  [/(volcano|火山)/i, '展示差异倍数和显著性，快速识别上调、下调和不显著的基因。'],
  [/(pca|主成分|umap|降维|embed)/i, '展示降维后的样本或细胞分布，检查分组结构和批次效应。'],
  [/(heatmap|热图)/i, '用颜色矩阵展示多个基因在样本、细胞类型或空间域中的相对变化。'],
  [/(correlation|correlogram|相关)/i, '展示变量或样本之间的相关强度，识别共变关系和潜在离群样本。'],
  [/(composition|proportion|pie|donut|barplot|stacked|treemap|waffle)/i, '比较各类别在总体中的占比，观察组成结构是否随分组变化。'],
  [/(boxplot|violin|density|histogram|ridgeline|distribution)/i, '比较数值分布、集中趋势和离散程度，识别偏态与异常值。'],
  [/(network|ppi|chord|sankey|trajectory|arc|circos)/i, '展示节点之间的连接、流向或层级关系，阅读关键通路和网络中心性。'],
  [/(spatial|domain|moran|localization|scalebar)/i, '展示切片内空间位置与表达或域标签的对应关系，检查空间聚集和逐样本差异。'],
  [/(cellcomm|ligand|receptor|communication)/i, '比较细胞类型之间的配受体通讯强度，筛选高排序的互作关系。'],
  [/(marker|annotation|dotplot|scatter)/i, '比较标志基因在不同细胞类型或分组中的表达，核验注释和定位。'],
  [/(ranking|lollipop|bar)/i, '按统计值排序展示条目，快速定位排名靠前的基因、通路或类别。'],
  [/(survival|roc|clinic|calibration|nomogram|dca)/i, '展示模型或临床结局的判别能力，阅读阈值、校准和净获益。'],
  [/(time|line|area|series)/i, '展示数值随时间或有序阶段的变化趋势，比较轨迹与拐点。'],
  [/(venn|upset|overlap)/i, '展示多个集合之间的交集和独有项，比较筛选结果的一致性。'],
  [/(ma|volcano|deg)/i, '展示差异分析中的效应量与显著性，核对阈值线和显著基因数量。'],
];

function inferPurpose(englishName, name, category) {
  const semantic = `${englishName} ${name} ${category}`;
  for (const [pattern, text] of PURPOSE_RULES) {
    if (pattern.test(semantic)) return text;
  }
  return `展示${CATEGORY_LABELS[category] || category || '统计关系'}中的主要模式，辅助比较分组、排序和异常结构。`;
}

function inferInputs(template) {
  if (Array.isArray(template.input_tables) && template.input_tables.length) return template.input_tables.join('、');
  if (template.data_contract?.input_artifact) return template.data_contract.input_artifact;
  const deps = Object.keys(template.adapt_vars || {});
  return deps.length ? `项目内可读取的数据表，并由 ${deps.join('、')} 指定字段` : '尚未绑定项目输入产物';
}

function inferOutputs(template) {
  if (Array.isArray(template.produces) && template.produces.length) return template.produces.join('、');
  if (template.canonical_output) return template.canonical_output;
  return '尚未登记生产产物名';
}

function inferDependencies(template) {
  if (Array.isArray(template.deps) && template.deps.length) return template.deps;
  return [];
}

function inferEnglishName(template) {
  if (V2_NAMES[template.id]) return V2_NAMES[template.id];
  const csv = csvByKey.get(template.id);
  if (csv?.enName) return csv.enName;
  return template.id.replace(/^fig_/, '').split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function inferIntroduction(template, purpose, csv) {
  const categoryLabel = CATEGORY_LABELS[template.category] || template.category || '通用统计';
  const statusLabel = STATUS_LABELS[template.deps_status] || template.deps_status;
  const lineLabel = template.lines.length
    ? template.lines.map((line) => LINE_LABELS[line] || line).join('、')
    : '尚未绑定分析线';
  const inputText = inferInputs(template);
  const outputText = inferOutputs(template);
  const depsText = inferDependencies(template).slice(0, 8).join('、') || '未登记第三方依赖';
  const modifier = template.lines.length
    ? `绑定${lineLabel}，对应步骤 ${template.analysis_step || '未登记'}，输入 ${inputText}，登记产物 ${outputText}。${template.deps_status === 'ready' ? '' : '当前仅作候选目录展示，未进入生产可选清单。'}`
    : '当前仅作候选目录展示，未进入生产可选清单，输入和产物仍待映射。';
  const readiness = template.deps_status === 'ready'
    ? '已通过就绪准入，按单图规范输出 300 DPI PNG，图例置于轴框外右侧，图注置于左下角。'
    : `当前状态为${statusLabel}，依赖 ${depsText}；该图型暂不可派发生产任务。`;
  const sourceNote = csv?.enName
    ? `参考图型为 ${csv.enName}，属于${categoryLabel}类。`
    : `属于${categoryLabel}类，来自生产流水线实证模板。`;
  return `${purpose}${sourceNote}读取时先看坐标轴、颜色映射和图例，再结合样本量、阈值与分组口径判断结论。${modifier}${readiness}`;
}

const profiles = TEMPLATES.map((template) => {
  const csv = csvByKey.get(template.id);
  const englishName = inferEnglishName(template);
  const purpose = inferPurpose(englishName, template.name, template.category);
  const deps = inferDependencies(template);
  return {
    id: template.id,
    name: template.name,
    english_name: englishName,
    level: template.level,
    level_label: LEVEL_LABELS[template.level] || template.level,
    tier: Number(String(template.level).replace(/^L/, '')),
    category: template.category,
    category_label: CATEGORY_LABELS[template.category] || template.category,
    language: template.language,
    language_label: LANGUAGE_LABELS[template.language] || template.language,
    status: template.deps_status,
    status_label: STATUS_LABELS[template.deps_status] || template.deps_status,
    verified: Boolean(template.verified),
    deprecated: Boolean(template.deprecated),
    lines: template.lines,
    line_labels: template.lines.map((line) => LINE_LABELS[line] || line),
    line_id: template.line_id || template.lines[0] || null,
    analysis_step: template.analysis_step,
    producing_mod_id: template.producing_mod_id,
    required_mod_ids: template.required_mod_ids,
    linked_mods: template.linked_mods,
    input_tables: template.input_tables,
    input_artifact: template.data_contract?.input_artifact || null,
    input_format: template.data_contract?.format || null,
    produces: template.produces,
    canonical_output: template.canonical_output,
    output_glob: template.output_glob,
    dependencies: deps,
    adapt_vars: template.adapt_vars,
    source: template.source,
    preview: template.preview,
    sample_project_output: template.sample_project_output,
    block_reason: template.block_reason || null,
    academic_tier: template.academic_tier,
    render_evidence: template.render_evidence,
    spec_contract: template.spec_contract,
    portal_binding: template.portal_binding,
    purpose,
    introduction: inferIntroduction(template, purpose, csv),
    library_status: csv?.libraryStatus || null,
    source_location: csv?.location || null,
  };
});

const doc = {
  schema_version: 1,
  generated_from: {
    templates: 'tools/bio/figure_templates.json',
    csv: 'references/05.可参考生信代码/可用代码预筛选/源码/_meta/bizard_index.csv',
  },
  profiles,
};

function renderDoc(entries) {
  const lines = [
    '# 图模板全量目录',
    '',
    '> 真源：`tools/bio/figure_template_profiles.json`。本文由 92 条模板元数据生成，面向客户端展示与人工查阅。',
    '',
    `共 ${entries.length} 个模板，其中 Ready ${entries.filter((item) => item.status === 'ready').length} 个，规划中 ${entries.filter((item) => item.status === 'pending').length} 个，兼容阻塞 ${entries.filter((item) => item.status === 'blocked_r453').length} 个。`,
    '',
    '## 目录说明',
    '',
    '- `Level` 表示图型复杂度层级，不表示分析线。',
    '- `Ready` 表示已通过就绪准入，并可读取最新 DCM 测试数据实例。',
    '- `规划中` 与 `兼容阻塞` 只进入全量目录展示，不进入生产可选清单。',
    '- 所有 Ready 单图按 300 DPI、图例外置右侧、图注左下角的规范输出。',
    '',
  ];
  for (const level of ['L1', 'L2', 'L3']) {
    lines.push(`## ${level}：${entries.find((item) => item.level === level)?.level_label || level}`, '');
    for (const item of entries.filter((entry) => entry.level === level)) {
      lines.push(`### ${item.name}（${item.english_name}）`, '');
      lines.push(`- ID：\`${item.id}\``);
      lines.push(`- 基本信息：${item.level_label}，Tier ${item.tier}，${item.category_label}，${item.language_label}，${item.status_label}`);
      lines.push(`- 分析线：${item.line_labels.length ? item.line_labels.join('、') : '未绑定'}，对应步骤：${item.analysis_step || '未绑定'}`);
      lines.push(`- 输入：${item.input_tables.length ? item.input_tables.join('、') : item.input_artifact || '尚未绑定'}，登记产物：${item.produces.length ? item.produces.join('、') : '尚未登记'}`);
      lines.push(`- 依赖：${item.dependencies.length ? item.dependencies.slice(0, 12).join('、') : '未登记'}`);
      lines.push(`- 用途：${item.purpose}`);
      lines.push(`- 介绍：${item.introduction}`);
      if (item.latest_example) lines.push(`- 最新实例：\`${item.latest_example.path}\`，${item.latest_example.dpi} DPI，\`${item.latest_example.sha256}\``);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function main() {
  fs.writeFileSync(OUTPUT, JSON.stringify(doc, null, 2) + '\n');
  const entries = loadTemplateCatalog();
  fs.writeFileSync(DOC, renderDoc(entries));
  console.log(`FIGURE_TEMPLATE_PROFILES_WRITTEN ${profiles.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
