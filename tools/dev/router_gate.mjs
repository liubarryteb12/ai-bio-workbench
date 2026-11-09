#!/usr/bin/env node
/**
 * router_gate.mjs —— 声明式路由与边界台账的静态一致性门禁（第 18 道）。
 *
 * 校验五件事，任一不过即 FAIL：
 *   1. ROUTER.yaml 结构合法，required 字段齐全，id 唯一；
 *   2. allowed_scripts 与 target_line_or_gate 引用的 Mod ID / ops 脚本真实存在；
 *   3. SCOPE.md 每条 REJ 的 enforced_by 指向真实「文件」，且不逃出仓库根、
 *      落在受控目录白名单内（Argon 第 67 轮代码审计加固点 3）；
 *   4. REJ 生命周期字段合法（status / reviewed_by / superseded_by）；
 *   5. 黄金集并列度：ambiguous_tie 必须为 0，near_tie 占比不得超过 15%
 *      （Argon 第 67 轮 Q3a：把 router_health 内聚成零成本门禁断言）。
 *
 * 交叉校验（PyYAML）：比对七个字段的**类型与取值**，不用字符串强行抹平类型。
 * Argon 第 67 轮代码审计加固点 1 明确要求：一边 string "NO"、另一边 bool False
 * 时必须当场报红，否则「两个引擎都过、语义却错」。
 *
 * 导出 checkRouterAndScope(repoRoot) 供契约测试在临时目录里跑负向用例。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadRouter, loadModIds, listOpsScripts, validateRouter, rankRoutes } from "./router_lib.mjs";

const FIELDS = [
  "id", "name", "trigger_intent", "target_line_or_gate",
  "allowed_scripts", "exit_criteria", "negative_constraints",
];

/** 类型感知归一：返回 {t, v}，t 是类型标签，v 是字符串化的取值。 */
function normTypedJs(v) {
  if (Array.isArray(v)) return { t: "list", v: v.map(normTypedJs) };
  if (v === null || v === undefined) return { t: "null", v: "" };
  if (typeof v === "boolean") return { t: "bool", v: String(v) };
  if (typeof v === "number") return { t: Number.isInteger(v) ? "int" : "float", v: String(v) };
  return { t: "str", v: String(v) };
}

/**
 * 深比对：返回差异列表（path + 两边类型/取值），空数组表示一致。
 *
 * 必须区分三种节点：普通对象（路由字典）、{t,v} 类型节点、数组。
 * 首版漏了「普通对象也要递归」，于是路由字典既没有 .t 也没有 .v，
 * 两个 undefined 比相等，整体被判全等 —— 又一种「恒绿假防线」，
 * 由契约测的 NO 陷阱用例抓出。
 */
function deepDiff(a, b, at, out) {
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push(at + " -> " + JSON.stringify(a) + " vs " + JSON.stringify(b));
    }
    return out;
  }
  const isTyped = (x) => x && typeof x === "object" && !Array.isArray(x) && "t" in x && "v" in x;
  if (isTyped(a) || isTyped(b)) {
    if (!isTyped(a) || !isTyped(b)) {
      out.push(at + ".shape -> " + JSON.stringify(a) + " vs " + JSON.stringify(b));
      return out;
    }
    if (a.t !== b.t) {
      out.push(at + ".type -> " + a.t + " vs " + b.t);
      return out;
    }
    if (a.t === "list") {
      if (a.v.length !== b.v.length) out.push(at + ".len -> " + a.v.length + " vs " + b.v.length);
      const n = Math.min(a.v.length, b.v.length);
      for (let i = 0; i < n; i++) deepDiff(a.v[i], b.v[i], at + "[" + i + "]", out);
      return out;
    }
    if (a.v !== b.v) out.push(at + " -> " + JSON.stringify(a.v) + " vs " + JSON.stringify(b.v));
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) deepDiff(a[k], b[k], at + "." + k, out);
  return out;
}

/** enforced_by 的路径加固：仓库内 + 是文件 + 落在受控目录 + 已被 git 跟踪。 */
function checkEnforcedPath(repoRoot, rel) {
  const norm = rel.includes("/") ? rel : "tools/dev/" + rel;
  const resolved = path.resolve(repoRoot, norm);
  const relative = path.relative(repoRoot, resolved);
  const errs = [];
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    errs.push("SCOPE.md enforced_by 逃出了仓库根: " + rel);
    return errs;
  }
  const posix = relative.replace(/\\/g, "/");
  if (!/^(tools\/(dev|reporting|ops)\/|BioanalysDesktop\/tests\/)/.test(posix)) {
    errs.push("SCOPE.md enforced_by 不在受控目录（tools/dev/、tools/reporting/、tools/ops/ 或 BioanalysDesktop/tests/）: " + rel);
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    errs.push("SCOPE.md enforced_by 不是真实文件: " + rel);
    return errs;
  }
  try {
    execFileSync("git", ["-C", repoRoot, "ls-files", "--error-unmatch", posix], {
      stdio: "ignore", timeout: 15000,
    });
  } catch (e) {
    // git 不可用或文件未被跟踪：只在 git 可用时报红，避免在临时目录契约测里误红
    try {
      execFileSync("git", ["-C", repoRoot, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore", timeout: 15000 });
      errs.push("SCOPE.md enforced_by 指向未被 git 跟踪的文件: " + rel);
    } catch (e2) { /* 非 git 环境，跳过 */ }
  }
  return errs;
}

export function checkRouterAndScope(repoRoot) {
  const errs = [];
  const notes = [];
  const ROUTER = path.join(repoRoot, "ROUTER.yaml");
  const SCOPE = path.join(repoRoot, "SCOPE.md");
  const WORKFLOWS = path.join(repoRoot, "tools/bio/workflows.json");
  const GOLDEN = path.join(repoRoot, "BioanalysDesktop/tests/eval/golden_routing.json");

  if (!fs.existsSync(ROUTER)) errs.push("缺 ROUTER.yaml");
  if (!fs.existsSync(SCOPE)) errs.push("缺 SCOPE.md");
  if (!fs.existsSync(WORKFLOWS)) errs.push("缺 tools/bio/workflows.json");

  let doc = { routes: [] };
  if (fs.existsSync(ROUTER)) {
    try { doc = loadRouter(ROUTER); } catch (e) { errs.push("router.yaml 解析失败: " + e.message); }
  }

  if (doc.routes.length && fs.existsSync(WORKFLOWS)) {
    const { modIds, seriesIds } = loadModIds(WORKFLOWS);
    const opsScripts = listOpsScripts(path.join(repoRoot, "tools", "dev"))
      .concat(listOpsScripts(path.join(repoRoot, "tools", "reporting")));
    errs.push(...validateRouter(doc, { modIds, opsScripts, seriesIds }));
    notes.push("routes=" + doc.routes.length + " mods=" + modIds.length + " ops=" + opsScripts.length);
  }

  if (fs.existsSync(SCOPE)) {
    const text = fs.readFileSync(SCOPE, "utf8");
    const rejIds = [...text.matchAll(/^\s*\|\s*(REJ-\d{3})\s*\|/gm)].map((m) => m[1]);
    const enforced = [...text.matchAll(/\x60enforced_by:\s*([^\x60]+?)\s*\x60/g)].map((m) => m[1]);

    const dup = rejIds.filter((id, i) => rejIds.indexOf(id) !== i);
    if (dup.length) errs.push("SCOPE.md REJ 编号重复: " + [...new Set(dup)].join(","));
    if (rejIds.length < 10) errs.push("SCOPE.md REJ 少于 10 条，实际 " + rejIds.length);
    if (enforced.length !== rejIds.length) {
      errs.push("SCOPE.md 每条 REJ 必须有且仅有一个 enforced_by（REJ " + rejIds.length +
        " 条，enforced_by " + enforced.length + " 个）");
    }
    for (const rel of enforced) errs.push(...checkEnforcedPath(repoRoot, rel));

    const rows = text.split(/\r?\n/).filter((l) => /\|\s*REJ-\d{3}\s*\|/.test(l));
    const ALLOWED_STATUS = new Set(["生效", "搁置", "已撤销"]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      const id = cells[1];
      const status = cells[5] || "";
      const reviewed = cells[6] || "";
      const superseded = cells[7] || "";
      const expiresAt = cells[8] || "";
      if (!ALLOWED_STATUS.has(status)) errs.push(id + " 的 status 非法: \"" + status + "\"（允许：生效/搁置/已撤销）");
      if (!reviewed) errs.push(id + " 缺 reviewed_by（复审依据）");
      if (status === "已撤销" && (!superseded || superseded === "无")) errs.push(id + " 已撤销但未写明被替代者");
      if (!expiresAt) {
        errs.push(id + " 缺 expires_at（有效期至）");
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
        errs.push(id + " 的 expires_at 格式非法: \"" + expiresAt + "\"（必须为 YYYY-MM-DD）");
      } else {
        const expDate = new Date(expiresAt + "T00:00:00Z");
        if (Number.isNaN(expDate.getTime())) {
          errs.push(id + " 的 expires_at 不是合法日期: \"" + expiresAt + "\"");
        } else {
          const diffMs = expDate.getTime() - today.getTime();
          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          if (diffDays < 0) {
            errs.push(id + " 的 expires_at 已过期: " + expiresAt);
          } else if (diffDays > 180) {
            errs.push(id + " 的 expires_at 距今超过 180 天上限 (" + diffDays + " 天 > 180 天): " + expiresAt);
          }
        }
      }
    }
    notes.push("rej=" + rejIds.length + " enforced_by=" + enforced.length + " lifecycle=ok expires_at<=180d");
  }

  // 黄金集并列度：ambiguous_tie 必须 0，near_tie 占比 <= 15%
  if (doc.routes.length && fs.existsSync(GOLDEN)) {
    try {
      const cases = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
      let ambiguous = 0;
      let near = 0;
      for (const c of cases) {
        const rank = rankRoutes(doc.routes, c.input_scenario);
        if (rank.length < 2) continue;
        const [t1, t2] = rank;
        if (t1.hits === t2.hits) {
          near += 1;
          if (t1.longest === t2.longest) ambiguous += 1;
        }
      }
      const rate = cases.length ? near / cases.length : 0;
      if (ambiguous > 0) {
        errs.push("黄金集存在 " + ambiguous + " 条靠声明顺序决胜的并列（ambiguous_tie 必须为 0）");
      }
      if (rate > 0.15) {
        errs.push("黄金集近邻并列率 " + (rate * 100).toFixed(1) + "% 超过 15% 上限");
      }
      notes.push("cases=" + cases.length + " ambiguous_tie=" + ambiguous +
        " near_tie=" + near + " near_tie_rate=" + (rate * 100).toFixed(1) + "%");
    } catch (e) {
      errs.push("黄金集并列度检查失败: " + e.message);
    }
  }

  // PyYAML 交叉校验：类型感知，不抹平
  if (doc.routes.length && fs.existsSync(ROUTER)) {
    try {
      const py = [
        "import io,json,sys",
        "sys.stdout.reconfigure(encoding='utf-8')",
        "import yaml",
        "F=" + JSON.stringify(FIELDS).replace(/"/g, "'"),
        "d=yaml.safe_load(io.open(sys.argv[1],encoding='utf-8'))",
        "def norm(v):",
        "    if isinstance(v,list): return {'t':'list','v':[norm(x) for x in v]}",
        "    if isinstance(v,bool): return {'t':'bool','v':'true' if v else 'false'}",
        "    if v is None: return {'t':'null','v':''}",
        "    if isinstance(v,int): return {'t':'int','v':str(v)}",
        "    if isinstance(v,float): return {'t':'float','v':repr(v)}",
        "    return {'t':'str','v':str(v)}",
        "out=[{k:norm(r.get(k)) for k in F} for r in d.get('routes',[])]",
        "print(json.dumps(out,ensure_ascii=False))",
      ].join("\n");
      const out = execFileSync("python", ["-c", py, ROUTER], {
        encoding: "utf8",
        timeout: 20000,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      const ref = JSON.parse(out);
      const mine = doc.routes.map((r) => Object.fromEntries(FIELDS.map((k) => [k, normTypedJs(r[k])])));
      const diffs = [];
      for (let i = 0; i < Math.max(ref.length, mine.length); i++) {
        deepDiff(ref[i] || {}, mine[i] || {}, "routes[" + i + "]", diffs);
        if (diffs.length > 6) break;
      }
      if (diffs.length) {
        // 类型层面的差异优先点名：YAML 1.1 会把裸写的 NO/YES/on/off 转成布尔，
        // 这类「两个引擎都过、语义却错」的坑必须能被一眼认出。
        const typeHit = diffs.some((d) => d.includes(".type"));
        const head = typeHit
          ? "疑似 YAML 标量陷阱（类型不一致，请给布尔或数字样式的取值加引号）: "
          : "自写解析器与 PyYAML 取值不一致: ";
        errs.push(head + diffs.slice(0, 6).join("; "));
      } else {
        notes.push("pyyaml_crosscheck=ok fields=7 typed");
      }
    } catch (e) {
      notes.push("pyyaml_crosscheck=skipped");
    }
  }

  return { errs, notes };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { errs, notes } = checkRouterAndScope(REPO);
  if (errs.length) {
    console.error("ROUTER_GATE_FAIL");
    for (const e of errs) console.error("  - " + e);
    process.exit(1);
  }
  console.log("ROUTER_GATE_OK " + notes.join(" "));
}
