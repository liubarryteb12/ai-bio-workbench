// 双模态提交契约：向用户端 /api/submit 打两种模式，读回落盘文件后自清。
// 目的：确认 portal + project.js 两侧口径一致，不污染真实收件箱。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 8080;
const INBOX = path.resolve('portal/inbox');

function post(bodyObj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/api/submit', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const groups = [
  { groupName: 'Ctrl', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIds: ['Ctrl_1', 'Ctrl_2'] },
  { groupName: 'Treat', role: 'disease_stage', stageOrder: 1, colorHex: '#EE0000', sampleIds: ['Treat_1', 'Treat_2'] },
];

const base = {
  manifest_version: '1.0',
  submitted_at: new Date().toISOString(),
  basicInfo: { name: '双模态契约自检', domain: '代谢', disease: 'NAFLD', species: 'Mus musculus', nonTumorVerified: true },
  groupingDesign: { mode: 'two_group', groups, contrasts: [{ name: 'Treat_vs_Ctrl', case: 'Treat', ctrl: 'Ctrl', isPrimary: true }] },
  pipelineDag: [{ order: 1, stepId: 'prep_matrix' }],
  aclAndOutput: { expectedFormats: ['png_300dpi'], targetKoGene: '' },
  references: [],
  notes: '',
};

const results = [];
const cleanup = [];

// 1) IN_HOUSE_UPLOAD 合法提交
const inhouse = {
  ...base,
  dataSource: {
    data_source_mode: 'IN_HOUSE_UPLOAD',
    dataType: 'bulk_rnaseq',
    id_type: 'Ensembl_ID',
    value_scale: 'Raw_Counts',
    species: 'Mus musculus',
    uploaded_files: { train_matrix: 'raw_data/mouse_cortex_counts.tsv', val_matrix: null },
    sampleCount: 4,
    tissue: 'Liver',
  },
};
const r1 = await post(inhouse);
results.push({ case: 'IN_HOUSE_UPLOAD 合法', status: r1.status, savedAs: r1.body.savedAs });

// 2) IN_HOUSE_UPLOAD 缺 id_type
const noIdType = JSON.parse(JSON.stringify(inhouse));
delete noIdType.dataSource.id_type;
const r2 = await post(noIdType);
results.push({ case: 'IN_HOUSE 缺 id_type（应 400）', status: r2.status, err: r2.body.error });

// 3) IN_HOUSE_UPLOAD 非 GSM 样本编号（公共库会拒，自有应放行）
const r3 = await post(inhouse);
results.push({ case: 'IN_HOUSE 自定样本编号（应 200）', status: r3.status });

// 4) PUBLIC_DB 用 Ctrl_1 这类非 GSM 编号（应被拒）
const publicBadSamples = JSON.parse(JSON.stringify(base));
publicBadSamples.dataSource = {
  data_source_mode: 'PUBLIC_DB', source: 'GEO', dataType: 'microarray',
  datasets: [{ gse: 'GSE16561', gpl: 'GPL6883', role: 'train' }], sampleCount: 4, tissue: 'Skin',
};
const r4 = await post(publicBadSamples);
results.push({ case: 'PUBLIC_DB 非 GSM 样本（应 400）', status: r4.status, err: (r4.body.error || '').slice(0, 80) });

// 5) PUBLIC_DB 合法（GSM 编号）
const publicOk = JSON.parse(JSON.stringify(publicBadSamples));
publicOk.groupingDesign.groups[0].sampleIds = ['GSM1', 'GSM2'];
publicOk.groupingDesign.groups[1].sampleIds = ['GSM3', 'GSM4'];
const r5 = await post(publicOk);
results.push({ case: 'PUBLIC_DB GSM 合法（应 200）', status: r5.status });

// 清理本次落盘文件
for (const f of fs.readdirSync(INBOX)) {
  if (f.includes('双模态契约自检')) { fs.unlinkSync(path.join(INBOX, f)); cleanup.push(f); }
}

console.log(JSON.stringify({ results, cleanup }, null, 2));
