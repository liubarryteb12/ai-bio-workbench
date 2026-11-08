/**
 * 母版解释器 PATH 注入门禁契约（生信代码专项审核）。
 *
 * 审核发现：47 个母版硬编码 python3，K40 的 /usr/bin/python3 缺 matplotlib，
 * 真依赖在 /root/venvs/bio-py。采用 PATH 前置注入而非改写调用行 —— 后者会破坏
 * 桥接 bilingual 的行级计数（实测把 probe_env 误判成 bilingual）。
 */
import test from "node:test";
import assert from "assert";
import { execFileSync } from "child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pythonMasters, REQUIRED_MARKERS, REWRITTEN_CALL } from "../../tools/dev/python_interpreter_gate.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = path.join(REPO, "tools", "dev", "python_interpreter_gate.mjs");

test("门禁可通过：47 个 python 母版均用 PATH 注入", () => {
  const out = execFileSync(process.execPath, [GATE], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /PYTHON_INTERPRETER_OK/);
  assert.match(out, /扫描 47 个/);
});

test("必需标记是 BIO_PY_BIN 与 export PATH=", () => {
  assert.deepEqual([...REQUIRED_MARKERS], ["BIO_PY_BIN", "export PATH="]);
});

test("改写调用行的形态会被判失败（保护 bilingual 计数）", () => {
  assert.equal(REWRITTEN_CALL.test('"$PY" - <<\'PYSCRIPT\''), true);
  assert.equal(REWRITTEN_CALL.test("python3 - <<\'PYSCRIPT\'"), false, "原形态不应被判失败");
});

test("所有母版仍保留原生 python3 调用（行级计数不变）", () => {
  for (const m of pythonMasters()) {
    assert.ok(/python3 - <</.test(m.text), m.rel + " 调用行被改写，桥接计数会漂移");
  }
});

test("注入块含可执行性校验，不做静默降级", () => {
  for (const m of pythonMasters()) {
    assert.ok(m.text.includes('if [ -x "$BIO_PY_BIN/python3" ]'), m.rel + " 缺可执行性校验");
  }
});