import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isSafeManifestName, readPackageManifest, listInboxManifests, PORTAL_INBOX } from '../server/portal_inbox.js';

// ── portal_inbox.js 契约面测试（2026-11-03，4 Argon 第十八轮第二梯队 P1）──
//
// 它是 8080 客户提交台落盘文件进管理台的读取边界：文件名直接参与 path.join，
// 一旦放越界名就能读收件箱目录之外的任意文件。所有断言先探针实测确认：
//   - 合法形态两种：根目录 <时间戳>_需求_<项目名>.json（含中文）、
//     PKG_<时间戳>_<项目名>/requirement.json 与 package_manifest.json
//   - 非法一律 false：空/非字符串/.. 字面/反斜杠/多级路径/错误扩展名/首尾斜杠
//   - readPackageManifest 对无斜杠与文件缺失都返回 null，不抛错
//     （一个坏清单不得挡住整列表）

test('isSafeManifestName：两种在册形态通过（含中文项目名）', () => {
  for (const name of [
    '20261031_需求_行囊.json',
    'PKG_20261031_行囊/requirement.json',
    'PKG_20261031_abc/package_manifest.json',
    'a.b.json',
  ]) {
    assert.equal(isSafeManifestName(name), true, name + ' 必须放行');
  }
});

test('isSafeManifestName：穿越与反斜杠一律拒绝', () => {
  for (const name of ['../x.json', '..\\x.json', 'a/../b.json', 'PKG_../requirement.json']) {
    assert.equal(isSafeManifestName(name), false, name + ' 必须拒绝');
  }
});

test('isSafeManifestName：非字符串与空值拒绝，不抛错', () => {
  for (const name of ['', null, undefined, 42, {}, []]) {
    assert.equal(isSafeManifestName(name), false, String(name) + ' 必须拒绝');
  }
});

test('isSafeManifestName：只认两种固定文件名，多级与错扩展名拒绝', () => {
  for (const name of [
    'PKG_x/evil.json',
    'PKG_x/requirement.txt',
    'PKG_x/a/requirement.json',
    'x.json/',
    '/x.json',
    'evil.exe',
  ]) {
    assert.equal(isSafeManifestName(name), false, name + ' 必须拒绝');
  }
});

test('readPackageManifest：无斜杠、目录缺失、清单坏损都返回 null 不抛错', () => {
  assert.equal(readPackageManifest('x.json'), null);
  assert.equal(readPackageManifest('PKG_no_such_pkg/requirement.json'), null);
  // 造一个坏清单目录：解析失败也必须 null，不能把列表接口打崩。
  // 目录名带本次进程号 + 随机后缀：这段测试会在全量测试里并发跑，固定名字会让
  // 两个实例互相删掉对方正在用的夹具（第三十四轮 Q4 静态隔离门禁判定的同类缺陷）。
  const badDir = path.join(PORTAL_INBOX, 'PKG_zzprobe_broken_' + process.pid + '_' + Math.random().toString(36).slice(2, 8));
  if (!fs.existsSync(badDir)) fs.mkdirSync(badDir);
  fs.writeFileSync(path.join(badDir, 'package_manifest.json'), '{not json');
  try {
    assert.equal(readPackageManifest(path.basename(badDir) + '/requirement.json'), null);
  } finally {
    fs.rmSync(badDir, { recursive: true, force: true });
  }
});

test('listInboxManifests：返回形状与排序契约（blocked 或 items 按 mtime 倒序）', () => {
  const r = listInboxManifests();
  if (r.blocked) {
    // 目录缺失时 blocked 必须带原因与 detail，且 items 为空数组而不是 undefined
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
    assert.deepEqual(r.items, []);
    return;
  }
  assert.equal(r.dir, PORTAL_INBOX);
  assert.ok(Array.isArray(r.items));
  for (const item of r.items) {
    assert.ok(typeof item.file === 'string' && item.file.length > 0);
    assert.ok(typeof item.size === 'number');
    // 解析失败要如实带 parseError，不静默丢条目
    assert.ok(item.summary !== undefined && item.parseError !== undefined);
  }
  const times = r.items.map((x) => x.mtime);
  const sorted = [...times].sort((a, b) => (a < b ? 1 : -1));
  assert.deepEqual(times, sorted, '必须按 mtime 倒序');
});

test('listInboxManifests：坏 JSON 条目带 parseError 且不挡其他条目', () => {
  const badFile = path.join(PORTAL_INBOX, 'zzprobe_broken_需求.json');
  const goodFile = path.join(PORTAL_INBOX, 'zzprobe_ok_需求.json');
  fs.writeFileSync(badFile, '{definitely not json');
  fs.writeFileSync(goodFile, JSON.stringify({
    basicInfo: { name: '探针项目', species: 'Homo sapiens' },
    dataSource: { dataType: 'scrna', sampleCount: 6 },
  }));
  try {
    const r = listInboxManifests();
    const bad = r.items.find((x) => x.file === 'zzprobe_broken_需求.json');
    const good = r.items.find((x) => x.file === 'zzprobe_ok_需求.json');
    assert.ok(bad, '坏条目也必须列出（带 parseError）');
    assert.ok(bad.parseError, '坏 JSON 必须给出 parseError');
    assert.ok(good && good.summary, '好条目不受坏条目影响');
    assert.equal(good.summary.suggestedLine, 'line2_scrna', 'scrna 必须建议 line2');
    assert.equal(good.summary.name, '探针项目');
  } finally {
    fs.rmSync(badFile, { force: true });
    fs.rmSync(goodFile, { force: true });
  }
});

// 反斜杠检查的定性（探针实测）：当前字符类 [\w\u4e00-\u9fa5.-] 不含反斜杠，
// 任何带 \ 的名字必然被两个正则拒。所以删掉 name.includes('\\') 时行为测试仍全绿
// ——这是正确结果，不是测试漏抓。该检查是纵深防御第二层：一旦将来放宽字符类
// （例如放行空格），Windows 下 path.join 会把 \ 当分隔符，那时它是唯一防线。
// 因此用结构断言钉住它存在，而不是造一个现在根本不存在的触发输入。
test('名称守卫保留反斜杠第二层检查（防未来放宽字符类后失守）', async () => {
  const src = fs.readFileSync(new URL('../server/portal_inbox.js', import.meta.url), 'utf8');
  // 用 charCode 构造反斜杠，避免「字符串字面量 / 正则 / 文件内容」三层转义互相吃掉
  const bs = String.fromCharCode(92) + String.fromCharCode(92);
  assert.ok(src.includes("name.includes('" + bs + "')"),
    '反斜杠检查不得缺席：Windows 下 path.join 会把反斜杠当分隔符');
  assert.ok(src.includes("name.includes('..')"), '.. 检查不得缺席');
  // 两个固定文件名必须写死，不得放宽成任意 .json
  assert.ok(src.includes('(requirement|package_manifest)\\.json'),
    '包内文件名必须限定 requirement 与 package_manifest 两种');
});

