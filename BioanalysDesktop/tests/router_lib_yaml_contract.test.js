/**
 * 自写 YAML 子集解析器的边界契约（元宝第 67 轮第一审 Q2 裁定落地）。
 *
 * 元宝指出的核心风险：受限子集 + 双引擎交叉校验本身是对的，
 * 但必须补「strict-subset 拒绝清单」与「陷阱 fixture」，
 * 否则像 YAML 1.1 的 NO/YES/on 会被静默解析成布尔，两引擎都过、语义却错。
 *
 * 本文件锁定四类边界：
 *   1. 行尾注释必须剥除（不能混进取值）；
 *   2. 空列表 [] 必须支持；
 *   3. 引号内的冒号与井号不得被当作结构符号；
 *   4. 布尔样式 token 必须原样保留为字符串，并且交叉校验能发现两个引擎的差异。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseRouterYaml } from "../../ops/router_lib.mjs";

const BASE = [
  'version: "1.0.0"',
  'routes:',
  '  - id: "r1"',
  '    name: "示例"',
  '    trigger_intent:',
  '      - "空间"',
  '    target_line_or_gate: "line3_spatial"',
  '    allowed_scripts:',
  '      - "l3_dimred_domains"',
  '    exit_criteria:',
  '      - "产物落盘"',
  '    negative_constraints:',
  '      - "跨样本建树"',
  '',
].join("\n");

test("行尾注释必须剥除，不能混进取值", () => {
  const txt = BASE.replace('- "空间"', '- "空间"  # 这是行尾注释');
  const d = parseRouterYaml(txt);
  assert.deepEqual(d.routes[0].trigger_intent, ["空间"]);
});

test("空列表 [] 必须支持", () => {
  const txt = BASE.replace("    trigger_intent:\n      - \"空间\"\n", "    trigger_intent: []\n");
  const d = parseRouterYaml(txt);
  assert.deepEqual(d.routes[0].trigger_intent, []);
});

test("引号内的冒号与井号必须原样保留", () => {
  const txt = BASE.replace('name: "示例"', 'name: "线 3: 空间 # 不是注释"');
  const d = parseRouterYaml(txt);
  assert.equal(d.routes[0].name, "线 3: 空间 # 不是注释");
});

test("布尔样式 token 必须原样保留为字符串", () => {
  const txt = BASE.replace('- "空间"', '- "NO"\n      - "on"\n      - "yes"');
  const d = parseRouterYaml(txt);
  assert.deepEqual(d.routes[0].trigger_intent, ["NO", "on", "yes"]);
});

test("CRLF 行尾必须能解析", () => {
  const d = parseRouterYaml(BASE.replace(/\n/g, "\r\n"));
  assert.equal(d.routes.length, 1);
  assert.deepEqual(d.routes[0].trigger_intent, ["空间"]);
});

test("tab 缩进必须直接抛错，不许猜", () => {
  const txt = BASE.replace("  - id:", "\t- id:");
  assert.throws(() => parseRouterYaml(txt), /缩进|无法解析/);
});
test("引号内的井号不得被当成注释截断（颜色码与 URL 片段）", () => {
  const txt = BASE
    .replace('name: "示例"', 'name: "火山图配色 #EE0000 与 #3B4992"')
    .replace('      - "产物落盘"', '      - "docs/SPEC.md#rej-001"');
  const d = parseRouterYaml(txt);
  assert.equal(d.routes[0].name, "火山图配色 #EE0000 与 #3B4992");
  assert.deepEqual(d.routes[0].exit_criteria, ["docs/SPEC.md#rej-001"]);
});
