/**
 * 端到端验证 · 第 1 段：客户端（用户端 8080）提交真实需求 + 真实数据文件。
 *
 * 真实数据：test_use_data/测试数据3（可用）
 *   GSE277173 银屑病皮损 vs 非皮损，8v8 配对（13L/13NL … 21L/21NL），GPL11532 芯片。
 *
 * 走的是用户端真实 HTTP 契约：
 *   POST /api/datafiles?sid&role&bind&name  （二进制流）
 *   POST /api/submit                        （需求 + 归档成包）
 *
 * 输出：提交包目录名与包内清单，供第 2 段（工作台建项）使用。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = 'http://127.0.0.1:8080';
const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'test_use_data', '测试数据3（可用）');

const sid = 'e2e' + crypto.randomBytes(6).toString('hex');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
};

const FILES = [
  { role: 'train_matrix', bind: 'GSE277173', name: 'GSE277173_series_matrix.txt.gz' },
  { role: 'platform_annotation', bind: '', name: 'GPL11532-32230.txt' },
  { role: 'group_map', bind: '', name: '分组情况.txt' },
];

async function uploadOne(file) {
  const full = path.join(DATA_DIR, file.name);
  const buf = fs.readFileSync(full);
  const url = `${BASE}/api/datafiles?sid=${encodeURIComponent(sid)}`
    + `&role=${encodeURIComponent(file.role)}`
    + `&bind=${encodeURIComponent(file.bind)}`
    + `&name=${encodeURIComponent(file.name)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buf,
  });
  const payload = await res.json();
  check(`上传 ${file.name}（${(buf.length / 1024 / 1024).toFixed(1)} MB）`,
    res.status === 200 && payload.ok === true, payload.error || payload.path || '');
  return payload.ok ? { ...file, path: payload.path, size: payload.size } : null;
}

// 分组：来自 分组情况.txt（LS 8 例 / NLS 8 例，按供体 13-21 配对）
const LS = ['GSM8515887', 'GSM8515889', 'GSM8515891', 'GSM8515893',
  'GSM8515895', 'GSM8515897', 'GSM8515899', 'GSM8515901'];
const NLS = ['GSM8515888', 'GSM8515890', 'GSM8515892', 'GSM8515894',
  'GSM8515896', 'GSM8515898', 'GSM8515900', 'GSM8515902'];
const pairMap = {};
for (let i = 0; i < LS.length; i += 1) {
  const donor = `Donor_${String(13 + i)}`;
  pairMap[LS[i]] = donor;
  pairMap[NLS[i]] = donor;
}

const manifest = {
  manifest_version: '1.0',
  basicInfo: {
    name: 'GSE277173 银屑病皮损非皮损 Bulk 真实数据验证',
    description: '端到端验证：真实 GEO 芯片数据，8v8 配对设计，GPL11532 注释',
    domain: '皮肤与免疫外炎症',
    disease: 'Psoriasis',
    species: 'Homo sapiens',
    contact: 'e2e@local',
    nonTumorVerified: true,
  },
  dataSource: {
    dataType: 'microarray',
    sampleCount: 16,
    tissue: 'Skin Lesion and Non-lesional Skin',
    species: 'Homo sapiens',
    data_source_mode: 'PUBLIC_DB',
    source: 'GEO',
    datasets: [{
      gse: 'GSE277173',
      gpl: 'GPL11532',
      role: 'train',
      dataType: 'microarray',
      sampleCount: 16,
      tissue: 'Skin Lesion and Non-lesional Skin',
    }],
  },
  groupingDesign: {
    mode: 'two_group',
    groups: [
      { groupId: 'g1', groupName: 'NLS', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIds: NLS },
      { groupId: 'g2', groupName: 'LS', role: 'disease_stage', stageOrder: 1, colorHex: '#EE0000', sampleIds: LS },
    ],
    contrasts: [{ name: 'LS_vs_NLS', case: 'LS', ctrl: 'NLS', isPrimary: true }],
  },
  pipelineDag: [
    'prep_matrix', 'qc_matrix', 'pca_matrix', 'deg_limma', 'wgcna_modules',
    'enrichment_bulk', 'enrichment_figures', 'ppi_string', 'key_genes',
    'ml_hub_analysis', 'bulk_figures',
  ].map((stepId, i) => ({ order: i + 1, stepId, lang: '', enabled: true })),
  aclAndOutput: {
    owner: 'e2e_runner',
    collaborators: [],
    expectedFormats: ['png_300dpi', 'tsv_tables', 'rds_checkpoint', 'audit_json'],
  },
  biologicalPriors: {
    focusGenes: ['IL17A', 'S100A8', 'S100A9'],
    targetKoGene: '',
    koFallbackPolicy: 'strict_abort',
  },
  analysisCutoffs: { profile: 'standard_sci', maxMtPercent: 15 },
  plotLayoutConfig: { templateId: 'template_2_cell_wide' },
  experimentalDesign: { isPaired: true, pairMap, covariates: { batchCol: '', adjustedVariables: [] } },
  validationGroupMapping: null,
  references: [],
  dataFiles: [],
  uploadSid: sid,
  notes: '真实数据端到端验证；8v8 同一供体配对（13-21）。',
};

async function main() {
  const health = await (await fetch(`${BASE}/health`)).json();
  check('用户端服务在线', health.ok === true, `${health.service} @ ${health.port}`);
  if (!health.ok) throw new Error('用户端未启动');

  const uploaded = [];
  for (const f of FILES) {
    const item = await uploadOne(f);
    if (item) uploaded.push(item);
  }
  check('三个数据文件全部上传成功', uploaded.length === 3, `${uploaded.length}/3`);

  manifest.dataFiles = uploaded.map((u) => ({
    role: u.role, bind: u.bind, name: u.name, path: u.path, size: u.size,
  }));

  const res = await fetch(`${BASE}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  const payload = await res.json();
  check('需求提交并归档成包', res.status === 200 && payload.ok === true, payload.error || payload.savedAs || '');

  if (payload.ok) {
    const pkgDir = path.join(ROOT, 'portal', 'inbox', payload.savedAs);
    const reqFile = path.join(pkgDir, 'requirement.json');
    const manFile = path.join(pkgDir, 'package_manifest.json');
    check('包内 requirement.json 存在', fs.existsSync(reqFile));
    check('包内 package_manifest.json 存在', fs.existsSync(manFile));
    const saved = JSON.parse(fs.readFileSync(reqFile, 'utf8'));
    check('需求保留行级三元组', saved.dataSource.datasets[0].dataType === 'microarray'
      && saved.dataSource.datasets[0].sampleCount === 16, JSON.stringify(saved.dataSource.datasets[0]));
    check('需求保留配对设计（8 对）', Object.keys(saved.experimentalDesign.pairMap).length === 16,
      `${Object.keys(saved.experimentalDesign.pairMap).length} 个样本有配对编号`);
    const pkg = JSON.parse(fs.readFileSync(manFile, 'utf8'));
    check('包清单记录 3 个数据文件', pkg.counts.data_files === 3, JSON.stringify(pkg.counts));
    console.log('\nPACKAGE=' + payload.savedAs);
    console.log('FILES=' + JSON.stringify(pkg.data_files.map((d) => ({ role: d.role, archive: d.archive_name }))));
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果：${pass}/${results.length} 通过`);
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((cause) => {
  console.error('脚本异常:', cause);
  process.exitCode = 1;
});
