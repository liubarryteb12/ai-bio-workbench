/**
 * 母版内自引用符号必须有定义（GSE233814 真机 step14 暴露）。
 *
 * 病灶：enrichment_figures 在物种缺席分支里调 fail(...)，但全文从未 def fail。
 * 该分支在 GSE192741（双物种齐全）上永远不执行，历次真机都没触发；
 * 换成单物种数据集后 step14 直接 NameError 崩栈，把「应当明确报错」
 * 变成了 Python 堆栈噪音。
 *
 * 判据：母版 python 段里被调用的自有辅助函数，必须有 def。
 * 只查自有辅助名，库函数（np.sum / pd.read_csv 这类带点调用）不参与。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LINES = ["line1_bulk", "line2_scrna", "line3_spatial"];

/** 项目自有的辅助函数名（母版里手工定义的那批）。 */
const HELPER_NAMES = ["fail", "log", "save", "num", "rd", "trunc", "cat_colors", "caption", "layout_fix", "legend_out", "fit_text_edges", "wrap_label", "read_cutoffs", "input_fingerprints", "_sha256_of"];

function masters() {
  const out = [];
  for (const line of LINES) {
    const dir = path.join(REPO, "src", line, "scripts");
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name === "README.md") continue;
      if (/\.(py|R|sh|md|json|tsv|csv)$/i.test(e.name)) continue;
      out.push({ rel: line + "/" + e.name, abs: path.join(dir, e.name) });
    }
  }
  return out;
}

/** 取 python heredoc 段并剔除整行注释（注释里的调用不算调用）。 */
function pythonCode(text) {
  const m = text.match(/python3\s+-\s*<<['"]?(\w+)['"]?/);
  if (!m) return "";
  const start = m.index + m[0].length;
  const end = text.indexOf("\n" + m[1], start);
  const seg = end > start ? text.slice(start, end) : text.slice(start);
  return seg.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
}

test("母版 python 段调用的自有辅助函数都有 def", () => {
  const offenders = [];
  for (const master of masters()) {
    const code = pythonCode(fs.readFileSync(master.abs, "utf8"));
    if (!code.trim()) continue;
    for (const fn of HELPER_NAMES) {
      const called = new RegExp("(^|[^.\\w])" + fn + "\\s*\\(").test(code);
      // def 可以嵌套在函数体内（如 read_cutoffs 里的 def num），缩进也算已定义
      const defined = new RegExp("^\\s*def\\s+" + fn + "\\s*\\(", "m").test(code);
      if (called && !defined) offenders.push(master.rel + " 调用 " + fn + "() 但无 def");
    }
  }
  assert.deepEqual(offenders, [], "以下母版有未定义的辅助函数：" + offenders.join(" | "));
});

test("正对照：故意引用无 def 的辅助名必须被抓出", () => {
  const code = ["def log(m):", "    print(m)", "", "log(fail('x'))"].join("\n");
  const called = /(^|[^.\w])fail\s*\(/.test(code);
  const defined = /^def\s+fail\s*\(/m.test(code);
  assert.equal(called && !defined, true, "判据必须能抓出 fail 未定义");
});
