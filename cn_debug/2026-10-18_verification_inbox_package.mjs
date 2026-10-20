/**
 * 工作台收件箱兼容验证：同时识别旧平铺 JSON 与新 PKG_ 包目录。
 *
 * 为什么要验：包结构变了，但对接人的工作台是另一套进程。若它只会扫根目录 *.json，
 * 新提交的需求会在列表里凭空消失——比报错更难发现。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8787';
const INBOX = fileURLToPath(new URL('../portal/inbox/', import.meta.url));
const PKG = 'PKG_2026-10-18_230000_收件箱兼容验证';

let failed = 0;
function check(label, cond, detail = '') {
  if (!cond) failed += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${label}${detail ? ' | ' + detail : ''}`);
}

const pkgRoot = path.join(INBOX, PKG);
fs.mkdirSync(path.join(pkgRoot, 'references'), { recursive: true });
fs.mkdirSync(path.join(pkgRoot, 'raw_data'), { recursive: true });

const requirement = {
  manifest_version: '1.0',
  basicInfo: { name: '收件箱兼容验证', disease: 'Psoriasis', species: 'Homo sapiens' },
  dataSource: {
    dataType: 'microarray',
    data_source_mode: 'PUBLIC_DB',
    datasets: [{ gse: 'GSE277173', gpl: 'GPL11532', role: 'train' }],
  },
  groupingDesign: {
    mode: 'two_group',
    groups: [
      { groupName: 'Control', role: 'reference', stageOrder: 0, sampleIds: ['GSM8515001'] },
      { groupName: 'Disease', role: 'disease_stage', stageOrder: 1, sampleIds: ['GSM8515002'] },
    ],
  },
  pipelineDag: [{ order: 1, stepId: 'deg_limma' }],
  references: [{ name: 'ref.pdf', path: `${PKG}/references/01_ref.pdf`, size: 12 }],
  dataFiles: [{ role: 'train_matrix', bind: 'GSE277173', name: 'm.txt',
    path: `${PKG}/raw_data/train_matrix__GSE277173__m.txt`, size: 34 }],
  package_dir: PKG,
  notes: '兼容验证',
};
fs.writeFileSync(path.join(pkgRoot, 'requirement.json'), JSON.stringify(requirement, null, 2), 'utf8');
fs.writeFileSync(path.join(pkgRoot, 'package_manifest.json'), JSON.stringify({
  package_version: '1.0', package_dir: PKG, created_at: new Date().toISOString(),
  project_name: '收件箱兼容验证',
  counts: { references: 1, data_files: 1 },
  references: [{ original_name: 'ref.pdf', archive_name: '01_ref.pdf' }],
  data_files: [{ role: 'train_matrix', bind: 'GSE277173', archive_name: 'train_matrix__GSE277173__m.txt' }],
}, null, 2), 'utf8');

try {
  const listRes = await fetch(`${BASE}/api/portal/inbox`);
  const list = await listRes.json();
  check('列表接口 200', listRes.status === 200, String(listRes.status));
  check('未 blocked', list.blocked === false, JSON.stringify(list.reason || ''));

  const pkgItem = (list.items || []).find((i) => i.file === `${PKG}/requirement.json`);
  check('新包出现在列表里', !!pkgItem, JSON.stringify((list.items || []).map((i) => i.file)));
  check('包项带 packageDir', pkgItem?.packageDir === PKG, pkgItem?.packageDir || '');
  check('包项带附件计数',
    pkgItem?.attachments?.references === 1 && pkgItem?.attachments?.data_files === 1,
    JSON.stringify(pkgItem?.attachments || null));
  check('包项解析出项目名', pkgItem?.summary?.name === '收件箱兼容验证', pkgItem?.summary?.name || '');

  const legacy = (list.items || []).find((i) => /^2026-10-15_.*\.json$/.test(i.file));
  check('旧平铺 JSON 仍在列表里', !!legacy, legacy?.file || '未找到');
  check('旧格式 packageDir 为 null', legacy?.packageDir === null);

  const itemRes = await fetch(`${BASE}/api/portal/inbox/item?name=${encodeURIComponent(`${PKG}/requirement.json`)}`);
  const item = await itemRes.json();
  check('详情接口 200', itemRes.status === 200, String(itemRes.status));
  check('详情返回 packageManifest', !!item.packageManifest, String(!!item.packageManifest));
  check('详情 packageDir 正确', item.packageDir === PKG, item.packageDir || '');
  check('详情透传 dataFiles', Array.isArray(item.manifest?.dataFiles) && item.manifest.dataFiles.length === 1);

  // 路径穿越必须仍被拒
  const evil = await fetch(`${BASE}/api/portal/inbox/item?name=${encodeURIComponent('../serve.mjs')}`);
  check('路径穿越仍被拒', evil.status === 400, String(evil.status));
} finally {
  fs.rmSync(pkgRoot, { recursive: true, force: true });
}

console.log(failed === 0 ? '\n全部符合预期' : `\n${failed} 条不符合预期`);
process.exitCode = failed === 0 ? 0 : 1;
