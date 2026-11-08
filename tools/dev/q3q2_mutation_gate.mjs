#!/usr/bin/env node
/**
 * q3q2_mutation_gate.mjs —— Q3 状态机与 Q2 路由表的 6 条变异反证。
 *
 * Argon 第 42 轮锁定：Q3 与 Q2 各需 3 条 MUT 反证（A/B/C）。现有 mutation_gate.mjs
 * 的 7 条防线全在 Q4/T3 域（clean_workspace / metrics / ledger / static / preview），
 * 没有一条能证明 FSM 或路由表判据真的有牙。本文件补上。
 *
 * 纪律：每条变异必须是**结构性改动**（改数据流 / 改判据 / 改接线），
 * 加注释不算变异（那样测试还是绿的，等于假反证）。
 * 每条都走「基线绿 -> 变异后红」，任一不满足即整门禁红。
 *
 * 用法：node tools/dev/q3q2_mutation_gate.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FSM = path.join(REPO, "BioanalysDesktop", "server", "task_fsm.js");
const ROUTES = path.join(REPO, "BioanalysDesktop", "server", "routes", "projects.routes.js");
const SCOPE = path.join(REPO, ".tmp", "q3q2_mutation_gate");

let seq = 0;
async function importVaried(sourceText) {
  fs.mkdirSync(SCOPE, { recursive: true });
  seq += 1;
  const file = path.join(SCOPE, `varied_${seq}.mjs`);
  fs.writeFileSync(file, sourceText);
  return import(pathToFileURL(file).href);
}

/** 施加一条替换，找不到锚点直接抛（防止假变异）。 */
function mutate(source, find, replace) {
  if (!source.includes(find)) throw new Error("变异锚点未找到: " + find.slice(0, 70));
  return source.replace(find, replace);
}

/** 用纯断言表达不变量；返回 {ok, detail}。 */
async function check(label, source, assertion) {
  try {
    const mod = await importVaried(source);
    await assertion(mod);
    return { ok: true, detail: "不变量成立" };
  } catch (error) {
    return { ok: false, detail: error.message.slice(0, 160) };
  }
}

/** 一条完整反证：基线必须绿，变异后必须红。 */
async function disprove({ id, label, target, find, replace, assertBaseline, assertStillGreen }) {
  const src = fs.readFileSync(target, "utf8");
  const baseline = await check(label, src, assertBaseline);
  if (!baseline.ok) {
    return { id, label, passed: false, detail: "基线不绿: " + baseline.detail };
  }
  let varied;
  try {
    varied = mutate(src, find, replace);
  } catch (error) {
    return { id, label, passed: false, detail: error.message };
  }
  const red = await check(label, varied, assertStillGreen);
  return {
    id, label,
    passed: red.ok === false,
    detail: red.ok === false
      ? "变异被抓住: " + red.detail
      : "变异后仍绿（假反证）: " + red.detail,
  };
}

// ---------- Q3：状态机三条 ----------
const Q3 = [
  {
    id: "MUT-Q3-A",
    label: "exit 0 无回执必须判 RECEIPT_MISSING，不得假绿",
    target: FSM,
    // 结构性变异：把「无回执即失败」改成「无回执也成功」
    find: "if (hasReceipt === false) return result(TASK_STATES.FAILED, \"RECEIPT_MISSING\");",
    replace: "if (hasReceipt === false) return result(TASK_STATES.SUCCEEDED, null);",
    async assertBaseline(mod) {
      const out = mod.classifyTaskOutcome({ exitCode: 0, hasReceipt: false });
      if (out.state !== mod.TASK_STATES.FAILED || out.reason !== "RECEIPT_MISSING") {
        throw new Error("基线应判 failed/RECEIPT_MISSING，实际 " + out.state + "/" + out.reason);
      }
    },
    async assertStillGreen(mod) {
      const out = mod.classifyTaskOutcome({ exitCode: 0, hasReceipt: false });
      if (out.state !== mod.TASK_STATES.FAILED) {
        throw new Error("无回执被判成 " + out.state + "（假绿）");
      }
    },
  },
  {
    id: "MUT-Q3-B",
    label: "exit 4 锁冲突不得混同普通契约失败",
    target: FSM,
    // 结构性变异：删掉 exit 4 的特判，让它落到 [1,2,3] 或 UNKNOWN 分支
    find: "if (exitCode === 4) return result(TASK_STATES.FAILED, \"LOCK_CONFLICT\");",
    replace: "if (exitCode === 4) return result(TASK_STATES.FAILED, \"STEP_CONTRACT_FAIL\");",
    async assertBaseline(mod) {
      const out = mod.classifyTaskOutcome({ exitCode: 4 });
      if (out.reason !== "LOCK_CONFLICT" || out.retryable !== true) {
        throw new Error("基线应是 LOCK_CONFLICT 且可重试，实际 " + out.reason + "/" + out.retryable);
      }
    },
    async assertStillGreen(mod) {
      const out = mod.classifyTaskOutcome({ exitCode: 4 });
      if (out.reason !== "LOCK_CONFLICT") {
        throw new Error("锁冲突被错分类为 " + out.reason);
      }
    },
  },
  {
    id: "MUT-Q3-C",
    label: "终态不得逆向退回 running",
    target: FSM,
    // 结构性变异：撤掉 canTransition 里的终态禁令
    find: "if (TERMINAL_STATES.includes(fromState)) return false;",
    replace: "if (TERMINAL_STATES.includes(fromState)) return (TRANSITIONS[fromState] || []).includes(toState) || toState === TASK_STATES.RUNNING;",
    async assertBaseline(mod) {
      if (mod.canTransition(mod.TASK_STATES.SUCCEEDED, mod.TASK_STATES.RUNNING) !== false) {
        throw new Error("基线应禁止 succeeded -> running");
      }
    },
    async assertStillGreen(mod) {
      if (mod.canTransition(mod.TASK_STATES.SUCCEEDED, mod.TASK_STATES.RUNNING) !== false) {
        throw new Error("终态被允许退回 running");
      }
    },
  },
];

// ---------- Q2：路由表三条（静态文本不变量） ----------
function routeInvariant(src) {
  const block = src.slice(src.indexOf("const ROUTES = ["), src.indexOf("if (await dispatchRoutes("));
  const re = /method:\s*'([A-Z]+)',\s*\n\s*path:\s*'([^']+)'/g;
  const pairs = [];
  let m;
  while ((m = re.exec(block)) !== null) pairs.push(m[1] + " " + m[2]);
  // 注意：dispatchRoutes 的调用正是 block 的结束边界，不可能出现在 block 内部。
  // 判「派发是否还在」必须扫全文，否则基线就恒为红（第一版踩过这个坑）。
  return { block, pairs, whole: src };
}

async function disproveRoutes({ id, label, find, replace, invariant }) {
  const src = fs.readFileSync(ROUTES, "utf8");
  const base = routeInvariant(src);
  const baseOk = invariant(base);
  if (!baseOk.ok) return { id, label, passed: false, detail: "基线不绿: " + baseOk.detail };
  let varied;
  try { varied = mutate(src, find, replace); } catch (error) {
    return { id, label, passed: false, detail: error.message };
  }
  const red = invariant(routeInvariant(varied));
  return {
    id, label, passed: red.ok === false,
    detail: red.ok === false ? "变异被抓住: " + red.detail : "变异后仍绿: " + red.detail,
  };
}

const Q2 = [
  {
    id: "MUT-Q2-A",
    label: "路由表不得丢失 /api/projects/meta 声明",
    find: "path: '/api/projects/meta'",
    replace: "path: '/api/projects/meta_renamed'",
    invariant(r) {
      return r.pairs.some((p) => p === "GET /api/projects/meta")
        ? { ok: true, detail: "meta 在表内" }
        : { ok: false, detail: "路由表缺 /api/projects/meta" };
    },
  },
  {
    id: "MUT-Q2-B",
    label: "路由表不得出现重复 (method, path)",
    // 结构性变异：把第一条 GET 改成与第二条相同路径，制造重复
    find: "path: '/api/projects/steps'",
    replace: "path: '/api/projects/list'",
    invariant(r) {
      const paths = r.pairs;
      return new Set(paths).size === paths.length
        ? { ok: true, detail: "无重复" }
        : { ok: false, detail: "路由表出现重复条目" };
    },
  },
  {
    id: "MUT-Q2-C",
    label: "声明式派发不得被短路（dispatchRoutes 调用必须保留）",
    find: "if (await dispatchRoutes({ req, res, url, json, runJsonRoute }, ROUTES)) return true;",
    replace: "if (false && await dispatchRoutes({ req, res, url, json, runJsonRoute }, ROUTES)) return true;",
    invariant(r) {
      // 变异把调用改成 false && await dispatchRoutes(...)，文本仍在但已被短路。
      // 判据必须认「未被短路的调用」：行首就是 if (await dispatchRoutes
      return /if \(await dispatchRoutes\(\{ req, res, url, json, runJsonRoute \}, ROUTES\)\) return true;/.test(r.whole)
        ? { ok: true, detail: "派发仍在且未短路" }
        : { ok: false, detail: "声明式派发被短路或移除" };
    },
  },
];

async function main() {
  fs.mkdirSync(SCOPE, { recursive: true });
  const results = [];
  for (const m of Q3) results.push(await disprove(m));
  for (const m of Q2) results.push(await disproveRoutes(m));

  console.log("[q3q2_mutation] 6 条变异反证");
  for (const r of results) {
    console.log("  " + (r.passed ? "[OK]  " : "[FAIL]") + " " + r.id.padEnd(12) + r.label);
    console.log("         " + r.detail);
  }
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log("Q3Q2_MUTATION_FAIL " + failed.length + " 条未抓住");
    process.exit(1);
  }
  console.log("Q3Q2_MUTATION_OK 6 条全部基线绿且变异后红");
}

main().catch((error) => {
  console.error("Q3Q2_MUTATION_ERROR " + error.message);
  process.exit(1);
});