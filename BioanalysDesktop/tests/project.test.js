import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseProjectList, buildProjectMeta, buildCreateProjectCommand,
  parseProjectMeta, buildProjectListCommand, buildReadProjectMetaCommand,
  normalizeWgcnaConfig, WGCNA_CONFIG_DEFAULTS,
  PROJECT_META_FILE, PROJECT_SCHEMA_VERSION,
} from '../server/project.js';
import { sanitizeProjectId, projectLineDir, PROJECTS_ROOT, LINES } from '../server/domain.js';

test('sanitizeProjectId：合法 ID 通过，非法一律拒', () => {
  for (const ok of ['default', 'proj_b', 'P1', 'a.b-c', 'x'.repeat(64)]) {
    assert.equal(sanitizeProjectId(ok), ok, `${ok} 应通过`);
  }
  for (const bad of ['', ' ', '.hidden', '..', 'a/b', 'a\\b', 'a b', 'x'.repeat(65), null, undefined]) {
    assert.equal(sanitizeProjectId(bad), null, `${bad} 应被拒`);
  }
});

test('projectLineDir：拼出 projects/<项目>/<线>，非法参数抛错', () => {
  assert.equal(projectLineDir('default', 'line1_bulk'), `${PROJECTS_ROOT}/default/line1_bulk`);
  assert.throws(() => projectLineDir('../x', 'line1_bulk'));
  assert.throws(() => projectLineDir('default', 'line9_x'));
});

test('parseProjectList：剥掉 mtime 段并排序去重（find %f|%T@ 输出）', () => {
  const raw = [
    'default|1791963914.7159723100',
    'proj_b|1791964000.1',
    'default|1791963914.7159723100',
    '',
  ].join('\n');
  assert.deepEqual(parseProjectList(raw), ['default', 'proj_b']);
});

test('parseProjectList：兼容绝对路径行，丢弃非法名', () => {
  const raw = [
    `${PROJECTS_ROOT}/default|1791963914.1`,
    `${PROJECTS_ROOT}/.hidden|1791963914.1`,
    `${PROJECTS_ROOT}/bad name|1791963914.1`,
    '',
  ].join('\n');
  assert.deepEqual(parseProjectList(raw), ['default']);
});

test('parseProjectList：空输出返回空数组', () => {
  assert.deepEqual(parseProjectList(''), []);
  assert.deepEqual(parseProjectList('\n\n'), []);
});

test('normalizeWgcnaConfig：默认值 = aims Step 3 契约，越界回落默认', () => {
  // 不传参 = 全默认（母版脚本读不到 project.json 时用的就是这一批）
  assert.deepEqual(normalizeWgcnaConfig(undefined), WGCNA_CONFIG_DEFAULTS);
  assert.deepEqual(normalizeWgcnaConfig({}), WGCNA_CONFIG_DEFAULTS);
  assert.deepEqual(normalizeWgcnaConfig(null), WGCNA_CONFIG_DEFAULTS);
  // 合法值透传
  const custom = normalizeWgcnaConfig({
    top_n_genes: 3000, min_module_size: 30, merge_cut_height: 0.2,
    deep_split: 3, power_rule: 'max_r2', module_p_threshold: 0.01,
    hub_kme_min: 0.75, hub_gs_min: 0.25, max_block_size: 4000,
  });
  assert.equal(custom.top_n_genes, 3000);
  assert.equal(custom.min_module_size, 30);
  assert.equal(custom.merge_cut_height, 0.2);
  assert.equal(custom.deep_split, 3);
  assert.equal(custom.power_rule, 'max_r2');
  assert.equal(custom.module_p_threshold, 0.01);
  assert.equal(custom.hub_kme_min, 0.75);
  assert.equal(custom.hub_gs_min, 0.25);
  assert.equal(custom.max_block_size, 4000);
  // 非法值回落默认，不抛错（建项流程不能被一个坏参数卡住）
  const bad = normalizeWgcnaConfig({
    top_n_genes: 10, min_module_size: 'abc', merge_cut_height: 5,
    deep_split: -1, power_rule: 'whatever', module_p_threshold: 0,
    hub_kme_min: 1.5, hub_gs_min: 0, max_block_size: 100,
  });
  assert.deepEqual(bad, WGCNA_CONFIG_DEFAULTS);
});

test('buildProjectMeta：wgcna_config 落盘且可被母版脚本消费', () => {
  const meta = buildProjectMeta({
    id: 'prj_wgcna', name: 'wgcna 参数化',
    basicInfo: { name: 'wgcna 参数化', disease: 'psoriasis' },
    createdAt: '2026-10-19T00:00:00Z',
    wgcnaConfig: { top_n_genes: 6000, hub_kme_min: 0.7 },
  });
  assert.equal(meta.wgcna_config.top_n_genes, 6000);
  assert.equal(meta.wgcna_config.hub_kme_min, 0.7);
  // 未填的键仍是契约默认值（脚本侧 defaults 同源）
  assert.equal(meta.wgcna_config.min_module_size, WGCNA_CONFIG_DEFAULTS.min_module_size);
  // 完全不传时也有完整配置块
  const plain = buildProjectMeta({
    id: 'prj_wgcna_plain', name: 'x',
    basicInfo: { name: 'x', disease: 'psoriasis' },
    createdAt: '2026-10-19T00:00:00Z',
  });
  assert.deepEqual(plain.wgcna_config, WGCNA_CONFIG_DEFAULTS);
});

test('buildProjectMeta：字段齐全，非法 ID 抛错', () => {
  const meta = buildProjectMeta({ id: 'proj_a', name: '测试项目', description: '说明' });
  assert.equal(meta.project_id, 'proj_a');
  // v2 四段式：name/description 在 basic_info 下
  assert.equal(meta.basic_info.name, '测试项目');
  assert.equal(meta.basic_info.description, '说明');
  assert.equal(meta.schema_version, PROJECT_SCHEMA_VERSION);
  assert.deepEqual(meta.lines, [...LINES]);
  assert.ok(meta.created_at);
  // name 缺省回退到 id
  assert.equal(buildProjectMeta({ id: 'proj_a' }).basic_info.name, 'proj_a');
  assert.throws(() => buildProjectMeta({ id: '../evil' }));
});

test('buildProjectMeta v2 四段式 + 非肿瘤黑名单', () => {
  // 四段式
  const meta = buildProjectMeta({
    id: 'proj_b',
    basicInfo: { name: '脑卒中 Hub 基因', domain: 'Neurovascular', disease: 'Ischemic Stroke', species: 'Homo sapiens', nonTumorVerified: true },
    dataSource: { source: 'GEO', dataType: 'microarray', datasets: [{ gse: 'GSE16561', gpl: 'GPL6883', role: 'train' }], sampleCount: 60, tissue: 'Peripheral Blood' },
    pipelineDag: [{ order: 1, stepId: 'prep_matrix', tool: 'GEOquery', lang: 'R' }],
    aclAndOutput: { members: ['researcher_01'], role: 'owner', expectedFormats: ['png_150dpi', 'tsv_tables'] },
  });
  assert.equal(meta.basic_info.disease, 'Ischemic Stroke');
  assert.equal(meta.data_source.source, 'GEO');
  assert.equal(meta.pipeline_dag.length, 1);
  assert.equal(meta.acl_and_output.expectedFormats.length, 2);

  // 黑名单拦截
  assert.throws(() => buildProjectMeta({ id: 'proj_c', basicInfo: { disease: 'liver cancer' } }), /非肿瘤合规/);
  assert.throws(() => buildProjectMeta({ id: 'proj_c', name: '肿瘤微环境分析' }), /非肿瘤合规/);
});

test('buildProjectMeta：客户备注与参考文献元数据落盘，备注同样走非肿瘤黑名单', () => {
  const meta = buildProjectMeta({
    id: 'proj_d',
    basicInfo: { name: '脑卒中队列', disease: 'Ischemic Stroke' },
    notes: '  希望比较 X 组与 Y 组的差异表达并做通路富集  ',
    references: [
      { name: 'Smith2020.pdf', path: 'refs/aaa-bbb-ccc/Smith2020.pdf', size: 123456 },
    ],
  });
  assert.equal(meta.notes, '希望比较 X 组与 Y 组的差异表达并做通路富集', '备注应去首尾空白后落盘');
  assert.equal(meta.references.length, 1);
  assert.equal(meta.references[0].path, 'refs/aaa-bbb-ccc/Smith2020.pdf');

  // 缺省：备注空串、参考文献空数组（不是 undefined，避免下游取值判空分叉）
  const bare = buildProjectMeta({ id: 'proj_e' });
  assert.equal(bare.notes, '');
  assert.deepEqual(bare.references, []);

  // 非字符串备注一律归零；参考文献非数组归空
  assert.equal(buildProjectMeta({ id: 'proj_f', notes: 123 }).notes, '');
  assert.deepEqual(buildProjectMeta({ id: 'proj_g', references: 'x' }).references, []);

  // 备注是自由文本，同样要被非肿瘤黑名单拦住
  assert.throws(() => buildProjectMeta({ id: 'proj_h', notes: '想做肿瘤免疫微环境分析' }), /非肿瘤合规/);
});

test('buildCreateProjectCommand：含已存在保护、三线子目录、base64 写元数据', () => {
  const meta = buildProjectMeta({ id: 'proj_a' });
  const { command, remoteDir, metaPath } = buildCreateProjectCommand('proj_a', meta);
  assert.equal(remoteDir, `${PROJECTS_ROOT}/proj_a`);
  assert.equal(metaPath, `${PROJECTS_ROOT}/proj_a/${PROJECT_META_FILE}`);
  assert.match(command, /if \[ -e '[^']+' \]; then echo EXISTS; exit 3; fi/, '缺已存在保护');
  for (const line of LINES) {
    assert.ok(command.includes(`${remoteDir}/${line}/processed`), `缺 ${line} 子目录`);
    assert.ok(command.includes(`${remoteDir}/${line}/figures`), `缺 ${line} figures 目录`);
  }
  assert.match(command, /base64 -d > '/, '元数据应 base64 写入防变形');
  assert.match(command, /echo CREATED '/);
  assert.throws(() => buildCreateProjectCommand('..', meta));
});

test('parseProjectMeta：合法 JSON 通过，坏 JSON / 非法 ID 返回 null', () => {
  const good = JSON.stringify({ project_id: 'proj_a', name: 'n' });
  assert.equal(parseProjectMeta(good).project_id, 'proj_a');
  assert.equal(parseProjectMeta('{not json'), null);
  assert.equal(parseProjectMeta('[]'), null);
  assert.equal(parseProjectMeta(JSON.stringify({ project_id: '../x' })), null);
});

test('buildProjectListCommand / buildReadProjectMetaCommand：路径正确', () => {
  assert.ok(buildProjectListCommand().includes(`${PROJECTS_ROOT}`));
  const read = buildReadProjectMetaCommand('proj_a');
  assert.ok(read.includes(`${PROJECTS_ROOT}/proj_a/${PROJECT_META_FILE}`));
  assert.match(read, /base64 -w0/);
  assert.throws(() => buildReadProjectMetaCommand('../x'));
});

// ---------------------------------------------------------------------------
// S24：建项入口严格校验（R11 六条 + R12 联动 + line_id 落盘）
// 只对 buildProjectMetaStrict（建项 API 入口）生效；旧形态 buildProjectMeta 不受影响。
// ---------------------------------------------------------------------------

import { buildProjectMetaStrict } from '../server/project.js';

/** strict happy path 基准 payload（逐字段可裁剪做负路径） */
function strictBase() {
  return {
    id: 'prj_s24',
    lineId: 'line1_bulk',
    basicInfo: { name: 'S24 校验基准', domain: '心脑血管', disease: 'Ischemic Stroke', species: 'Homo sapiens' },
    dataSource: {
      source: 'GEO', dataType: 'microarray', sampleCount: 4, tissue: 'Peripheral Blood',
      datasets: [{ gse: 'GSE16561', gpl: 'GPL6883', role: 'train' }],
    },
    groupingDesign: {
      mode: 'two_group',
      groups: [
        { groupId: 'g1', groupName: '对照', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIds: ['GSM1', 'GSM2'] },
        { groupId: 'g2', groupName: '处理', role: 'disease_stage', stageOrder: 1, colorHex: '#EE0000', sampleIds: ['GSM3', 'GSM4'] },
      ],
      contrasts: [{ name: '处理 vs 对照', case: '处理', ctrl: '对照', isPrimary: true }],
    },
    pipelineDag: [{ order: 1, stepId: 'prep_matrix', tool: 'GEOquery', lang: 'R' }],
  };
}

test('strict：species 非枚举值被拒且 error 点名 species', () => {
  assert.throws(
    () => buildProjectMetaStrict({ ...strictBase(), basicInfo: { ...strictBase().basicInfo, species: 'Homo Sapiens' } }),
    /species/
  );
  assert.throws(
    () => buildProjectMetaStrict({ ...strictBase(), basicInfo: { ...strictBase().basicInfo, species: 'human' } }),
    /species/
  );
});

test('strict：domain 缺失或非枚举被拒且 error 点名 domain', () => {
  const b = strictBase();
  assert.throws(
    () => buildProjectMetaStrict({ ...b, basicInfo: { ...b.basicInfo, domain: '' } }),
    /domain/
  );
  // 旧需求文件里的英文领域名不在枚举（枚举 = portal 下拉七项）
  assert.throws(
    () => buildProjectMetaStrict({ ...b, basicInfo: { ...b.basicInfo, domain: 'Neurovascular' } }),
    /domain/
  );
});

test('strict：dataType 缺失或非 DATA_TYPE 枚举被拒且 error 点名 dataType', () => {
  const b = strictBase();
  assert.throws(
    () => buildProjectMetaStrict({ ...b, dataSource: { ...b.dataSource, dataType: '' } }),
    /dataType/
  );
  assert.throws(
    () => buildProjectMetaStrict({ ...b, dataSource: { ...b.dataSource, dataType: 'bulk' } }),
    /dataType/
  );
});

test('strict：sampleCount 非正整数（0/负数/小数/字符串）被拒且 error 点名 sampleCount', () => {
  const b = strictBase();
  for (const bad of [0, -5, 1.5, '60', '']) {
    assert.throws(
      () => buildProjectMetaStrict({ ...b, dataSource: { ...b.dataSource, sampleCount: bad } }),
      /sampleCount/,
      `sampleCount=${JSON.stringify(bad)} 应被拒`
    );
  }
});

test('strict：contrasts case/ctrl 引用不存在的组名被拒且 error 点名 contrasts', () => {
  const b = strictBase();
  const g = b.groupingDesign;
  assert.throws(
    () => buildProjectMetaStrict({
      ...b,
      groupingDesign: { ...g, contrasts: [{ name: 'c1', case: '不存在的组', ctrl: '对照', isPrimary: true }] },
    }),
    /contrasts/
  );
  assert.throws(
    () => buildProjectMetaStrict({
      ...b,
      groupingDesign: { ...g, contrasts: [{ name: 'c1', case: '处理', ctrl: 'GSM1', isPrimary: true }] },
    }),
    /contrasts/
  );
});

test('strict：contrasts 主对比必须恰好一条（0 条或 2 条都拒）', () => {
  const b = strictBase();
  const g = b.groupingDesign;
  assert.throws(
    () => buildProjectMetaStrict({
      ...b,
      groupingDesign: { ...g, contrasts: [{ name: 'c1', case: '处理', ctrl: '对照', isPrimary: false }] },
    }),
    /主对比/
  );
  assert.throws(
    () => buildProjectMetaStrict({
      ...b,
      groupingDesign: {
        ...g,
        contrasts: [
          { name: 'c1', case: '处理', ctrl: '对照', isPrimary: true },
          { name: 'c2', case: '处理', ctrl: '对照', isPrimary: true },
        ],
      },
    }),
    /主对比/
  );
});

test('strict：R12 联动——DAG 含虚拟敲除而 target_ko_gene 为空被拒，给了则放行', () => {
  const b = strictBase();
  b.pipelineDag = [{ order: 1, stepId: 'virtual_knockout', tool: 'scTenifoldKnk', lang: 'R' }];
  assert.throws(() => buildProjectMetaStrict(b), /含虚拟敲除步骤必须提供靶基因/);
  // line3 的 spatial_knockout 同样受联动约束
  b.pipelineDag = [{ order: 1, stepId: 'spatial_knockout', tool: 'scTenifoldKnk', lang: 'R' }];
  assert.throws(() => buildProjectMetaStrict(b), /含虚拟敲除步骤必须提供靶基因/);
  const ok = buildProjectMetaStrict({
    ...b,
    biologicalPriors: { targetKoGene: ' TNF ' },
  });
  assert.equal(ok.biological_priors.target_ko_gene, 'TNF');
});

test('strict：line_id 缺失或不在三线枚举被拒；合法值落盘 project.json', () => {
  const b = strictBase();
  assert.throws(() => buildProjectMetaStrict({ ...b, lineId: '' }), /line_id/);
  assert.throws(() => buildProjectMetaStrict({ ...b, lineId: 'line9_x' }), /line_id/);
  const meta = buildProjectMetaStrict({ ...b, lineId: 'line2_scrna' });
  assert.equal(meta.line_id, 'line2_scrna');
});

test('兼容性：旧形态 payload 不带 strict 仍能建项，line_id 落 null', () => {
  // project.test.js 旧用例形态：无 species/domain 枚举值、无 lineId、无 contrasts——必须保持可建
  const meta = buildProjectMeta({ id: 'proj_legacy_s24', name: '旧形态', basicInfo: { domain: 'Neurovascular' } });
  assert.equal(meta.basic_info.domain, 'Neurovascular');
  assert.equal(meta.line_id, null);
  // 非 strict 时传合法 lineId 也照常落盘（不做枚举拒绝）
  assert.equal(buildProjectMeta({ id: 'proj_legacy_s24b', lineId: 'line3_spatial' }).line_id, 'line3_spatial');
});

test('strict：完整 intake payload（含 IN_HOUSE 三件套 + 16:9 模板）通过且逐块落盘', () => {
  const meta = buildProjectMetaStrict({
    id: 'prj_s24_inhouse',
    lineId: 'line1_bulk',
    basicInfo: { name: '自有数据', domain: '代谢', species: 'Mus musculus' },
    dataSource: {
      data_source_mode: 'IN_HOUSE_UPLOAD',
      source: '自有数据',
      dataType: 'bulk_rnaseq',
      sampleCount: 6,
      tissue: 'Brain Cortex',
      id_type: 'Ensembl_ID',
      value_scale: 'Raw_Counts',
      uploaded_files: { train_matrix: 'raw_data/counts.tsv' },
    },
    groupingDesign: {
      mode: 'two_group',
      groups: [
        { groupId: 'g1', groupName: '对照', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIds: ['Ctrl_1'] },
        { groupId: 'g2', groupName: '处理', role: 'disease_stage', stageOrder: 1, colorHex: '#EE0000', sampleIds: ['Treat_1'] },
      ],
      contrasts: [{ name: 'c', case: '处理', ctrl: '对照', isPrimary: true }],
    },
    pipelineDag: [{ order: 1, stepId: 'deg_limma', tool: 'limma', lang: 'R' }],
    plotLayoutConfig: { templateId: 'template_16x9' },
    analysisCutoffs: { profile: 'sensitive' },
    biologicalPriors: { focusGenes: ['IL17A'], koFallbackPolicy: 'auto_recommend' },
    experimentalDesign: { isPaired: true, pairMap: { Ctrl_1: 'D1' }, covariates: { batchCol: 'plate', adjustedVariables: ['age'] } },
    validationGroupMapping: { valControlSamples: ['GSM1'], valTreatSamples: ['GSM3'] },
  });
  assert.equal(meta.line_id, 'line1_bulk');
  assert.equal(meta.data_source.data_source_mode, 'IN_HOUSE_UPLOAD');
  assert.equal(meta.data_source.accession_and_platform.train_id, 'LOC_prj_s24_inhouse_TRAIN');
  assert.equal(meta.plot_layout_config.template_id, 'template_16x9');
  assert.equal(meta.analysis_cutoffs.profile, 'sensitive');
  assert.equal(meta.biological_priors.ko_fallback_policy, 'auto_recommend');
  assert.equal(meta.experimental_design.cov.batch_col, 'plate');
  assert.equal(meta.validation_group_mapping.invalid, false);
});
