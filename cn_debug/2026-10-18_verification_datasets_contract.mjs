/**
 * 2026-10-18 验证：用户端 serve.mjs 对 datasets 配对的落盘前校验 + 落盘内容
 * 跑完自清：成功落盘的那份需求文件读回确认后即删除，不留痕。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8080';
const INBOX = fileURLToPath(new URL('../portal/inbox/', import.meta.url));

const base = {
  manifest_version: '1.0',
  submitted_at: new Date().toISOString(),
  basicInfo: { name: '自检_配对表契约', description: '', domain: '心脑血管', disease: '缺血性卒中', species: 'Homo sapiens', contact: '', nonTumorVerified: true },
  groupingDesign: { mode: 'two_group', groups: [], contrasts: [] },
  pipelineDag: [],
  aclAndOutput: { collaborators: [], expectedFormats: [], targetKoGene: '' },
};

async function post(payload) {
  const res = await fetch(`${BASE}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

const dsGood = { source: 'GEO', dataType: 'microarray', datasets: [{ gse: 'GSE16561', gpl: 'GPL6883', role: 'train' }, { gse: 'GSE58294', gpl: 'GPL570', role: 'validation' }], sampleCount: 0, tissue: '' };
const results = {};

results.noDatasets = await post({ ...base, dataSource: { source: 'GEO', dataType: 'microarray' } });
results.emptyGse = await post({ ...base, dataSource: { ...dsGood, datasets: [{ gse: 'GSE16561', gpl: 'GPL6883', role: 'train' }, { gse: '  ', gpl: '', role: 'validation' }] } });
results.valid = await post({ ...base, dataSource: dsGood });

let saved = null;
if (results.valid.status === 200 && results.valid.body.savedAs) {
  const full = path.join(INBOX, results.valid.body.savedAs);
  const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  saved = { file: results.valid.body.savedAs, datasets: parsed.dataSource.datasets, dataType: parsed.dataSource.dataType };
  fs.unlinkSync(full);
  saved.deletedAfterCheck = !fs.existsSync(full);
}

const list = await (await fetch(`${BASE}/health`)).json();
console.log(JSON.stringify({
  noDatasets: { status: results.noDatasets.status, error: results.noDatasets.body.error },
  emptyGse: { status: results.emptyGse.status, error: results.emptyGse.body.error },
  valid: { status: results.valid.status, savedAs: results.valid.body.savedAs },
  saved,
  inboxLeft: fs.readdirSync(INBOX).filter((n) => n.endsWith('.json')),
  portalAlive: list.ok,
}, null, 2));
