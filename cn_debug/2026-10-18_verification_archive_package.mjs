/**
 * 提交包归档端到端验证（真实 HTTP + 真实磁盘）。
 *
 * 验证两件事：
 *   1. 一次提交生成一个 PKG_ 目录，文献与数据文件随包重命名并落到子目录；
 *   2. 上传文件名与用户填写名称不一致时被拒绝（这是用户明确要求的校验）。
 *
 * 脚本自己造文件、自己清理，不碰收件箱里既有的真实样例。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8080';
const INBOX = fileURLToPath(new URL('../portal/inbox/', import.meta.url));
const SID = `sidverify${Date.now().toString(36)}`;

let failed = 0;
function check(label, cond, detail = '') {
  if (!cond) failed += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${label}${detail ? ' | ' + detail : ''}`);
}

async function upload(endpoint, params, body, contentType = 'application/octet-stream') {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${endpoint}?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function submit(payload) {
  const res = await fetch(`${BASE}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

const before = new Set(fs.existsSync(INBOX) ? fs.readdirSync(INBOX) : []);

// ---------- 造三个文件：训练矩阵、样本表、参考文献 ----------
const trainTsv = 'gene\tS1\tS2\nIL17A\t10\t12\nS100A8\t3\t5\n';
const sheetCsv = 'sample,group\nS1,Control\nS2,Disease\n';
const refTxt = 'A fake reference paper for archive verification.\n';

// ---------- 正向：完整提交 ----------
const upTrain = await upload('/api/datafiles',
  { sid: SID, role: 'train_matrix', bind: 'GSE277173', name: 'series_matrix.txt' }, trainTsv);
check('数据文件上传（训练矩阵）', upTrain.status === 200 && upTrain.body.ok,
  `${upTrain.status} ${upTrain.body.error || upTrain.body.storedName || ''}`);

const upSheet = await upload('/api/datafiles',
  { sid: SID, role: 'sample_sheet', bind: '', name: 'groups.csv' }, sheetCsv);
check('数据文件上传（样本表）', upSheet.status === 200 && upSheet.body.ok,
  `${upSheet.status} ${upSheet.body.error || ''}`);

const upRef = await upload('/api/references',
  { sid: SID, name: 'Nature2024_psoriasis.pdf' }, refTxt);
check('参考文献上传', upRef.status === 200 && upRef.body.ok,
  `${upRef.status} ${upRef.body.error || ''}`);

const payload = {
  manifest_version: '1.0',
  basicInfo: { name: '归档验证项目', disease: 'Psoriasis', species: 'Homo sapiens' },
  dataSource: {
    dataType: 'microarray',
    data_source_mode: 'PUBLIC_DB',
    datasets: [
      { gse: 'GSE277173', gpl: 'GPL11532', role: 'train' },
      { gse: 'GSE13355', gpl: 'GPL570', role: 'validation' },
    ],
  },
  groupingDesign: {
    mode: 'two_group',
    groups: [
      { groupName: 'Control', role: 'reference', stageOrder: 0, sampleIds: ['GSM8515001'] },
      { groupName: 'Disease', role: 'disease_stage', stageOrder: 1, sampleIds: ['GSM8515002'] },
    ],
  },
  pipelineDag: [{ order: 1, stepId: 'deg_limma' }],
  references: [{ name: upRef.body.name, path: upRef.body.path, size: upRef.body.size }],
  dataFiles: [
    { role: 'train_matrix', bind: 'GSE277173', name: upTrain.body.name,
      path: upTrain.body.path, size: upTrain.body.size },
    { role: 'sample_sheet', bind: '', name: upSheet.body.name,
      path: upSheet.body.path, size: upSheet.body.size },
  ],
  uploadSid: SID,
  notes: '归档验证',
};

const res = await submit(payload);
check('提交成功', res.status === 200 && res.body.ok, `${res.status} ${res.body.error || ''}`);
const pkgDir = res.body.savedAs || '';
check('返回包目录名（PKG_ 前缀）', /^PKG_/.test(pkgDir), pkgDir);
check('包目录含项目名', pkgDir.includes('归档验证项目'), pkgDir);

const pkgRoot = path.join(INBOX, pkgDir);
check('包目录已创建', fs.existsSync(pkgRoot), pkgRoot);
check('requirement.json 存在', fs.existsSync(path.join(pkgRoot, 'requirement.json')));
check('package_manifest.json 存在', fs.existsSync(path.join(pkgRoot, 'package_manifest.json')));

const refDir = path.join(pkgRoot, 'references');
const rawDir = path.join(pkgRoot, 'raw_data');
check('references/ 存在', fs.existsSync(refDir));
check('raw_data/ 存在', fs.existsSync(rawDir));

const refFiles = fs.existsSync(refDir) ? fs.readdirSync(refDir) : [];
const rawFiles = fs.existsSync(rawDir) ? fs.readdirSync(rawDir) : [];
check('参考文献已按序号重命名', refFiles.includes('01_Nature2024_psoriasis.pdf'), JSON.stringify(refFiles));
check('训练矩阵归档名含角色与 GSE',
  rawFiles.includes('train_matrix__GSE277173__series_matrix.txt'), JSON.stringify(rawFiles));
check('样本表归档名含角色',
  rawFiles.includes('sample_sheet__groups.csv'), JSON.stringify(rawFiles));

// requirement.json 里的路径必须是包内相对路径，且文件真实存在
const reqJson = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'requirement.json'), 'utf8'));
check('requirement.references[0].path 指向包内',
  reqJson.references?.[0]?.path === `${pkgDir}/references/01_Nature2024_psoriasis.pdf`,
  reqJson.references?.[0]?.path || '');
check('requirement.dataFiles[0].path 指向包内 raw_data',
  reqJson.dataFiles?.[0]?.path === `${pkgDir}/raw_data/train_matrix__GSE277173__series_matrix.txt`,
  reqJson.dataFiles?.[0]?.path || '');
check('requirement 不再包含 uploadSid', !('uploadSid' in reqJson));
check('requirement 记录了 package_dir', reqJson.package_dir === pkgDir);

// 清单里的 sha256 必须与磁盘内容一致（否则"归档完整性"是假的）
const manifest = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package_manifest.json'), 'utf8'));
check('清单计数正确',
  manifest.counts?.references === 1 && manifest.counts?.data_files === 2,
  JSON.stringify(manifest.counts));
const trainEntry = (manifest.data_files || []).find((f) => f.role === 'train_matrix');
const diskHash = crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(pkgRoot, 'raw_data', trainEntry?.archive_name || '')))
  .digest('hex');
check('清单 sha256 与磁盘一致', trainEntry?.sha256 === diskHash);

// 暂存目录必须清干净
check('暂存目录 uploads/<sid> 已清理', !fs.existsSync(path.join(INBOX, 'uploads', SID)));
check('暂存目录 refs/<sid> 已清理', !fs.existsSync(path.join(INBOX, 'refs', SID)));

// ---------- 负向：IN_HOUSE 文件名与填写不一致 ----------
const SID2 = `${SID}b`;
await upload('/api/datafiles', { sid: SID2, role: 'train_matrix', bind: '', name: 'wrong_name.tsv' }, trainTsv);
const badInHouse = await submit({
  basicInfo: { name: '归档验证-不一致', species: 'Homo sapiens' },
  dataSource: {
    dataType: 'bulk_rnaseq',
    data_source_mode: 'IN_HOUSE_UPLOAD',
    id_type: 'Gene_Symbol',
    value_scale: 'Raw_Counts',
    uploaded_files: { train_matrix: 'raw_data/mouse_cortex.tsv', val_matrix: null },
  },
  groupingDesign: {
    mode: 'two_group',
    groups: [
      { groupName: 'Control', role: 'reference', stageOrder: 0, sampleIds: ['Ctrl_1'] },
      { groupName: 'Disease', role: 'disease_stage', stageOrder: 1, sampleIds: ['Case_1'] },
    ],
  },
  dataFiles: [{ role: 'train_matrix', bind: '', name: 'wrong_name.tsv', path: `uploads/${SID2}/train_matrix__wrong_name.tsv`, size: trainTsv.length }],
  uploadSid: SID2,
});
check('文件名与填写不一致时提交被拒', badInHouse.status === 400,
  `${badInHouse.status} ${badInHouse.body.error || ''}`);
check('错误信息点名不一致', /不一致/.test(badInHouse.body.error || ''), badInHouse.body.error || '');

// ---------- 负向：PUBLIC_DB 绑定编号与文件名冲突 ----------
const SID3 = `${SID}c`;
await upload('/api/datafiles', { sid: SID3, role: 'train_matrix', bind: 'GSE277173', name: 'GSE13355_matrix.txt' }, trainTsv);
const badBind = await submit({
  basicInfo: { name: '归档验证-编号冲突', species: 'Homo sapiens' },
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
  dataFiles: [{ role: 'train_matrix', bind: 'GSE277173', name: 'GSE13355_matrix.txt',
    path: `uploads/${SID3}/train_matrix__GSE277173__GSE13355_matrix.txt`, size: trainTsv.length }],
  uploadSid: SID3,
});
check('文件名 GSE 与绑定编号冲突时被拒', badBind.status === 400,
  `${badBind.status} ${badBind.body.error || ''}`);

// ---------- 清理 ----------
for (const sid of [SID2, SID3]) {
  fs.rmSync(path.join(INBOX, 'uploads', sid), { recursive: true, force: true });
  fs.rmSync(path.join(INBOX, 'refs', sid), { recursive: true, force: true });
}
if (pkgDir) fs.rmSync(pkgRoot, { recursive: true, force: true });
// refs/ 与 uploads/ 是暂存结构目录，首次上传时会自动创建，不算残留；
// 要检查的是"没有留下 PKG_ 包或 JSON 文件"
const created = fs.readdirSync(INBOX).filter((n) => !before.has(n) && n !== 'refs' && n !== 'uploads');
check('本次验证未在收件箱留下残留', created.length === 0, JSON.stringify(created));
for (const sub of ['refs', 'uploads']) {
  const dir = path.join(INBOX, sub);
  const left = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  check(`暂存目录 ${sub}/ 已清空`, left.length === 0, JSON.stringify(left));
}

console.log(failed === 0 ? '\n全部符合预期' : `\n${failed} 条不符合预期`);
process.exitCode = failed === 0 ? 0 : 1;
