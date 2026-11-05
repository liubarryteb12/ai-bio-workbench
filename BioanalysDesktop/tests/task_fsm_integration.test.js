/**
 * Q3 调用点收口契约：run.js 与 reconcile.js 必须真正引用 task_fsm.js。
 *
 * Argon 判据要求「散落 if/else 全部改为调用 task_fsm.js」。这里钉死三件事：
 *  1. run.js 导入并调用 classifyTaskOutcome，失败日志带 [FSM:原因码] 前缀；
 *  2. reconcile.js 导入 FSM 枚举且提供 RECONCILE_TO_FSM 映射；
 *  3. 映射覆盖全部 5 个对账态。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVER = path.join(REPO, "BioanalysDesktop", "server");

test("run.js 真正调用 classifyTaskOutcome 并给失败日志加 FSM 原因码", () => {
  const src = fs.readFileSync(path.join(SERVER, "run.js"), "utf8");
  assert.match(src, /from '\.\/task_fsm\.js'/, "run.js 未导入 task_fsm");
  assert.match(src, /classifyTaskOutcome\(/, "run.js 未调用 classifyTaskOutcome");
  assert.match(src, /\[FSM:\$\{fsmOutcome\.reason\}\]/, "失败日志缺 FSM 原因码前缀");
});

test("reconcile.js 引用 FSM 真源，不再自己发明终态枚举", async () => {
  const src = fs.readFileSync(path.join(SERVER, "reconcile.js"), "utf8");
  assert.match(src, /from '\.\/task_fsm\.js'/, "reconcile.js 未导入 task_fsm");
  assert.match(src, /TASK_STATES\.SUCCEEDED/, "终态未引用 FSM 枚举");
  const mod = await import(pathToFileURL(path.join(SERVER, "reconcile.js")).href);
  assert.ok(mod.RECONCILE_TO_FSM, "缺 RECONCILE_TO_FSM 映射");
});

test("RECONCILE_TO_FSM 覆盖全部 5 个对账态且都指向合法 FSM 状态", async () => {
  const { RECONCILE_TO_FSM, RECONCILE_STATES } = await import(pathToFileURL(path.join(SERVER, "reconcile.js")).href);
  const { TASK_STATES } = await import(pathToFileURL(path.join(SERVER, "task_fsm.js")).href);
  const valid = Object.values(TASK_STATES);
  for (const state of RECONCILE_STATES) {
    assert.ok(RECONCILE_TO_FSM[state], "缺映射: " + state);
    assert.ok(valid.includes(RECONCILE_TO_FSM[state]), state + " 映射到了非法 FSM 状态");
  }
});

test("FSM 是零 I/O 纯模块：源码不含 child_process / fs / ssh 调用", () => {
  const src = fs.readFileSync(path.join(SERVER, "task_fsm.js"), "utf8");
  for (const forbidden of ["child_process", "node:fs", "runSsh", "fetch("]) {
    assert.equal(src.includes(forbidden), false, "task_fsm.js 不应出现 " + forbidden);
  }
});