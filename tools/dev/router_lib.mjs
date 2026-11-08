/**
 * ops/router_lib.mjs —— 声明式路由的解析与确定性匹配。
 *
 * 为什么自己写解析器：本项目 Node 侧没有 YAML 依赖，为一份受控格式的路由表
 * 引入第三方解析器会抬高安装负担。这里只支持 router.yaml 实际用到的构造：
 *   顶层 key: value
 *   顶层 key: 后接 2 空格缩进的列表
 *   列表项 "- key: value" 开启一个对象，其后 4 空格缩进的 key: value 为字段
 *   4 空格 key: 后接 6 空格缩进的 "- value" 为字符串列表
 * ops/router_gate.mjs 会用 PyYAML（若可用）交叉校验解析结果，防解析器漂移。
 *
 * 匹配是纯确定性打分：命中 trigger_intent 的条数优先，命中词更长者次优先，
 * 仍相同则按路由声明顺序。没有命中返回 null，绝不猜。
 */
import fs from "node:fs";
import path from "node:path";

const REQUIRED_FIELDS = [
  "id",
  "name",
  "trigger_intent",
  "target_line_or_gate",
  "allowed_scripts",
  "exit_criteria",
  "negative_constraints",
];

/**
 * 剥除行尾注释：只在引号外、且 # 前面是空白（或行首）时截断。
 * 不剥的话 `- "解卷积"  # 注释` 会把注释一起吃进取值，属于静默错误。
 */
function stripInlineComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function unquote(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

export function parseRouterYaml(text) {
  const out = { version: null, routes: [] };
  let cur = null;
  let listKey = null;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const line = stripInlineComment(raw).trim();
    if (!line) continue;

    if (indent === 0) {
      const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!m) throw new Error("router.yaml 顶层行无法解析: " + raw);
      const [, k, v] = m;
      if (v === "") {
        if (k === "routes") { cur = null; listKey = null; }
      } else if (k === "version") {
        out.version = unquote(v);
      }
      continue;
    }

    if (indent === 2 && line.startsWith("- ")) {
      cur = {};
      listKey = null;
      out.routes.push(cur);
      const body = line.slice(2).trim();
      const m = body.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (m) {
        const [, k, v] = m;
        if (v === "") listKey = k;
        else cur[k] = unquote(v);
      }
      continue;
    }

    if (indent === 4 && cur) {
      const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!m) throw new Error("router.yaml 字段行无法解析: " + raw);
      const [, k, v] = m;
      if (v === "") {
        listKey = k;
        cur[k] = [];
      } else if (v === "[]") {
        // 空列表：必须显式支持，否则会被当成字符串 "[]" 静默通过校验。
        listKey = null;
        cur[k] = [];
      } else if (v.startsWith("[") || v.endsWith("]")) {
        // 流式列表暂不支持：宁可报错，也不要把 ["a","b"] 当字符串收下。
        throw new Error("router.yaml 不支持流式列表，请改用缩进列表: " + raw);
      } else {
        listKey = null;
        cur[k] = unquote(v);
      }
      continue;
    }

    if (indent === 6 && cur && listKey && line.startsWith("- ")) {
      cur[listKey].push(unquote(line.slice(2)));
      continue;
    }

    throw new Error("router.yaml 出现未支持的缩进行: " + raw);
  }
  return out;
}

export function validateRouter(doc, { modIds, opsScripts, seriesIds }) {
  const errs = [];
  const seen = new Set();
  const mods = new Set(modIds);
  const ops = new Set(opsScripts);
  const series = new Set(seriesIds);

  for (const [i, r] of doc.routes.entries()) {
    const tag = "routes[" + i + "]" + (r.id ? " " + r.id : "");
    for (const f of REQUIRED_FIELDS) {
      if (!(f in r)) errs.push(tag + " 缺字段 " + f);
    }
    if (r.id) {
      if (seen.has(r.id)) errs.push(tag + " id 重复");
      seen.add(r.id);
    }
    // ops 脚本允许写成 "xxx.mjs" 或带目录前缀，两种都归一后再比对，
    // 否则路由表里带 ops/ 前缀的合法引用会被误判成不存在。
    const normOps = (s) => s.replace(/^(ops|tools\/dev|tools\/reporting|tools\/ops)\//, "");
    for (const s of r.allowed_scripts || []) {
      if (!mods.has(s) && !ops.has(normOps(s))) {
        errs.push(tag + " allowed_scripts 引用了不存在的脚本: " + s);
      }
    }
    const t = r.target_line_or_gate;
    if (t && !series.has(t) && !ops.has(normOps(t))) {
      errs.push(tag + " target_line_or_gate 不存在: " + t);
    }
    for (const key of ["trigger_intent", "allowed_scripts", "exit_criteria", "negative_constraints"]) {
      const v = r[key];
      if (v !== undefined && (!Array.isArray(v) || v.length === 0)) {
        errs.push(tag + " " + key + " 必须是非空列表");
      }
    }
  }
  return errs;
}

/** 确定性匹配：命中条数 > 最长命中词长度 > 声明顺序。无命中返回 null。 */
export function matchRoute(routes, scenario) {
  const s = String(scenario || "").toLowerCase();
  let best = null;
  for (const [i, r] of routes.entries()) {
    let hits = 0;
    let longest = 0;
    for (const tok of r.trigger_intent || []) {
      const t = String(tok).toLowerCase();
      if (t && s.includes(t)) {
        hits += 1;
        if (t.length > longest) longest = t.length;
      }
    }
    if (hits === 0) continue;
    const cand = { route: r, hits, longest, order: i };
    if (
      !best ||
      cand.hits > best.hits ||
      (cand.hits === best.hits && cand.longest > best.longest)
    ) {
      best = cand;
    }
  }
  return best ? { id: best.route.id, hits: best.hits, longest: best.longest } : null;
}

/**
 * 返回按匹配强度降序排列的候选路由（含全部命中项）。
 * 给黄金集并列度（ambiguous / near_tie）度量用：
 * 只看第一名不足以发现「靠声明顺序险胜」的路由。
 */
export function rankRoutes(routes, scenario) {
  const s = String(scenario || "").toLowerCase();
  const out = [];
  for (const [i, r] of routes.entries()) {
    let hits = 0;
    let longest = 0;
    for (const tok of r.trigger_intent || []) {
      const t = String(tok).toLowerCase();
      if (t && s.includes(t)) {
        hits += 1;
        if (t.length > longest) longest = t.length;
      }
    }
    if (hits > 0) out.push({ id: r.id, hits, longest, order: i });
  }
  out.sort((a, b) => b.hits - a.hits || b.longest - a.longest || a.order - b.order);
  return out;
}

export function loadModIds(workflowsPath) {
  const d = JSON.parse(fs.readFileSync(workflowsPath, "utf8"));
  const ids = [];
  const series = [];
  for (const s of d.series || []) {
    series.push(s.id);
    for (const st of s.stages || []) {
      for (const m of st.mods || []) ids.push(m.id);
    }
  }
  return { modIds: ids, seriesIds: series };
}

export function listOpsScripts(opsDir) {
  return fs
    .readdirSync(opsDir)
    .filter((f) => f.endsWith(".mjs"))
    .sort();
}

export function loadRouter(routerPath) {
  return parseRouterYaml(fs.readFileSync(routerPath, "utf8"));
}

export { REQUIRED_FIELDS };
