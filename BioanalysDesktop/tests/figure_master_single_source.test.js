// T1-1 母版唯一真源：**注册在案的生产母版**按 basename 只许一份（_legacy 除外）。
//
// 为什么不是全仓扫描：reference/05.可参考生信代码/可用代码预筛选/源码 是资产库，里面有上百份来自公开图库的
// 同名示例脚本（install_dependencies.R、utils.R 等），那是资料本身，不是生产母版。
// 判据必须落在**矩阵注册的 runner**上，那才是我方会真正跑的东西。
//
// 第三十三轮实施：按 4 Argon Q2 裁定，主目录三份分叉母版已迁入 _legacy/，
// 矩阵 runner 从 27 收到 24，全部 figure_id 仍由 compat 覆盖。
//
//   _meta/R453_compat/L2_core_code.R   sha a8ae5c81（合规：EE0000/3B4992/BEBEBE + 四行 caption）
//   _legacy/L2_组学常用图/L2_core_code.R sha d60ecbf2（旧配色 D55E00/0072B2 + 无 caption）
//   _legacy/L2_组学常用图/L2_volcano_code.R sha 8829922c（旧配色 + 无 caption）
//   _meta/R453_compat/L3_sankey_code.R sha 9f80d4b6（合规）
//   _legacy/L3_高级组合图/L3_sankey_code.R sha 6c94fe74（旧配色 + 无 caption）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REF_ROOT = path.join(REPO_ROOT, 'reference', '05.可参考生信代码', '可用代码预筛选', '源码');
const COMPAT = path.join(REF_ROOT, '_meta', 'R453_compat');
const MATRIX = path.join(REF_ROOT, '_meta', 'script_plot_matrix.json');

/** git 可用且有仓库根时才算能查跟踪状态。 */
function gitUsable() {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return r.status === 0 && String(r.stdout || '').trim() === 'true';
}

function sha8(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
}

function loadRunners() {
  const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
  return (matrix.entries || []).map((e) => String(e.script_path || '')).filter(Boolean);
}

test('矩阵注册的 runner 中，同名母版的字节不得分叉', () => {
  const byBase = new Map();
  for (const rel of loadRunners()) {
    const base = path.basename(rel);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(rel);
  }
  // 只把「内容真的不同」的同名重复算缺陷。逐字节相同的重复只是整洁问题，
  // 不会造成「预览来自 A、产物来自 B」的分叉。
  const duplicated = [...byBase.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([base, files]) => {
      const shas = new Set(files.map((rel) => sha8(path.join(REF_ROOT, rel))));
      return { base, files, divergent: shas.size > 1 };
    })
    .filter((item) => item.divergent);
  assert.deepEqual(duplicated, [], '同名母版分叉: ' + JSON.stringify(duplicated, null, 2));
});

test('compat 的火山与桑基保持合规字节（真源不许被就地改写）', () => {
  const expected = [['L2_core_code.R', 'a8ae5c81'], ['L3_sankey_code.R', '9f80d4b6']];
  for (const [name, want] of expected) {
    const file = path.join(COMPAT, name);
    assert.ok(fs.existsSync(file), `compat 缺少真源 ${name}`);
    assert.equal(sha8(file), want, `${name} 字节漂移：真源被改过`);
  }
});

test('compat 真源带规范三色与图注', () => {
  const volcano = fs.readFileSync(path.join(COMPAT, 'L2_core_code.R'), 'utf8');
  assert.match(volcano, /EE0000/, 'compat 火山缺规范上调色');
  assert.match(volcano, /3B4992/, 'compat 火山缺规范下调色');
  assert.match(volcano, /BEBEBE/, 'compat 火山缺规范中性色');
  assert.match(volcano, /caption/i, 'compat 火山缺 caption');
  const sankey = fs.readFileSync(path.join(COMPAT, 'L3_sankey_code.R'), 'utf8');
  assert.match(sankey, /caption/i, 'compat 桑基缺 caption');
});

test('矩阵 runner 指向的脚本必须真实存在，且不得指向 _legacy', () => {
  const runners = loadRunners();
  const missing = [];
  const legacy = [];
  for (const rel of runners) {
    const full = path.join(REF_ROOT, rel);
    if (!fs.existsSync(full)) missing.push(rel);
    if (rel.split(/[/\\]/).includes('_legacy')) legacy.push(rel);
  }
  assert.deepEqual(missing, [], '矩阵 runner 指向不存在的脚本: ' + JSON.stringify(missing));
  assert.deepEqual(legacy, [], '矩阵 runner 指向了 _legacy: ' + JSON.stringify(legacy));
});

test('已经迁入 _legacy 的母版必须有对应 compat 真源在役', () => {
  const legacyDir = path.join(REF_ROOT, '_legacy');
  assert.ok(fs.existsSync(legacyDir), '_legacy 目录必须存在（T1-1 归一的产物）');
  const pairs = [
    ['L2_组学常用图/L2_core_code.R', 'L2_core_code.R'],
    ['L3_高级组合图/L3_sankey_code.R', 'L3_sankey_code.R'],
  ];
  for (const [legacyRel, compatName] of pairs) {
    assert.ok(fs.existsSync(path.join(legacyDir, legacyRel)), `_legacy 缺少 ${legacyRel}`);
    assert.ok(fs.existsSync(path.join(COMPAT, compatName)), `compat 缺少在役真源 ${compatName}`);
  }
});
test('_legacy 目录必须真的被 git 跟踪（.gitignore 是白名单模式，漏加会静默丢文件）', () => {
  // 背景：.gitignore 对 reference/05.可参考生信代码/可用代码预筛选/源码 用的是「先全忽略再逐条放行」的白名单模式。
  // 第三十三轮把三份分叉母版迁进 _legacy 时，目录本身不在白名单里，git mv 能暂存（R100 重命名），
  // 但新 clone 或 git add 会静默丢掉这三个文件。这条断言把「白名单要跟着目录结构更新」变成机器检查。
  const legacyFiles = loadLegacyFiles();
  assert.deepEqual(legacyFiles.missing, [],
    '_legacy 下必须有这三份母版: ' + JSON.stringify(legacyFiles.missing));
  if (!gitUsable()) return;
  const listed = spawnSync('git', ['ls-files', '--', path.join('reference', '05.可参考生信代码', '可用代码预筛选', '源码', '_legacy')],
    { cwd: REPO_ROOT, encoding: 'utf8' });
  const trackedSet = new Set((listed.stdout || '').split('\n').filter(Boolean).map((p) => p.split('/').join('/')));
  const untracked = legacyFiles.present.filter((rel) => !trackedSet.has(rel));
  assert.deepEqual(untracked, [],
    '以下 _legacy 文件没被 git 跟踪（.gitignore 白名单漏了）: ' + JSON.stringify(untracked));
});

/** 三份 legacy 母版，以及仓库里实际存在的那些。 */
function loadLegacyFiles() {
  const rel = [
    'reference/05.可参考生信代码/可用代码预筛选/源码/_legacy/L2_组学常用图/L2_core_code.R',
    'reference/05.可参考生信代码/可用代码预筛选/源码/_legacy/L2_组学常用图/L2_volcano_code.R',
    'reference/05.可参考生信代码/可用代码预筛选/源码/_legacy/L3_高级组合图/L3_sankey_code.R',
  ];
  const present = rel.filter((r) => fs.existsSync(path.join(REPO_ROOT, r)));
  const missing = rel.filter((r) => !fs.existsSync(path.join(REPO_ROOT, r)));
  return { present, missing };
}