#!/usr/bin/env node
/**
 * python_interpreter_gate.mjs —— 母版解释器解析门禁（生信代码专项审核）。
 *
 * 审核发现的真实阻塞：47 个母版硬编码 `python3 - <<PYSCRIPT`，而 K40 的
 * /usr/bin/python3 没有 matplotlib/numpy/scipy，真正带依赖的是 /root/venvs/bio-py。
 * 此前能跑通纯属 PATH 里碰巧有 venv —— 运行环境交给了运气。
 *
 * 采用方案：**PATH 前置注入**，不改调用行。
 * 为什么不用「把 python3 换成 $PY」：桥接 bilingual 检测靠行级计数
 * （PYTHON_CALL_RE 认「行首或分隔符后的 python3」），改写调用行会让计数漂移，
 * 把 probe_env 这类单语言母版误判成 bilingual。PATH 注入让计数完全不变。
 *
 * 判据：
 *   1. 每个含 python heredoc 的母版必须有 PATH 注入块（BIO_PY_BIN）；
 *   2. 注入块必须校验解释器可执行（不存在则报错退出，不静默降级）；
 *   3. 不得把调用行改写成 $PY 形式（那会破坏桥接计数）。
 */
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const LINES = ["line1_bulk", "line2_scrna", "line3_spatial"];

export const REQUIRED_MARKERS = Object.freeze(["BIO_PY_BIN", "export PATH="]);
/** 改写调用行的形态：出现即判失败（会破坏 bilingual 行级计数）。 */
export const REWRITTEN_CALL = /^\s*"\$PY" - <</m;

export function pythonMasters() {
  const out = [];
  for (const line of LINES) {
    const dir = path.join(REPO, "src", line, "scripts");
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name === "README.md" || e.name.endsWith(".py")) continue;
      const full = path.join(dir, e.name);
      const text = fs.readFileSync(full, "utf8");
      if (/python3 - <</.test(text)) out.push({ rel: line + "/" + e.name, full, text });
    }
  }
  return out;
}

function main() {
  const masters = pythonMasters();
  const problems = [];
  for (const m of masters) {
    const missing = REQUIRED_MARKERS.filter((k) => !m.text.includes(k));
    if (missing.length > 0) {
      problems.push(m.rel + ": 缺 PATH 注入块，缺 " + missing.join("/"));
    }
    if (REWRITTEN_CALL.test(m.text)) {
      problems.push(m.rel + ": 调用行被改写为 \"$PY\" 形态（会破坏桥接 bilingual 行级计数）");
    }
    if (!m.text.includes('if [ -x "$BIO_PY_BIN/python3" ]')) {
      problems.push(m.rel + ": 缺解释器可执行性校验（不存在的路径不许静默降级）");
    }
  }
  console.log("[python_interpreter] 扫描 " + masters.length + " 个含 python heredoc 的母版");
  for (const p of problems.slice(0, 20)) console.log("[FAIL] " + p);
  if (problems.length > 0) {
    console.log("PYTHON_INTERPRETER_FAIL " + problems.length + " 处");
    process.exit(1);
  }
  console.log("PYTHON_INTERPRETER_OK " + masters.length + " 个母版均用 PATH 注入解析解释器");
}

import { fileURLToPath } from "node:url";
const SELF = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SELF)) main();