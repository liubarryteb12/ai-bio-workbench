/**
 * ml_diagnostics 事件方向与单因素检验契约（2026-11-08 用户审图反馈）。
 *
 * 背景：
 *   1) 旧代码 `pos = labels[0]` 按字典序把 Ctrl 当阳性，DCA 的 treat-all
 *      起点变成 12/70=0.171，整张图回答的是「识别 Ctrl」；
 *   2) 旧单因素 logistic 在完美分离下 Wald p 全部退化为 ~1，
 *      50 个 hub 池基因被判 0 个显著；
 *   3) DCA 需要同时报告事件数/非事件数与 5-20% 临床阈值段。
 *
 * 只做源码级静态断言，真机执行与图件目检在 ADB 通道另行验证。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = fs.readFileSync(
  path.join(REPO, 'tools', 'bio', 'line1_bulk', 'scripts', 'ml_diagnostics'),
  'utf8',
);
const HUB_SOURCE = fs.readFileSync(
  path.join(REPO, 'tools', 'bio', 'line1_bulk', 'scripts', 'ml_hub_analysis'),
  'utf8',
);

test('正类取项目主对比 case，不能按字典序 labels[0]', () => {
  assert.match(SOURCE, /BIOANALYS_PROJECT_JSON/,
    '必须读取 project.json 的 grouping_design 主对比');
  assert.match(SOURCE, /case_group/,
    '必须显式解析 case 组');
  assert.match(SOURCE, /BIO_CASE_GROUP/,
    '必须允许 BIO_CASE_GROUP 覆盖');
  assert.equal(/pos\s*=\s*labels\[0\]/.test(SOURCE), false,
    '不得再把字典序第一组当阳性');
});

test('单因素筛选使用 Firth 惩罚似然（分离稳健）', () => {
  assert.match(HUB_SOURCE, /def firth_univariate/,
    '缺少 Firth 单因素实现');
  assert.match(HUB_SOURCE, /firth_lrt/,
    'p 值必须来自 Firth 惩罚似然比检验');
  assert.equal(/sm\.Logit\(/.test(HUB_SOURCE), false,
    '不得回退到在完美分离下发散的普通 MLE');
});

test('DCA 报告事件数、5-20% 临床区间与 Platt 敏感性曲线', () => {
  assert.match(SOURCE, /clinical window 5-20%/,
    'DCA 必须标出 5-20% 临床阈值段');
  assert.match(SOURCE, /events=%d, non-events=%d/,
    'DCA 图注必须写事件/非事件数');
  assert.match(SOURCE, /dca_platt/,
    '必须输出交叉拟合 Platt 敏感性曲线');
});
