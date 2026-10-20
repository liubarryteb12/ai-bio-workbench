/**
 * v3.0 需求文件 → project.json 映射验证
 *
 * 验证的是工作台「导入需求文件 → 建项」这段链路里的键名搬运：
 * 需求文件用 camelCase（biologicalPriors.focusGenes），project.json 用 snake_case
 * （biological_priors.focus_genes），中间靠 buildProjectMeta 归一化。
 * 键名搬错不会报错，只会静默丢失客户确认过的阈值/模板/验证集，所以单独验证一次。
 *
 * 两个用例：
 *   1. 完整 v3.0 需求（新格式）→ 五块全部落盘
 *   2. 收件箱里既有的真实旧需求（无 v3 块）→ 不抛错、取安全默认值
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildProjectMeta } from '../BioanalysDesktop/server/project.js';

const INBOX = fileURLToPath(new URL('../portal/inbox/', import.meta.url));

let failed = 0;
function check(label, cond, detail = '') {
  if (!cond) failed += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${label}${detail ? ' | ' + detail : ''}`);
}

// 模拟 App.tsx submit()：manifest 顶层五块原样展开进建项参数
function metaFromManifest(manifest, projectId) {
  return buildProjectMeta({
    id: projectId,
    name: manifest.basicInfo?.name,
    description: manifest.basicInfo?.description,
    basicInfo: manifest.basicInfo,
    dataSource: manifest.dataSource,
    groupingDesign: manifest.groupingDesign,
    pipelineDag: manifest.pipelineDag,
    aclAndOutput: manifest.aclAndOutput,
    notes: manifest.notes,
    references: manifest.references,
    biologicalPriors: manifest.biologicalPriors,
    analysisCutoffs: manifest.analysisCutoffs,
    plotLayoutConfig: manifest.plotLayoutConfig,
    experimentalDesign: manifest.experimentalDesign,
    validationGroupMapping: manifest.validationGroupMapping,
  });
}

const v3Manifest = {
  manifest_version: '1.0',
  basicInfo: { name: 'v3 映射验证', disease: 'Psoriasis', species: 'Homo sapiens', nonTumorVerified: true },
  dataSource: {
    dataType: 'microarray',
    data_source_mode: 'PUBLIC_DB',
    source: 'GEO',
    datasets: [{ gse: 'GSE277173', gpl: 'GPL11532', role: 'train' }],
  },
  groupingDesign: {
    mode: 'two_group',
    groups: [
      { groupName: 'NonLesional', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIds: ['GSM8515001'] },
      { groupName: 'Lesional', role: 'disease_stage', stageOrder: 1, colorHex: '#EE0000', sampleIds: ['GSM8515002'] },
    ],
    contrasts: [{ name: 'Lesional_vs_NonLesional', case: 'Lesional', ctrl: 'NonLesional', isPrimary: true }],
  },
  pipelineDag: [{ order: 1, stepId: 'deg_limma' }],
  aclAndOutput: { expectedFormats: ['png_300dpi'], targetKoGene: '' },
  biologicalPriors: { focusGenes: ['IL17A', 'S100A8'], targetKoGene: 'TNF', koFallbackPolicy: 'auto_recommend' },
  analysisCutoffs: { profile: 'sensitive', maxMtPercent: 15 },
  plotLayoutConfig: { templateId: 'template_2_cell_wide' },
  experimentalDesign: { isPaired: true, pairMap: { GSM8515001: 'Donor_01', GSM8515002: 'Donor_01' } },
  validationGroupMapping: { valControlSamples: ['GSM337001'], valTreatSamples: ['GSM337050'] },
};

const meta = metaFromManifest(v3Manifest, 'PRJ_V3_MAP_TEST');
check('schema_version 为 3', meta.schema_version === 3, String(meta.schema_version));
check('focus_genes 落盘', JSON.stringify(meta.biological_priors.focus_genes) === '["IL17A","S100A8"]');
check('target_ko_gene 落盘', meta.biological_priors.target_ko_gene === 'TNF');
check('ko_fallback_policy 落盘', meta.biological_priors.ko_fallback_policy === 'auto_recommend');
check('阈值档 + 数值按档展开', meta.analysis_cutoffs.profile === 'sensitive' && meta.analysis_cutoffs.log2fc_threshold === 0.585,
  `${meta.analysis_cutoffs.profile}/${meta.analysis_cutoffs.log2fc_threshold}`);
check('出图模板 + 主题规则', meta.plot_layout_config.template_id === 'template_2_cell_wide'
  && meta.plot_layout_config.theme_rules.legend_position === 'bottom_center');
check('配对设计落盘', meta.experimental_design.is_paired === true
  && meta.experimental_design.pair_map.GSM8515001 === 'Donor_01');
check('验证集映射落盘', meta.validation_group_mapping.invalid === false
  && meta.validation_group_mapping.val_control_samples.length === 1
  && meta.validation_group_mapping.val_treat_samples[0] === 'GSM337050');

// 旧需求文件（收件箱里的真实样例）：没有 v3 块，必须能建项且取默认值
const samples = fs.existsSync(INBOX)
  ? fs.readdirSync(INBOX).filter((n) => n.endsWith('.json'))
  : [];
if (!samples.length) {
  console.log('SKIP | 收件箱无既有样例，跳过向后兼容验证');
} else {
  const raw = JSON.parse(fs.readFileSync(path.join(INBOX, samples[0]), 'utf8'));
  let legacy = null;
  let err = '';
  try {
    legacy = metaFromManifest(raw, 'PRJ_V3_LEGACY_TEST');
  } catch (cause) {
    err = cause instanceof Error ? cause.message : String(cause);
  }
  check(`旧需求可建项（${samples[0]}）`, legacy !== null, err);
  if (legacy) {
    check('旧需求取安全默认阈值', legacy.analysis_cutoffs.profile === 'standard_sci');
    check('旧需求默认模板', legacy.plot_layout_config.template_id === 'template_1_nature_side');
    check('旧需求无验证集映射', legacy.validation_group_mapping.invalid === true);
  }
}

console.log(failed === 0 ? '\n全部符合预期' : `\n${failed} 条不符合预期`);
process.exit(failed === 0 ? 0 : 1);
