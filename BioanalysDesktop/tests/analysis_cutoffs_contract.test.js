/**
 * 客户锁定的统计阈值必须真的进产线脚本（第二十九轮 ⑤）。
 *
 * 背景：阈值以前硬编码在母版里（|log2FC|>1 且 adj.P<0.05），客户在提交页选的三档
 * 只是写进 project.json 给人看，跑批时没人读。这条测试把"脚本必须读
 * BIOANALYS_PROJECT_JSON 的 analysis_cutoffs"钉成源码级契约，防止再退回去。
 *
 * 只做静态断言：真机执行在 k40-ubuntu 上另跑，这里保证接线不被删掉。
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const SCRIPTS = {
  deg_limma: path.join(REPO, 'src', 'line1_bulk', 'scripts', 'deg_limma'),
  bulk_figures: path.join(REPO, 'src', 'line1_bulk', 'scripts', 'bulk_figures'),
};

function readScript(name) {
  return fs.readFileSync(SCRIPTS[name], 'utf8');
}

test('两只产线脚本都从 BIOANALYS_PROJECT_JSON 读阈值，不带自己的默认值覆盖客户选择', () => {
  const problems = [];
  for (const name of Object.keys(SCRIPTS)) {
    const text = readScript(name);
    if (!text.includes('BIOANALYS_PROJECT_JSON')) {
      problems.push(name + ': 未读 BIOANALYS_PROJECT_JSON');
    }
    if (!text.includes('analysis_cutoffs')) {
      problems.push(name + ': 未取 analysis_cutoffs 块');
    }
    // 判据字段必须由服务端派生，脚本不自己猜"用不用 adj.P"
    if (!text.includes('effective_p_field')) {
      problems.push(name + ': 未按 effective_p_field 判定用 adj.P 还是名义 p');
    }
    if (!text.includes('effective_p_threshold')) {
      problems.push(name + ': 未按 effective_p_threshold 取显著性阈值');
    }
  }
  assert.deepEqual(problems, [], '阈值真源必须在 project.json，脚本只读不猜');
});

test('火山图配色按第二十九轮裁定固定：上调红 #EE0000 / 下调蓝 #3B4992 / 不显著灰 #BEBEBE', () => {
  const problems = [];
  for (const name of Object.keys(SCRIPTS)) {
    const text = readScript(name);
    for (const [label, hex] of [['上调', '#EE0000'], ['下调', '#3B4992'], ['不显著', '#BEBEBE']]) {
      if (!text.includes(hex)) problems.push(name + ': 缺' + label + '色 ' + hex);
    }
    // 上一轮的旧配色必须清干净，否则图里同时出现两套红蓝
    for (const stale of ['#D62728', '#1F77B4', '#BBBBBB']) {
      if (text.includes(stale)) problems.push(name + ': 残留旧配色 ' + stale);
    }
  }
  assert.deepEqual(problems, [], '三分类配色是验收项，不能回退');
});

test('火山阈值线与图内标注都由阈值变量驱动，不残留字面量 0.05 / ±1', () => {
  const problems = [];
  for (const name of Object.keys(SCRIPTS)) {
    const text = readScript(name);
    if (/axhline\(-np\.log10\(0\.05\)/.test(text)) {
      problems.push(name + ': 火山 p 阈值线仍写死 0.05');
    }
    if (/axvline\(-?1[,)]|geom_vline\(xintercept = c\(-1, 1\)/.test(text)) {
      problems.push(name + ': 火山 log2FC 阈值线仍写死 ±1');
    }
    if (/label = "adj p=0\.05"|"adj p=0\.05"\s*,/.test(text)) {
      problems.push(name + ': 图内标注仍写死 adj p=0.05');
    }
  }
  assert.deepEqual(problems, [], '阈值标注必须跟着客户选择走，否则图与台账对不上');
});

test('主口径只出一张火山：名义 p 与 adj.P 由客户选择决定，不两张都出冒充主结论', () => {
  const text = readScript('bulk_figures');
  assert.ok(
    text.includes('primary_suffix'),
    'bulk_figures 必须按客户选择派生 primary_suffix',
  );
  assert.ok(
    /if suffix != primary_suffix:\s*\n\s*continue/.test(text),
    '主口径循环必须跳过另一口径，避免两张图都被当成主结论',
  );
});
