/**
 * 路由黄金集评测（Argon 第 66 轮 Q4a 裁定落地）。
 *
 * 它测的不是「自然语言理解有多强」，而是**回归**：
 * 路由表被改动后，真实历史场景的落点是否还和登记时一致。
 * 因此黄金集由本项目真实任务口径撰写，期望值来自当时的实际执行路径。
 *
 * 判据（Argon 定的硬底线）：
 *   1. 确定性匹配器在黄金集上准确率必须 100%（27/27），不接受 96%；
 *   2. 每条 case 引用的 expected_mod_or_script 必须真实存在；
 *   3. 改坏 ROUTER.yaml 任一条 trigger_intent，本测试必须变红。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRouter, loadModIds, listOpsScripts, matchRoute } from "../../ops/router_lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const GOLDEN = path.join(HERE, "eval/golden_routing.json");
const ROUTER = path.join(REPO, "ROUTER.yaml");

function loadCases() {
  return JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
}

test("黄金集至少 25 条，且字段齐全", () => {
  const cases = loadCases();
  assert.ok(cases.length >= 25, "黄金集至少 25 条，实际 " + cases.length);
  const seen = new Set();
  for (const c of cases) {
    for (const f of ["id", "input_scenario", "expected_route_id", "expected_mod_or_script", "expected_artifact_or_error"]) {
      assert.ok(c[f], c.id + " 缺字段 " + f);
    }
    assert.ok(!seen.has(c.id), "case id 重复: " + c.id);
    seen.add(c.id);
  }
});

test("每条 case 期望的 Mod/脚本必须真实存在", () => {
  const { modIds } = loadModIds(path.join(REPO, "tools/bio/workflows.json"));
  const ops = new Set(listOpsScripts(path.join(REPO, "ops")));
  const mods = new Set(modIds);
  const bad = [];
  for (const c of loadCases()) {
    const s = c.expected_mod_or_script;
    const norm = s.startsWith("ops/") ? s.slice(4) : s;
    if (!mods.has(s) && !ops.has(norm)) bad.push(c.id + " -> " + s);
  }
  assert.deepEqual(bad, [], "期望脚本不存在：" + bad.join("; "));
});

test("确定性匹配器在黄金集上必须 100% 准确", () => {
  const doc = loadRouter(ROUTER);
  const bad = [];
  for (const c of loadCases()) {
    const r = matchRoute(doc.routes, c.input_scenario);
    const got = r ? r.id : null;
    if (got !== c.expected_route_id) {
      bad.push(c.id + " 期望 " + c.expected_route_id + " 实得 " + got + " | " + c.input_scenario);
    }
  }
  assert.deepEqual(bad, [], "路由偏移：" + bad.join("; "));
});

test("未知场景必须返回 null，不许瞎猜一个路由", () => {
  const doc = loadRouter(ROUTER);
  const r = matchRoute(doc.routes, "今天天气怎么样");
  assert.equal(r, null, "无关键词命中时必须返回 null");
});
