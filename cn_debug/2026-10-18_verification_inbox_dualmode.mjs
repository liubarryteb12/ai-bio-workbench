// 工作台侧收件箱接口的双模态透传验证。
// 造两份临时需求文件（一份 IN_HOUSE 合法、一份 IN_HOUSE 缺契约），
// 打 /api/portal/inbox/item 看返回的 dataSourceMode / accession，读完即删。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const WB = 8787;
const INBOX = path.resolve('portal/inbox');

function get(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: WB, path: pathname }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
    }).on('error', reject);
  });
}

const groups = [
  { groupName: 'Ctrl', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIds: ['Ctrl_1', 'Ctrl_2'] },
  { groupName: 'Treat', role: 'disease_stage', stageOrder: 1, colorHex: '#EE0000', sampleIds: ['Treat_1', 'Treat_2'] },
];

const base = {
  manifest_version: '1.0',
  submitted_at: new Date().toISOString(),
  basicInfo: { name: '双模态透传自检', domain: '代谢', disease: 'NAFLD', species: 'Mus musculus', nonTumorVerified: true },
  groupingDesign: { mode: 'two_group', groups, contrasts: [{ name: 'Treat_vs_Ctrl', case: 'Treat', ctrl: 'Ctrl', isPrimary: true }] },
  pipelineDag: [{ order: 1, stepId: 'prep_matrix' }],
  aclAndOutput: { expectedFormats: ['png_300dpi'], targetKoGene: '' },
  references: [],
  notes: '',
};

const inhouse = {
  ...base,
  dataSource: {
    data_source_mode: 'IN_HOUSE_UPLOAD', dataType: 'bulk_rnaseq',
    id_type: 'Ensembl_ID', value_scale: 'Raw_Counts', species: 'Mus musculus',
    uploaded_files: { train_matrix: 'raw_data/counts.tsv', val_matrix: null },
    sampleCount: 4, tissue: 'Liver',
  },
};
const broken = JSON.parse(JSON.stringify(inhouse));
delete broken.dataSource.value_scale;

const created = [];
function write(name, obj) {
  const f = path.join(INBOX, name);
  fs.writeFileSync(f, JSON.stringify(obj, null, 2), 'utf8');
  created.push(f);
  return name;
}

const okName = write(`zz_selftest_ok_${Date.now()}.json`, inhouse);
const badName = write(`zz_selftest_bad_${Date.now()}.json`, broken);

const results = [];

// 1) 列表接口应看到两份
const list = await get('/api/portal/inbox');
results.push({ case: '列表接口', status: list.status, count: list.body.items?.length });

// 2) 合法 IN_HOUSE：dataSourceMode + accession
const ok = await get(`/api/portal/inbox/item?name=${encodeURIComponent(okName)}`);
results.push({
  case: 'IN_HOUSE 合法',
  status: ok.status,
  mode: ok.body.dataSourceMode,
  trainId: ok.body.accession?.train_id,
  idType: ok.body.accession?.id_type,
  scale: ok.body.accession?.value_scale,
});

// 3) 缺契约：应 400 且指明缺什么（不能静默当公共数据）
const bad = await get(`/api/portal/inbox/item?name=${encodeURIComponent(badName)}`);
results.push({ case: 'IN_HOUSE 缺 value_scale', status: bad.status, err: (bad.body.error || '').slice(0, 60) });

// 4) 原有真实样例不受影响
const real = await get('/api/portal/inbox');
const realNames = (real.body.items || []).map((i) => i.file).filter((n) => n && !n.startsWith('zz_selftest'));
results.push({ case: '真实样例仍在', status: real.status, samples: realNames.length });

for (const f of created) fs.unlinkSync(f);

console.log(JSON.stringify({ results, cleaned: created.length }, null, 2));
