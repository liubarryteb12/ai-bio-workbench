/**
 * 端到端验证：用户端提交接口的行级三元组校验与落盘。
 *
 * 覆盖：
 *   1. 行级 dataType 非法 → 400，且不落任何包目录
 *   2. 行级 sampleCount 非法 → 400
 *   3. 合法三元组 → 200，requirement.json 里原样保留两行各自的
 *      dataType / sampleCount / tissue（不被项目级覆盖）
 *
 * 独立端口 + 独立收件箱：本脚本直接 import portal/lib/archive.mjs 的命名规则
 * 定位包目录，验证后删除，不污染真实 inbox。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const INBOX = path.join(ROOT, 'portal', 'inbox');
const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
};

function manifest(overrides) {
  return {
    basicInfo: { name: '行级三元组验证' },
    dataSource: {
      dataType: 'microarray',
      data_source_mode: 'PUBLIC_DB',
      source: 'GEO',
      sampleCount: 84,
      tissue: 'Peripheral Blood',
      datasets: [
        { gse: 'GSE16561', gpl: 'GPL6883', role: 'train', dataType: 'microarray', sampleCount: 60, tissue: 'Peripheral Blood' },
        { gse: 'GSE58294', gpl: '', role: 'validation', dataType: 'bulk_rnaseq', sampleCount: 24, tissue: 'Skin Lesion' },
      ],
    },
    groupingDesign: { groups: [{ sampleIds: ['GSM1', 'GSM2'] }, { sampleIds: ['GSM3'] }] },
    notes: '',
    dataFiles: [],
    ...overrides,
  };
}

async function post(body) {
  const res = await fetch(`${BASE}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  return { status: res.status, payload };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [path.join(ROOT, 'portal', 'serve.mjs')], {
  env: { ...process.env, PORTAL_PORT: String(PORT), PORTAL_HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let serverLog = '';
server.stdout.on('data', (c) => { serverLog += c.toString(); });
server.stderr.on('data', (c) => { serverLog += c.toString(); });

let createdPackages = [];

try {
  // 等服务起来
  let up = false;
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`${BASE}/`, { method: 'GET' });
      if (r.status === 200) { up = true; break; }
    } catch { /* 还没起来 */ }
    await sleep(150);
  }
  check('用户端服务启动（独立端口 8099）', up, up ? '' : serverLog.slice(-300));
  if (!up) throw new Error('服务未启动');

  const before = new Set(fs.existsSync(INBOX) ? fs.readdirSync(INBOX).filter((n) => n.startsWith('PKG_')) : []);

  // 1) 行级数据类型非法
  const badType = manifest({
    dataSource: {
      ...manifest({}).dataSource,
      datasets: [{ gse: 'GSE1', gpl: '', role: 'train', dataType: 'RNA-seq', sampleCount: 10, tissue: 'X' }],
    },
  });
  const r1 = await post(badType);
  check('行级 dataType 非法被拒（400）', r1.status === 400, r1.payload?.error || '');
  check('拒绝信息指明第 1 组', /第 1 组/.test(r1.payload?.error || ''), r1.payload?.error || '');

  // 2) 行级样本数量非法
  const badCount = manifest({
    dataSource: {
      ...manifest({}).dataSource,
      datasets: [{ gse: 'GSE1', gpl: '', role: 'train', dataType: 'microarray', sampleCount: -5, tissue: 'X' }],
    },
  });
  const r2 = await post(badCount);
  check('行级 sampleCount 非法被拒（400）', r2.status === 400, r2.payload?.error || '');

  // 3) 合法提交
  const r3 = await post(manifest({}));
  check('合法行级三元组提交成功（200）', r3.status === 200 && r3.payload?.ok === true, r3.payload?.error || '');
  if (r3.payload?.savedAs) createdPackages.push(r3.payload.savedAs);

  const reqPath = path.join(INBOX, r3.payload?.requirement || '');
  const saved = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
  const rows = saved.dataSource.datasets;
  check('落盘保留第 1 行芯片 / 60 / 外周血',
    rows[0].dataType === 'microarray' && rows[0].sampleCount === 60 && rows[0].tissue === 'Peripheral Blood',
    JSON.stringify(rows[0]));
  check('落盘保留第 2 行测序 / 24 / 皮肤（未被项目级覆盖）',
    rows[1].dataType === 'bulk_rnaseq' && rows[1].sampleCount === 24 && rows[1].tissue === 'Skin Lesion',
    JSON.stringify(rows[1]));

  // 4) 校验失败不应产生包目录
  const after = new Set(fs.existsSync(INBOX) ? fs.readdirSync(INBOX).filter((n) => n.startsWith('PKG_')) : []);
  const added = [...after].filter((n) => !before.has(n));
  check('失败请求未产生额外包目录', added.length === 1, `新增 ${added.length} 个：${added.join(', ')}`);
} catch (cause) {
  check('脚本未抛异常', false, cause instanceof Error ? cause.message : String(cause));
} finally {
  server.kill();
  for (const dir of createdPackages) {
    try { fs.rmSync(path.join(INBOX, dir), { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果：${pass}/${results.length} 通过`);
  process.exitCode = pass === results.length ? 0 : 1;
}
