/**
 * S19 真链验证：portal「数据文件上传」UI（IN_HOUSE_UPLOAD 自有数据）
 *
 * 背景：服务端契约（POST /api/datafiles + /api/submit 的 dataFiles/uploadSid）早已就绪，
 * 缺的只是 portal/index.html 前端。本探针验证新 UI 与既有服务端契约对齐，且不破坏
 * PUBLIC_DB 老路径。
 *
 * 做法（两层，都是真执行，不是静态阅读）：
 *   第 0 层「UI 真码」：用正则从 portal/index.html 抽出 newUploadSid / DATA_* / ROLE_BIND_POLICY /
 *     dfPrecheck / dfSubmitProblem / buildManifest / parseSamples 的**真实源码**，配桩执行，
 *     并用 Node 侧 import 的 portal/lib/archive.mjs 真值逐项比对（UI 与服务端同值）。
 *     提交用的 payload 不是手写的 JSON，而是这份真 buildManifest 跑出来的产物。
 *   第 1~4 层「真 HTTP」：起真进程（PORTAL_PORT 空闲端口 + PORTAL_INBOX 临时目录），
 *     打真上传 / 真提交，断言落盘、PKG_ 包、manifest 条目与各条负路径 400。
 *
 * 未覆盖（无浏览器环境，不做推断）：
 *   - 真实浏览器里的点击 / 下拉联动 / 文件选择框交互
 *   - 1 GiB 上限只做规则断言（dfPrecheck 分支），不真传 1 GiB
 *
 * 复跑：node cn_debug/2026-10-20_verification_s19_portal_upload.mjs
 * 退出码：0 = 全过；1 = 有失败（末尾打印汇总）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  DATA_ROLES as SRV_DATA_ROLES,
  DATA_EXT as SRV_DATA_EXT,
  MAX_DATA_BYTES as SRV_MAX_DATA_BYTES,
  MAX_DATA_FILES_PER_ROLE as SRV_MAX_PER_ROLE,
} from '../portal/lib/archive.mjs';

const REPO = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const INDEX_HTML = path.join(REPO, 'portal', 'index.html');
const PORTAL = path.join(REPO, 'portal', 'serve.mjs');
const HTML = fs.readFileSync(INDEX_HTML, 'utf8');
// serve.mjs:36 的同一份正则（该文件不导出它，故照抄；负路径 3.3 会用真服务端再验一次）
const SID_RE = /^[A-Za-z0-9_-]{6,64}$/;

// ---------------------------------------------------------------- 小结账
const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { results.push([true, name]); console.log('  ✔ ' + name); })
    .catch((e) => { results.push([false, name + ' :: ' + (e && e.message)]); console.log('  ✘ ' + name + '\n      ' + (e && e.message)); });
}

// ---------------------------------------------------------------- 源码抽取（字符串/注释感知的括号配平）
function balancedEnd(src, openIdx) {
  let depth = 0;
  let str = null;
  let line = false;
  let block = false;
  for (let i = openIdx; i < src.length; i += 1) {
    const c = src[i];
    const n = src[i + 1];
    const p = src[i - 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i += 1; } continue; }
    if (str) { if (c === str && p !== '\\') str = null; continue; }
    if (c === '/' && n === '/') { line = true; i += 1; continue; }
    if (c === '/' && n === '*') { block = true; i += 1; continue; }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('括号不配平');
}
function grabFn(src, name) {
  const kw = 'function ' + name + '(';
  const start = src.indexOf(kw);
  assert.ok(start >= 0, 'index.html 中找不到 ' + kw);
  return src.slice(start, balancedEnd(src, src.indexOf('{', start)) + 1);
}
function grabVar(src, name) {
  const kw = 'var ' + name + ' =';
  const start = src.indexOf(kw);
  assert.ok(start >= 0, 'index.html 中找不到 ' + kw);
  const eq = src.indexOf('=', start + kw.length - 1);
  const end = balancedEnd(src, eq + 1);
  let tail = src.indexOf(';', end);
  if (tail < 0) tail = src.length;
  return src.slice(start, tail + 1);
}
function loadConsts(src, names) {
  const body = names.map((n) => grabVar(src, n)).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\n;return {${names.join(',')}};`)();
}

// ---------------------------------------------------------------- UI 桩
const uiState = {
  datasets: [
    { id: 'd1', gse: 'GSE277173', gpl: 'GPL11532', role: 'train' },
    { id: 'd2', gse: 'GSE13355', gpl: 'GPL570', role: 'validation' },
  ],
  dataFiles: [],
  dataSourceMode: 'IN_HOUSE_UPLOAD',
  uploadSid: 'u0123456789ab',
  refs: [],
  groups: [{ name: 'Control', role: 'reference', order: 0, color: '#3B4992', samples: 'GSM1,GSM2' },
    { name: 'Disease', role: 'disease_stage', order: 1, color: '#EE0000', samples: 'GSM3' }],
  contrasts: [],
  selected: { prep_matrix: true, qc_matrix: true },
  output: { web_preview: true, tsv_tables: true, pdf_vector: false, checkpoint_archive: true, audit_ledger: true },
};
const uiVals = {
  'f-name': 'S19 验证项目', 'f-desc': '验证数据文件上传 UI', 'f-domain': '免疫', 'f-disease': 'Sepsis',
  'f-species': 'Homo sapiens', 'f-contact': '', 'f-sample-count': '12', 'f-tissue': 'Blood',
  'f-source': 'GEO', 'f-datatype': 'microarray', 'f-notes': '契约验证备注', 'f-layout': 'template_4x3',
};
const stub$ = (id) => (id === 'f-group-mode' ? { value: 'two_group' } : { value: uiVals[id] || '' });
const stubVal = (id) => (uiVals[id] || '');
const stubDoc = { querySelector: (sel) => (sel === 'input[name="lineId"]:checked' ? { value: 'line1_bulk' } : null) };

// ---------------------------------------------------------------- 起真服务
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}
const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;
const INBOX = fs.mkdtempSync(path.join(os.tmpdir(), 's19_inbox_'));
const child = spawn(process.execPath, [PORTAL], {
  env: { ...process.env, PORTAL_PORT: String(PORT), PORTAL_INBOX: INBOX },
  stdio: 'ignore',
});
const cleanup = () => { try { child.kill(); } catch {} try { fs.rmSync(INBOX, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

const deadline = Date.now() + 10000;
let up = false;
while (Date.now() < deadline) {
  try { const r = await fetch(`${BASE}/health`); if (r.ok) { up = true; break; } } catch { /* 未起 */ }
  await new Promise((r) => setTimeout(r, 150));
}

// ---------------------------------------------------------------- 与 UI 同构造的上传调用
async function uiUpload(sid, role, bind, fileName, bytes) {
  const url = `${BASE}/api/datafiles?sid=${encodeURIComponent(sid)}&role=${encodeURIComponent(role)}`
    + `&bind=${encodeURIComponent(bind)}&name=${encodeURIComponent(fileName)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
async function uiSubmit(payload) {
  const res = await fetch(`${BASE}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

console.log(`\n[S19] portal 真链验证  port=${PORT}  inbox=${INBOX}`);

// ================================================================ 第 0 层：UI 真码
console.log('\n—— 第 0 层：从 index.html 抽真码执行 + 与 archive.mjs 真值比对 ——');

await check('0.0 服务就绪且收件箱指向临时目录（不碰真实 portal/inbox）', async () => {
  assert.equal(up, true, 'portal 未在 10s 内就绪');
  const h = await (await fetch(`${BASE}/health`)).json();
  assert.equal(h.inbox, INBOX, 'inbox 未隔离');
});

await check('0.1 内联脚本整体可编译（无 JS 语法错误）', async () => {
  const m = HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, '页面中没有内联 <script>');
  // eslint-disable-next-line no-new-func
  new Function(m[1]); // 只编译不执行
});

await check('0.2 newUploadSid()：形如 u + 12 位十六进制且过服务端 SID_RE', async () => {
  const mk = new Function('window', `${grabFn(HTML, 'newUploadSid')}\n;return newUploadSid;`);
  const withCrypto = mk({ crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i += 1) a[i] = i; return a; } } })();
  const fallback = mk({})();
  assert.match(withCrypto, /^u[0-9a-f]{12}$/, `crypto 分支产物异常: ${withCrypto}`);
  assert.match(fallback, /^u[0-9a-f]{12}$/, `降级分支产物异常: ${fallback}`);
  assert.ok(SID_RE.test(withCrypto) && SID_RE.test(fallback), 'sid 不过服务端 SID_RE');
});

await check('0.3 UI 常量与 portal/lib/archive.mjs 真值逐项相等', async () => {
  const c = loadConsts(HTML, ['DATA_ROLES', 'DATA_EXT', 'MAX_DATA_BYTES', 'MAX_DATA_FILES_PER_ROLE', 'ROLE_BIND_POLICY']);
  assert.deepEqual(c.DATA_ROLES, SRV_DATA_ROLES, 'DATA_ROLES 与服务端不一致');
  assert.deepEqual(c.DATA_EXT, SRV_DATA_EXT, 'DATA_EXT 与服务端不一致');
  assert.equal(c.MAX_DATA_BYTES, SRV_MAX_DATA_BYTES, 'MAX_DATA_BYTES 与服务端不一致');
  assert.equal(c.MAX_DATA_FILES_PER_ROLE, SRV_MAX_PER_ROLE, 'MAX_DATA_FILES_PER_ROLE 与服务端不一致');
  assert.equal(c.ROLE_BIND_POLICY.train_matrix, 'train');
  assert.equal(c.ROLE_BIND_POLICY.val_matrix, 'validation');
  assert.equal(c.ROLE_BIND_POLICY.platform_annotation, 'none');
});

await check('0.4 dfPrecheck()：前端预检与服务端同规则（拒 .exe / 超限 / 绑错 / 名实不符）', async () => {
  const c = loadConsts(HTML, ['DATA_EXT', 'MAX_DATA_BYTES', 'MAX_DATA_FILES_PER_ROLE', 'ROLE_BIND_POLICY']);
  const refExt = new Function(`${grabFn(HTML, 'refExt')}\n;return refExt;`)();
  const gseList = new Function('state', `${grabFn(HTML, 'gseList')}\n;return gseList;`)(uiState);
  const dfUploaded = new Function('state', `${grabFn(HTML, 'dfUploaded')}\n;return dfUploaded;`)(uiState);
  const pre = new Function('refExt', 'gseList', 'dfUploaded', 'state', 'DATA_EXT', 'MAX_DATA_BYTES', 'MAX_DATA_FILES_PER_ROLE', 'ROLE_BIND_POLICY',
    `${grabFn(HTML, 'dfPrecheck')}\n;return dfPrecheck;`)(
      refExt, gseList, dfUploaded, uiState, c.DATA_EXT, c.MAX_DATA_BYTES, c.MAX_DATA_FILES_PER_ROLE, c.ROLE_BIND_POLICY);

  const saved = uiState.dataFiles;
  try {
    assert.ok(pre('other', '', { name: 'evil.exe', size: 10 }).includes('evil.exe'), '未拒 .exe');
    assert.ok(pre('other', '', { name: 'big.tsv', size: c.MAX_DATA_BYTES + 1 }).includes('超过上限'), '未拒超限');
    assert.ok(pre('train_matrix', '', { name: 'a.txt.gz', size: 1 }).includes('必须绑定训练集 GSE'), '未拒不绑');
    assert.ok(pre('train_matrix', 'GSE13355', { name: 'a.txt.gz', size: 1 }).includes('不是训练集'), '未拒绑到验证集');
    assert.equal(pre('val_matrix', 'GSE13355', { name: 'v.txt.gz', size: 1 }), '', '误拒合法验证集绑定');
    assert.ok(pre('train_matrix', 'GSE277173', { name: 'GSE13355_series_matrix.txt.gz', size: 1 })
      .includes('文件名中的 GSE13355 与绑定编号 GSE277173 不一致'), '未拒名实不符');
    assert.equal(pre('train_matrix', 'GSE277173', { name: 'GSE277173_series_matrix.txt.gz', size: 1 }), '', '合法输入被误拒');
    assert.equal(pre('sample_sheet', '', { name: 'groups.xlsx', size: 1 }), '', 'sample_sheet 允许不绑');
    assert.equal(pre('platform_annotation', '', { name: 'GPL11532.annot.csv', size: 1 }), '', 'platform_annotation 允许不绑');
    assert.ok(pre('platform_annotation', 'GPL11532', { name: 'x.csv', size: 1 }).includes('不在需求填写的数据集列表里'),
      'GPL 不是合法 bind（bind 只能取数据集 GSE）');
    const full = [];
    for (let i = 0; i < 3; i += 1) full.push({ role: 'other', bind: '', name: `e${i}.tsv`, size: 1 });
    uiState.dataFiles = full;
    assert.ok(pre('other', '', { name: 'e3.tsv', size: 1 }).includes('最多 3 个文件'), 'other 第 4 个未拒');
  } finally {
    uiState.dataFiles = saved;
  }
});

await check('0.5 dfSubmitProblem()：空清单拒、数据集被改后绑定失效能点名', async () => {
  const c = loadConsts(HTML, ['ROLE_BIND_POLICY', 'DATA_ROLE_LABEL']);
  const gseList = new Function('state', `${grabFn(HTML, 'gseList')}\n;return gseList;`)(uiState);
  const prob = new Function('state', 'gseList', 'ROLE_BIND_POLICY', 'DATA_ROLE_LABEL',
    `${grabFn(HTML, 'dfSubmitProblem')}\n;return dfSubmitProblem;`)(uiState, gseList, c.ROLE_BIND_POLICY, c.DATA_ROLE_LABEL);

  assert.ok(prob().includes('请至少上传 1 个数据文件'), '空清单未拒');
  uiState.dataFiles = [{ role: 'train_matrix', bind: 'GSE277173', name: 'GSE277173_series_matrix.txt.gz', size: 32, path: 'uploads/u/x' }];
  assert.equal(prob(), '', '合法清单被误拒');
  uiState.datasets = [{ id: 'd1', gse: '', gpl: '', role: 'train' }];
  assert.ok(prob().includes('必须绑定训练集 GSE'), '数据集被清空后未点名');
  uiState.datasets = [
    { id: 'd1', gse: 'GSE277173', gpl: 'GPL11532', role: 'train' },
    { id: 'd2', gse: 'GSE13355', gpl: 'GPL570', role: 'validation' },
  ];
  uiState.dataFiles = [];
});

// buildManifest：抽真码 + 桩执行。提交用的 payload 就是它的产物，不是手写 JSON。
const buildManifestUi = new Function('state', 'val', '$', 'document', 'parseSamples',
  `${grabFn(HTML, 'parseSamples')}\n${grabFn(HTML, 'buildManifest')}\n;return buildManifest;`)(uiState, stubVal, stub$, stubDoc, null);

await check('0.6 buildManifest()：PUBLIC_DB 模式 payload 形状与既往逐键一致（无新增字段）', async () => {
  uiState.dataSourceMode = 'PUBLIC_DB';
  const m = buildManifestUi();
  assert.deepEqual(Object.keys(m).sort(), [
    'aclAndOutput', 'basicInfo', 'dataSource', 'groupingDesign', 'manifest_version',
    'notes', 'pipelineDag', 'plotLayoutConfig', 'references', 'submitted_at',
  ], 'PUBLIC_DB 顶层键集合发生变化');
  assert.deepEqual(Object.keys(m.dataSource).sort(),
    ['dataType', 'datasets', 'sampleCount', 'source', 'tissue'], 'PUBLIC_DB dataSource 键集合发生变化');
  assert.equal(m.dataFiles, undefined, 'PUBLIC_DB 不应带 dataFiles');
  assert.equal(m.uploadSid, undefined, 'PUBLIC_DB 不应带 uploadSid');
  assert.equal(m.dataSource.data_source_mode, undefined, 'PUBLIC_DB 不应带 data_source_mode');
  assert.equal(m.dataSource.uploaded_files, undefined, 'PUBLIC_DB 不应带 uploaded_files');
});

await check('0.7 buildManifest()：IN_HOUSE_UPLOAD 带齐三字段且 dataFiles 五键结构正确', async () => {
  uiState.dataSourceMode = 'IN_HOUSE_UPLOAD';
  uiState.dataFiles = [{
    role: 'train_matrix', bind: 'GSE277173',
    name: 'GSE277173_series_matrix.txt.gz', size: 32, path: 'uploads/u0123456789ab/GSE277173_series_matrix.txt.gz',
  }];
  const m = buildManifestUi();
  assert.equal(m.dataSource.data_source_mode, 'IN_HOUSE_UPLOAD');
  assert.deepEqual(m.dataSource.uploaded_files, { train_matrix: 'GSE277173_series_matrix.txt.gz' });
  assert.equal(m.uploadSid, 'u0123456789ab');
  assert.equal(m.dataFiles.length, 1);
  assert.deepEqual(Object.keys(m.dataFiles[0]).sort(), ['bind', 'name', 'path', 'role', 'size']);
  assert.equal(m.dataFiles[0].name, 'GSE277173_series_matrix.txt.gz', 'name 应为原始文件名');
  assert.equal(m.dataFiles[0].path, 'uploads/u0123456789ab/GSE277173_series_matrix.txt.gz', 'path 应为服务端返回值');
  uiState.dataFiles = [];
});

await check('0.8 UI 上传调用与服务端 query 契约同构造（sid/role/bind/name + 裸流）', async () => {
  assert.ok(HTML.includes("'/api/datafiles?sid=' + encodeURIComponent(state.uploadSid)"), 'URL 构造与服务端契约不一致');
  assert.ok(HTML.includes("+ '&role=' + encodeURIComponent(role)"), '缺少 role query');
  assert.ok(HTML.includes("+ '&bind=' + encodeURIComponent(bind)"), '缺少 bind query');
  assert.ok(HTML.includes("+ '&name=' + encodeURIComponent(file.name)"), '缺少 name query');
  assert.ok(HTML.includes("headers: { 'Content-Type': 'application/octet-stream' }"), '未用裸流 Content-Type');
  assert.ok(!/FormData\(/.test(HTML), '页面不允许出现 FormData/multipart 实际上传');
});

// ================================================================ 第 1 层：页面可用性（服务级 + DOM 结构）
console.log('\n—— 第 1 层：首页 200 + 上传区 DOM 结构断言（无浏览器，交互未验证）——');

await check('1.1 GET / 返回 200 且含 IN_HOUSE_UPLOAD 上传区全部构件', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();
  for (const needle of [
    'name="dataSourceMode" value="PUBLIC_DB"',
    'name="dataSourceMode" value="IN_HOUSE_UPLOAD"',
    'id="upload-area"', 'id="f-df-role"', 'id="f-df-bind"', 'id="f-df-file"',
    'id="btn-df-upload"', 'id="df-list"', 'id="e-df"', 'id="e-df-replace"', 'id="df-count"',
    'id="mode-card"',
    'accept=".tsv,.csv,.txt,.gz,.zip,.xlsx,.h5ad,.rds,.mtx"',
  ]) {
    assert.ok(html.includes(needle), '页面缺少构件: ' + needle);
  }
  // 白名单与上限必须在文件选择器旁明示
  assert.ok(html.includes('.tsv .csv .txt .gz .zip .xlsx .h5ad .rds .mtx'), '未明示扩展名白名单');
  assert.ok(html.includes('单文件上限 1 GiB'), '未明示体积上限');
});

// ================================================================ 第 2 层：上传正路径
console.log('\n—— 第 2 层：正路径（真上传 → 真提交 → PKG 包）——');

const SID = 'u' + 'a1b2c3d4e5f6';
const MATRIX_NAME = 'GSE277173_series_matrix.txt.gz';
const MATRIX_BYTES = Buffer.from('gene\tGSM1\tGSM2\nA\t1\t2\nB\t3\t4\n');

await check('2.1 上传 train_matrix（bind=训练集 GSE）→ 200 且落盘 uploads/<sid>/', async () => {
  const r = await uiUpload(SID, 'train_matrix', 'GSE277173', MATRIX_NAME, MATRIX_BYTES);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.name, MATRIX_NAME);
  assert.equal(r.body.path, `uploads/${SID}/${MATRIX_NAME}`);
  assert.equal(r.body.size, MATRIX_BYTES.length);
  const onDisk = path.join(INBOX, r.body.path);
  assert.ok(fs.existsSync(onDisk), '文件未落盘: ' + onDisk);
  assert.deepEqual(fs.readFileSync(onDisk), MATRIX_BYTES, '落盘内容与上传不一致');
});

await check('2.2 提交（payload = 真 buildManifest 产物 + 真上传响应）→ 200 且 PKG 包正确', async () => {
  // 与 2.1 同 sid 同角色再传一次，模拟 UI 的「替换」：服务端同名不覆盖，另存 _2，
  // 返回的 path 随之变化。dataFiles.path 必须原样采用服务端返回值，name 仍是原始文件名。
  const up = await uiUpload(SID, 'train_matrix', 'GSE277173', MATRIX_NAME, MATRIX_BYTES);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.name, 'GSE277173_series_matrix.txt_2.gz', '服务端同名应另存 _2');
  uiState.uploadSid = SID;
  uiState.dataSourceMode = 'IN_HOUSE_UPLOAD';
  uiState.dataFiles = [{ role: 'train_matrix', bind: 'GSE277173', name: MATRIX_NAME, size: up.body.size, path: up.body.path }];
  const payload = buildManifestUi();
  assert.equal(payload.dataSource.data_source_mode, 'IN_HOUSE_UPLOAD');
  const r = await uiSubmit(payload);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.savedAs, /^PKG_\d{4}-\d{2}-\d{2}_\d{6}_S19_验证项目$/); // 空格被 buildPackageName 换成下划线

  const pkg = path.join(INBOX, r.body.savedAs);
  const man = JSON.parse(fs.readFileSync(path.join(pkg, 'package_manifest.json'), 'utf8'));
  const req = JSON.parse(fs.readFileSync(path.join(pkg, 'requirement.json'), 'utf8'));
  assert.equal(man.counts.data_files, 1);
  assert.equal(man.counts.references, 0);
  assert.equal(man.data_files[0].role, 'train_matrix');
  assert.equal(man.data_files[0].bind, 'GSE277173');
  assert.equal(man.data_files[0].original_name, MATRIX_NAME, 'original_name 用原始文件名（非 _2 落点）');
  assert.equal(man.data_files[0].archive_name, 'train_matrix__GSE277173__GSE277173_series_matrix.txt.gz');
  assert.equal(man.data_files[0].size, MATRIX_BYTES.length);
  assert.equal(man.data_files[0].from, up.body.path, 'from 必须是服务端返回的最新落点');
  assert.equal(man.data_files[0].to, `${r.body.savedAs}/raw_data/train_matrix__GSE277173__GSE277173_series_matrix.txt.gz`);
  assert.deepEqual(fs.readFileSync(path.join(pkg, 'raw_data', man.data_files[0].archive_name)), MATRIX_BYTES);
  assert.equal(req.dataSource.data_source_mode, 'IN_HOUSE_UPLOAD');
  assert.deepEqual(req.dataSource.uploaded_files, { train_matrix: MATRIX_NAME });
  assert.equal(req.uploadSid, SID);
  assert.equal(req.dataFiles[0].path, up.body.path);
  console.log('      〔观察〕首次上传的同名旧文件仍留在 uploads/<sid>/（服务端「同角色删旧」的'
    + ' role__ 前缀过滤与落盘命名不匹配，属服务端既有行为；本切片不改服务端，已报主 Agent）');
  uiState.dataFiles = [];
});

// ================================================================ 第 3 层：负路径
console.log('\n—— 第 3 层：负路径（全部真 400 且 error 点名问题）——');

await check('3.1 角色非法 → 400「角色非法」', async () => {
  const r = await uiUpload(SID, 'shell', '', 'x.tsv', Buffer.from('x'));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /角色非法/);
});

await check('3.2 扩展名不在白名单 → 400 点名 evil.exe 且不落盘', async () => {
  const r = await uiUpload(SID, 'other', '', 'evil.exe', Buffer.from('x'));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /evil\.exe/);
  assert.equal(fs.existsSync(path.join(INBOX, 'uploads', SID, 'evil.exe')), false, '非法文件不应落盘');
});

await check('3.3 上传会话 id 非法 → 400「上传会话 id 非法」', async () => {
  const r = await uiUpload('short', 'other', '', 'x.tsv', Buffer.from('x'));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /上传会话 id 非法/);
});

await check('3.4 bind 不在数据集列表 → 400「不在需求填写的数据集列表里」', async () => {
  const r = await uiSubmit({
    manifest_version: '1.0',
    basicInfo: { name: 'S19 负路径_bind不存在' },
    dataSource: {
      dataType: 'microarray', data_source_mode: 'PUBLIC_DB',
      datasets: [{ gse: 'GSE277173', gpl: 'GPL11532', role: 'train' }],
    },
    dataFiles: [{ role: 'train_matrix', bind: 'GSE999999', name: 'x.txt.gz', path: 'uploads/x/x.txt.gz', size: 3 }],
    uploadSid: SID,
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /不在需求填写的数据集列表里/);
});

await check('3.5 train_matrix 绑了验证集 GSE → 400「不是训练集」', async () => {
  const r = await uiSubmit({
    manifest_version: '1.0',
    basicInfo: { name: 'S19 负路径_绑错角色' },
    dataSource: {
      dataType: 'microarray', data_source_mode: 'PUBLIC_DB',
      datasets: [{ gse: 'GSE277173', gpl: 'GPL11532', role: 'train' },
        { gse: 'GSE13355', gpl: 'GPL570', role: 'validation' }],
    },
    dataFiles: [{ role: 'train_matrix', bind: 'GSE13355', name: 'x.txt.gz', path: 'uploads/x/x.txt.gz', size: 3 }],
    uploadSid: SID,
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /不是训练集/);
});

await check('3.6 文件名 GSE 与 bind 不一致 → 400「文件名中的 GSE13355 与绑定编号 GSE277173 不一致」', async () => {
  const r = await uiSubmit({
    manifest_version: '1.0',
    basicInfo: { name: 'S19 负路径_名实不符' },
    dataSource: {
      dataType: 'microarray', data_source_mode: 'PUBLIC_DB',
      datasets: [{ gse: 'GSE277173', gpl: 'GPL11532', role: 'train' },
        { gse: 'GSE13355', gpl: 'GPL570', role: 'validation' }],
    },
    dataFiles: [{ role: 'train_matrix', bind: 'GSE277173', name: 'GSE13355_series_matrix.txt.gz', path: 'uploads/x/y.txt.gz', size: 3 }],
    uploadSid: SID,
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /文件名中的 GSE13355 与绑定编号 GSE277173 不一致/);
});

await check('3.7 IN_HOUSE_UPLOAD 上传名与填写名不一致 → 400「与填写的矩阵文件名 … 不一致」', async () => {
  const r = await uiSubmit({
    manifest_version: '1.0',
    basicInfo: { name: 'S19 负路径_名字不符' },
    dataSource: {
      dataType: 'microarray', data_source_mode: 'IN_HOUSE_UPLOAD',
      uploaded_files: { train_matrix: 'mouse_cortex.tsv' },
      datasets: [{ gse: 'GSE277173', gpl: 'GPL11532', role: 'train' }],
    },
    dataFiles: [{ role: 'train_matrix', bind: '', name: 'mouse_cortex_v2.tsv', path: 'uploads/x/mouse_cortex_v2.tsv', size: 10 }],
    uploadSid: 'u' + 'd4e5f6a7b8c9',
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /与填写的矩阵文件名 .* 不一致/);
});

await check('3.8 同一角色两条数据文件 → 400「只允许一个文件」', async () => {
  const r = await uiSubmit({
    manifest_version: '1.0',
    basicInfo: { name: 'S19 负路径_同角色两条' },
    dataSource: {
      dataType: 'microarray', data_source_mode: 'PUBLIC_DB',
      datasets: [{ gse: 'GSE277173', gpl: 'GPL11532', role: 'train' }],
    },
    dataFiles: [
      { role: 'train_matrix', bind: 'GSE277173', name: 'a.txt.gz', path: 'uploads/x/a.txt.gz', size: 3 },
      { role: 'train_matrix', bind: 'GSE277173', name: 'b.txt.gz', path: 'uploads/x/b.txt.gz', size: 3 },
    ],
    uploadSid: SID,
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /train_matrix 只允许一个文件/);
});

// ================================================================ 第 4 层：组合与 PUBLIC_DB 零变化
console.log('\n—— 第 4 层：数据文件 + 参考文献同包；PUBLIC_DB 老路径零变化 ——');

await check('4.1 同一 sid 下数据文件 + 参考文献 → 一个包内 references/ 与 raw_data/ 齐全', async () => {
  const sid2 = 'u' + '0f1e2d3c4b5a';
  const df = await uiUpload(sid2, 'train_matrix', 'GSE277173', MATRIX_NAME, MATRIX_BYTES);
  assert.equal(df.status, 200, JSON.stringify(df.body));
  const refUrl = `${BASE}/api/references?sid=${sid2}&name=${encodeURIComponent('S19_ref.md')}`;
  const refRes = await fetch(refUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('# S19 参考文献\n'),
  });
  const refBody = await refRes.json();
  assert.equal(refRes.status, 200, JSON.stringify(refBody));

  uiState.uploadSid = sid2;
  uiState.dataSourceMode = 'IN_HOUSE_UPLOAD';
  uiState.dataFiles = [{ role: 'train_matrix', bind: 'GSE277173', name: MATRIX_NAME, size: df.body.size, path: df.body.path }];
  uiState.refs = [{ name: refBody.name, path: refBody.path, size: refBody.size }];
  const payload = buildManifestUi();
  const r = await uiSubmit(payload);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const pkg = path.join(INBOX, r.body.savedAs);
  const man = JSON.parse(fs.readFileSync(path.join(pkg, 'package_manifest.json'), 'utf8'));
  assert.equal(man.counts.data_files, 1);
  assert.equal(man.counts.references, 1);
  assert.ok(fs.existsSync(path.join(pkg, 'raw_data', 'train_matrix__GSE277173__GSE277173_series_matrix.txt.gz')), 'raw_data 缺文件');
  assert.ok(fs.existsSync(path.join(pkg, 'references', '01_S19_ref.md')), 'references 缺文件');
  uiState.dataFiles = [];
  uiState.refs = [];
});

await check('4.2 PUBLIC_DB 无数据文件 → 仍落扁平 JSON，不生成 PKG_ 包', async () => {
  uiState.dataSourceMode = 'PUBLIC_DB';
  uiState.dataFiles = [];
  const payload = buildManifestUi();
  assert.equal(payload.uploadSid, undefined);
  assert.equal(payload.dataFiles, undefined);
  const r = await uiSubmit(payload);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.savedAs, /^\d{4}-\d{2}-\d{2}_\d{6}_需求_S19_验证项目\.json$/);
  assert.ok(fs.existsSync(path.join(INBOX, r.body.savedAs)), '扁平 JSON 未落在 inbox 根');
});

await check('4.3 PUBLIC_DB 仅参考文献（老行为）→ 扁平 JSON，refs 不归档', async () => {
  const sid3 = 'u' + '99aabbccddee';
  const refRes = await fetch(`${BASE}/api/references?sid=${sid3}&name=${encodeURIComponent('legacy.md')}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('legacy\n'),
  });
  assert.equal(refRes.status, 200);
  const refBody = await refRes.json();
  uiState.uploadSid = sid3;
  uiState.dataSourceMode = 'PUBLIC_DB';
  uiState.refs = [{ name: refBody.name, path: refBody.path, size: refBody.size }];
  const payload = buildManifestUi();
  assert.equal(payload.uploadSid, undefined, 'PUBLIC_DB 不应因上传过文献就带 uploadSid');
  const r = await uiSubmit(payload);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(fs.existsSync(path.join(INBOX, refBody.path)), '老行为：文献仍留在 refs/<sid>/ 不被归档');
  uiState.refs = [];
});

// ================================================================ 汇总
const failed = results.filter((r) => !r[0]);
console.log(`\n[S19] 汇总：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  - ' + f[1]));
}
console.log('[S19] 未验证：真实浏览器交互（本环境无浏览器；页面交互仅做服务级与 DOM 结构断言）');
cleanup();
process.exit(failed.length ? 1 : 0);
