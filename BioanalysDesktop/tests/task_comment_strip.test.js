/**
 * stripShellAndCodeComments 与 inspectBridgeNeed 去注释判定测试（P3 / todo 2.1，aims §三.2）
 *
 * 解决的真实问题：inspectBridgeNeed 原先对母版全文跑 Rscript / python 正则计数，
 * 注释里出现 "python3" 或 "Rscript" 字样就会被当成真调用，把单语言母版误判成
 * bilingual 并强行触发桥接四项断言（ml_diagnostics 的注释踩过这个坑，当时只能改注释绕过）。
 *
 * 本测试钉住三件事：
 *   1. strip 的语义边界（整行注释 / 行尾注释 / 引号内 # / shebang / 转义 # / 词中 # / 换行）；
 *   2. 全仓 58 个母版 strip 前后计数完全一致，bilingual 恰为既有三个，不因去注释而漂移；
 *   3. 注释里的 python3 / Rscript 不再计入，真实调用一处不少。
 *
 * 判定正则在此独立维护（与 bridge_guard_invariant.test.js 同款做法），避免测试反向依赖被测实现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripShellAndCodeComments, inspectBridgeNeed } from '../server/task.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

const RSCRIPT_CALL_RE = /(^|[\s;&|"])Rscript(?=[\s"']|$)/;
const PYTHON_CALL_RE = /(^|[\s;&|])python3?(?=[\s"']|$)/;

function listMasters() {
  const out = [];
  for (const line of fs.readdirSync(SRC_ROOT, { withFileTypes: true })) {
    if (!line.isDirectory()) continue;
    const scriptsDir = path.join(SRC_ROOT, line.name, 'scripts');
    if (!fs.existsSync(scriptsDir)) continue;
    for (const f of fs.readdirSync(scriptsDir)) {
      const abs = path.join(scriptsDir, f);
      if (fs.statSync(abs).isFile()) out.push({ lineId: line.name, step: f, abs });
    }
  }
  out.sort((a, b) => a.abs.localeCompare(b.abs));
  return out;
}

function countsOf(content) {
  const lines = content.split(/\r?\n/);
  return {
    rCount: lines.filter((line) => RSCRIPT_CALL_RE.test(line)).length,
    pCount: lines.filter((line) => PYTHON_CALL_RE.test(line)).length,
  };
}

const masters = listMasters();

// ───────────── 1. strip 的语义边界 ─────────────

test('P3: 整行注释（含缩进）清空，行数与空行保持不变', () => {
  const src = ['echo one', '', '   # 整行注释', '\t# 制表符缩进的注释', 'echo two'].join('\n');
  const out = stripShellAndCodeComments(src);
  assert.equal(out, ['echo one', '', '', '', 'echo two'].join('\n'));
  assert.equal(out.split('\n').length, src.split('\n').length, '行数必须不变');
});

test('P3: 行尾注释剥离，注释前的代码逐字节不变', () => {
  assert.equal(stripShellAndCodeComments('echo hi  # 说明'), 'echo hi');
  assert.equal(stripShellAndCodeComments('  Rscript a.R # 跑 R'), '  Rscript a.R');
  assert.equal(stripShellAndCodeComments('x=1#没有空格'), 'x=1#没有空格', '词中的 # 是字面量，不当注释');
});

test('P3: 引号内的 # 保留（单引号与双引号）', () => {
  assert.equal(stripShellAndCodeComments('echo "a # b"'), 'echo "a # b"');
  assert.equal(stripShellAndCodeComments("echo 'a # b'"), "echo 'a # b'");
  assert.equal(stripShellAndCodeComments('echo "a # b"  # 真注释'), 'echo "a # b"');
  assert.equal(stripShellAndCodeComments('echo "it\'s" # c'), 'echo "it\'s"');
});

test('P3: shebang 行原样保留（不被当整行注释剥掉）', () => {
  const src = '#!/usr/bin/env bash\n# 普通注释\necho ok\n';
  assert.equal(stripShellAndCodeComments(src), '#!/usr/bin/env bash\n\necho ok\n');
  assert.equal(stripShellAndCodeComments('  #! 不是首行也保留'), '  #! 不是首行也保留');
});

test('P3: 转义 \\# 与 $# / ${v#p} 保留（不当注释）', () => {
  assert.equal(stripShellAndCodeComments('echo a \\# b'), 'echo a \\# b');
  assert.equal(stripShellAndCodeComments('if [ $# -lt 1 ]; then'), 'if [ $# -lt 1 ]; then');
  assert.equal(stripShellAndCodeComments('name="${p#prefix}"'), 'name="${p#prefix}"');
});

test('P3: 换行符原样保留（CRLF 不改成 LF）', () => {
  const src = 'a\r\n# c\r\nb\r\n';
  assert.equal(stripShellAndCodeComments(src), 'a\r\n\r\nb\r\n');
  assert.equal(stripShellAndCodeComments('a\n# c\nb\n'), 'a\n\nb\n');
});

test('P3: 空输入安全返回空串（undefined / null / 空字符串）', () => {
  assert.equal(stripShellAndCodeComments(''), '');
  assert.equal(stripShellAndCodeComments(undefined), '');
  assert.equal(stripShellAndCodeComments(null), '');
});

// ───────────── 2. 真实踩坑样例 ─────────────

test('P3: 注释里只出现 python3 / Rscript 时不计入调用数（误判根因）', () => {
  const src = [
    '#!/usr/bin/env bash',
    '# 历史注释：本步先用 python3 出表，再用 Rscript 画图（这句是文字，不是调用）',
    '  # python3 - <<PY',
    'echo done  # 收尾时也不要 Rscript',
    '',
  ].join('\n');
  const stripped = stripShellAndCodeComments(src);
  const { rCount, pCount } = countsOf(stripped);
  assert.equal(rCount, 0, '注释里的 Rscript 不能计入');
  assert.equal(pCount, 0, '注释里的 python3 不能计入');
});

test('P3: 真实母版 ml_diagnostics 头部插入历史注释后，计数仍为 R1/P1', () => {
  const abs = path.join(SRC_ROOT, 'line1_bulk', 'scripts', 'ml_diagnostics');
  assert.ok(fs.existsSync(abs), '母版缺失，无法验证真实样例');
  const content = fs.readFileSync(abs, 'utf8');
  const before = countsOf(stripShellAndCodeComments(content));
  const polluted = [
    '# 踩坑复现：本母版先 python3 出表，再 Rscript 画 nomogram（文字，不是调用）',
    content,
  ].join('\n');
  const after = countsOf(stripShellAndCodeComments(polluted));
  assert.deepEqual(after, before, '注释里提到 python3/Rscript 不得改变计数');
  assert.equal(after.rCount, 1);
  assert.equal(after.pCount, 1);
  const need = inspectBridgeNeed('line1_bulk', 'ml_diagnostics');
  assert.equal(need.bilingual, true, 'ml_diagnostics 是既有的真跨语言母版');
  assert.equal(need.rCount, 1);
  assert.equal(need.pCount, 1);
});

// ───────────── 3. 母版全集回归 ─────────────

test('P3: 母版全集规模稳定（58 个）', () => {
  assert.equal(masters.length, 58, `母版数量变化，需同步核对 bilingual 集合: ${masters.length}`);
});

test('P3: 全仓母版 strip 前后调用计数完全一致（去注释不改变真调用）', () => {
  const drift = [];
  for (const m of masters) {
    const content = fs.readFileSync(m.abs, 'utf8');
    const raw = countsOf(content);
    const stripped = countsOf(stripShellAndCodeComments(content));
    if (raw.rCount !== stripped.rCount || raw.pCount !== stripped.pCount) {
      drift.push(`${m.lineId}/${m.step}: raw R${raw.rCount}/P${raw.pCount} -> strip R${stripped.rCount}/P${stripped.pCount}`);
    }
  }
  assert.deepEqual(drift, [], `strip 误删了真调用或漏剥注释:\n${drift.join('\n')}`);
});

test('P3: strip 后 bilingual 集合恰为既有三个母版（集合不漂移）', () => {
  const bi = masters
    .map((m) => ({ ...m, ...countsOf(stripShellAndCodeComments(fs.readFileSync(m.abs, 'utf8'))) }))
    .filter((m) => m.rCount >= 1 && m.pCount >= 1)
    .map((m) => `${m.lineId}/${m.step}`)
  assert.deepEqual(bi, [
    'line1_bulk/ml_diagnostics',
    'line1_bulk/ml_hub_analysis',
    'line2_scrna/gsva_pathways',
  ]);
});

test('P3: inspectBridgeNeed 对三个 bilingual 母版判 true，对单语言母版判 false', () => {
  for (const [lineId, step] of [
    ['line1_bulk', 'ml_diagnostics'],
    ['line1_bulk', 'ml_hub_analysis'],
    ['line2_scrna', 'gsva_pathways'],
  ]) {
    const need = inspectBridgeNeed(lineId, step);
    assert.equal(need.bilingual, true, `${lineId}/${step} 应为 bilingual`);
    assert.equal(need.masterExists, true);
    assert.ok(need.rCount >= 1 && need.pCount >= 1);
  }
  for (const [lineId, step] of [
    ['line1_bulk', 'prep_matrix'],
    ['line1_bulk', 'qc_matrix'],
    ['line2_scrna', 'scrna_qc'],
  ]) {
    const need = inspectBridgeNeed(lineId, step);
    assert.equal(need.bilingual, false, `${lineId}/${step} 应为单语言，不该触发桥接断言`);
  }
});

test('P3: strip 不改变非注释代码字节（每行都是原行的前缀）且幂等', () => {
  for (const m of masters) {
    const content = fs.readFileSync(m.abs, 'utf8');
    const stripped = stripShellAndCodeComments(content);
    const srcLines = content.split('\n');
    const outLines = stripped.split('\n');
    assert.equal(outLines.length, srcLines.length, `${m.step}: 行数变化`);
    for (let i = 0; i < srcLines.length; i += 1) {
      const src = srcLines[i].replace(/\r$/, '');
      const out = outLines[i].replace(/\r$/, '');
      assert.ok(out === '' || src.startsWith(out), `${m.step}:${i + 1} 代码字节被改动: ${JSON.stringify(src)} -> ${JSON.stringify(out)}`);
    }
    assert.equal(stripShellAndCodeComments(stripped), stripped, `${m.step}: strip 不幂等`);
  }
});

test('P3: inspectBridgeNeed 返回值结构不变（七个字段，母版缺失语义不变）', () => {
  const need = inspectBridgeNeed('line1_bulk', 'not_a_real_step_sentinel');
  assert.deepEqual(Object.keys(need).sort(), ['bilingual', 'guardWired', 'masterExists', 'masterPath', 'pCount', 'rCount', 'reason']);
  assert.equal(need.masterExists, false);
  assert.equal(need.bilingual, false);
  assert.equal(need.rCount, 0);
  assert.equal(need.pCount, 0);
  assert.match(need.reason, /母版不存在/);
});

test('P3 收紧: guardWired 只看可执行代码，注释里提 bridge_guard.sh 不算接线', () => {
  // 全仓母版巡检：guardWired 为真时，剥离注释后的代码里必须真的出现 bridge_guard.sh。
  // 反过来也检查一遍：代码里有调用就必须为真（不许把真接线判成没接）。
  const GUARD = /bridge_guard\.sh/;
  const masters = listMasters();
  assert.ok(masters.length >= 50, `母版数量异常: ${masters.length}`);
  let wired = 0;
  for (const m of masters) {
    const content = fs.readFileSync(m.abs, 'utf8');
    const code = stripShellAndCodeComments(content);
    const need = inspectBridgeNeed(m.lineId, m.step);
    assert.equal(need.guardWired, GUARD.test(code), `${m.lineId}/${m.step}: guardWired 与剥离后代码不一致`);
    if (need.guardWired) wired += 1;
  }
  assert.ok(wired >= 1, '至少应有一个母版真的调用了 bridge_guard.sh');
});

test('P3 收紧: 只在注释里提到 bridge_guard.sh 的母版判为未接线', () => {
  // 造一份"注释里有、代码里没有"的文本，验证剥离后判据的语义（纯函数层面）
  const text = [
    '#!/usr/bin/env bash',
    '# 本步骤依赖 bridge_guard.sh 做跨语言断言',
    'set -euo pipefail',
    'python3 - <<PYSCRIPT',
    'print(1)',
    'PYSCRIPT',
    '',
  ].join('\n');
  const code = stripShellAndCodeComments(text);
  assert.equal(/bridge_guard\.sh/.test(text), true);
  assert.equal(/bridge_guard\.sh/.test(code), false);
});
