/**
 * 2026-10-18 验证：参考文献上传 + 备注栏落盘前校验（跑完自清）
 * 覆盖：正常上传 / 扩展名白名单 / 空内容 / 5 篇上限 / 提交时伪造路径拒收 / 合法提交落盘
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8080';
const INBOX = fileURLToPath(new URL('../portal/inbox/', import.meta.url));
const SID = `selftest-${Date.now()}`;
const REF_DIR = path.join(INBOX, 'refs', SID);

async function upload(name, content) {
  const res = await fetch(`${BASE}/api/references?sid=${encodeURIComponent(SID)}&name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: content,
  });
  return { status: res.status, body: await res.json() };
}

const out = {};
out.okUpload = await upload('Smith 2020 脑卒中综述.pdf', Buffer.from('%PDF-1.4 fake pdf body'));
out.badExt = await upload('malware.exe', Buffer.from('MZ'));
out.emptyBody = await upload('empty.pdf', Buffer.alloc(0));

// 5 篇上限：已成功 2 篇（新格式名 + 追加序号），补到 5 篇后再传第 6 篇
for (let i = 1; i <= 4; i += 1) await upload(`ref${i}.pdf`, Buffer.from(`pdf ${i}`));
out.overCap = await upload('ref6.pdf', Buffer.from('pdf 6'));
out.dirFiles = fs.existsSync(REF_DIR) ? fs.readdirSync(REF_DIR) : [];

const base = {
  manifest_version: '1.0',
  submitted_at: new Date().toISOString(),
  basicInfo: { name: '自检_文献与备注', description: '', domain: '心脑血管', disease: '缺血性卒中', species: 'Homo sapiens', contact: '', nonTumorVerified: true },
  dataSource: { source: 'GEO', dataType: 'spatial', datasets: [{ gse: 'GSE00001', gpl: '', role: 'train' }], sampleCount: 3, tissue: 'Brain' },
  groupingDesign: { mode: 'two_group', groups: [], contrasts: [] },
  pipelineDag: [],
  aclAndOutput: { collaborators: [], expectedFormats: [], targetKoGene: '' },
};

async function submit(extra) {
  const res = await fetch(`${BASE}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...base, ...extra }),
  });
  return { status: res.status, body: await res.json() };
}

out.forgedPath = await submit({ references: [{ name: 'x.pdf', path: 'refs/whatever/x.pdf', size: 1 }] });
out.overFive = await submit({ references: Array.from({ length: 6 }, (_, i) => ({ name: `r${i}.pdf`, path: `refs/${SID}/r${i}.pdf`, size: 1 })) });
out.longNotes = await submit({ notes: 'x'.repeat(4001) });
out.valid = await submit({
  references: [{ name: out.okUpload.body.name, path: out.okUpload.body.path, size: out.okUpload.body.size }],
  notes: '关注小胶质细胞极化与神经元损伤的空间共定位，希望做配受体分析。',
});

let saved = null;
if (out.valid.status === 200) {
  const full = path.join(INBOX, out.valid.body.savedAs);
  const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  saved = { notes: parsed.notes, references: parsed.references };
  fs.unlinkSync(full);
}
fs.rmSync(REF_DIR, { recursive: true, force: true });

console.log(JSON.stringify({
  okUpload: { status: out.okUpload.status, path: out.okUpload.body.path, size: out.okUpload.body.size },
  badExt: { status: out.badExt.status, error: out.badExt.body.error },
  emptyBody: { status: out.emptyBody.status, error: out.emptyBody.body.error },
  overCap: { status: out.overCap.status, error: out.overCap.body.error },
  capFileCount: out.dirFiles.length,
  forgedPath: { status: out.forgedPath.status, error: out.forgedPath.body.error },
  overFive: { status: out.overFive.status, error: out.overFive.body.error },
  longNotes: { status: out.longNotes.status, error: out.longNotes.body.error },
  valid: { status: out.valid.status, savedAs: out.valid.body.savedAs },
  saved,
  refDirRemoved: !fs.existsSync(REF_DIR),
  inboxLeft: fs.readdirSync(INBOX).filter((n) => n.endsWith('.json')),
}, null, 2));
