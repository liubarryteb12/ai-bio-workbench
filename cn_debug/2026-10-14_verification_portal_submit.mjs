/**
 * portal 收件接口冒烟验证（2026-10-14）
 * 验证 /api/submit 落盘到 portal/inbox/，且不依赖工作台。
 */
const BASE = 'http://127.0.0.1:8080';

const payload = {
  manifest_version: '1.0',
  submitted_at: new Date().toISOString(),
  basicInfo: {
    name: '测试项目_缺血性脑卒中',
    description: 'smoke test',
    domain: '心脑血管',
    disease: 'Ischemic Stroke',
    species: 'Homo sapiens',
    contact: 't@example.com',
    nonTumorVerified: true,
  },
  dataSource: { source: 'GEO', trainGse: ['GSE16561'], valGse: [], gpl: ['GPL6883'], sampleCount: 60, tissue: 'Peripheral Blood' },
  groupingDesign: {
    mode: 'two_group',
    groups: [
      { groupName: 'Control', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIds: ['GSM1', 'GSM2'] },
      { groupName: 'Disease', role: 'disease_stage', stageOrder: 1, colorHex: '#EE0000', sampleIds: ['GSM3', 'GSM4'] },
    ],
    contrasts: [{ name: 'Disease_vs_Control', case: 'Disease', ctrl: 'Control', isPrimary: true }],
  },
  pipelineDag: [{ order: 1, stepId: 'prep_matrix' }],
  aclAndOutput: { collaborators: [], expectedFormats: ['png_300dpi', 'tsv_tables'], targetKoGene: '' },
};

// 1) 正常提交
const ok = await fetch(`${BASE}/api/submit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
console.log('[1] POST /api/submit ->', ok.status, await ok.text());

// 2) 非法 JSON
const bad = await fetch(`${BASE}/api/submit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{not json',
});
console.log('[2] POST 非法 JSON ->', bad.status, await bad.text());

// 3) GET 方法不应被收件处理
const get = await fetch(`${BASE}/api/submit`);
console.log('[3] GET /api/submit ->', get.status);

// 4) health 应暴露 inbox 路径
const health = await fetch(`${BASE}/health`);
console.log('[4] GET /health ->', health.status, await health.text());
