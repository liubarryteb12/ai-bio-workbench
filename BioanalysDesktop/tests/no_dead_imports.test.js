/**
 * 路由模块的死 import 守卫（Q2 收口后新增）。
 *
 * 背景：Q2 把 8 个端点的处理体移入 services/ 后，projects.routes.js 留下 21 个
 * 已成死代码的 import。这类残留不会让测试变红，只会让读代码的人以为模块还在用
 * 那些依赖，长期累积成认知负担。本守卫用「import 行的符号必须在文件其余部分再出现」
 * 判据，把死 import 钉死。
 */
import test from "node:test";
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROUTES = path.join(REPO, "BioanalysDesktop", "server", "routes", "projects.routes.js");

/** 从 import 语句里抽符号名（支持 {a, b as c} 与 default）。 */
function importedSymbols(src) {
  const out = [];
  const re = /import\s+(?:\*\s+as\s+|)([\w$]+|\{[^}]*\})\s*(?:as\s+[\w$]+)?\s*from\s+['"].+?['"];/g;
  for (const m of src.matchAll(re)) {
    const raw = m[1].trim();
    if (raw.startsWith("{")) {
      for (const part of raw.slice(1, -1).split(",")) {
        const t = part.trim();
        if (!t) continue;
        // a as b 取 b（本地名），否则取 a
        const local = t.includes(" as ") ? t.split(" as ")[1].trim() : t;
        out.push(local);
      }
    } else {
      out.push(raw);
    }
  }
  return out;
}

/** 去掉 import 语句后的正文。 */
function bodyWithoutImports(src) {
  return src.replace(/^import\s+[^;]+;/gm, "");
}

test("projects.routes.js 没有死 import（每个导入符号在正文里都再出现）", () => {
  const src = fs.readFileSync(ROUTES, "utf8");
  const body = bodyWithoutImports(src);
  const dead = [];
  for (const sym of importedSymbols(src)) {
    // 用词边界匹配，避免 a 命中 abc
    const re = new RegExp("(^|[^\\w$.])" + sym.replace(/[$]/g, "\\$&") + "([^\\w$]|$)");
    if (!re.test(body)) dead.push(sym);
  }
  assert.equal(dead.length, 0,
    "projects.routes.js 存在死 import: " + dead.join(", "));
});

test("守卫本身能识别死 import（正负样本自检）", () => {
  const fake = [
    "import { usedThing, deadThing } from './x.js';",
    "usedThing();",
  ].join("\n");
  const body = bodyWithoutImports(fake);
  const syms = importedSymbols(fake);
  assert.deepEqual(syms.sort(), ["deadThing", "usedThing"]);
  assert.equal(new RegExp("(^|[^\\w$.])usedThing([^\\w$]|$)").test(body), true);
  assert.equal(new RegExp("(^|[^\\w$.])deadThing([^\\w$]|$)").test(body), false);
});