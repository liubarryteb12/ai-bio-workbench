/**
 * task_fsm 契约单测（Q3，Argon 第 42 轮判据）。
 *
 * 三条变异反证要求：
 *   MUT-Q3-A：exit 0 且无回执判成 succeeded -> 必须红
 *   MUT-Q3-B：exit 4 混同普通 step_failed / succeeded -> 必须红
 *   MUT-Q3-C：放行 succeeded -> running 逆向转移 -> 必须红
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TASK_STATES, TERMINAL_STATES, FAILURE_REASONS, TRANSITIONS,
  canTransition, isTerminal, classifyTaskOutcome, toLedgerStatus,
  resolveDownstreamOnUpstreamStatus,
} from "../server/task_fsm.js";

test("枚举冻结：TASK_STATES / FAILURE_REASONS / TRANSITIONS 都不可改", () => {
  assert.ok(Object.isFrozen(TASK_STATES));
  assert.ok(Object.isFrozen(TERMINAL_STATES));
  assert.ok(Object.isFrozen(FAILURE_REASONS));
  assert.ok(Object.isFrozen(TRANSITIONS));
  assert.ok(Object.isFrozen(FAILURE_REASONS.LOCK_CONFLICT));
});

test("失败原因枚举齐全且与退出码契约一致（wrapper 0/1/2/3/4/137/143/-1）", () => {
  assert.equal(FAILURE_REASONS.LOCK_CONFLICT.exitCode, 4);
  assert.equal(FAILURE_REASONS.OOM_GUARD.exitCode, 137);
  assert.deepEqual(FAILURE_REASONS.STEP_CONTRACT_FAIL.exitCodes, [1, 2, 3]);
  assert.equal(FAILURE_REASONS.RECEIPT_MISSING.retryable, false);
  assert.equal(FAILURE_REASONS.LOCK_CONFLICT.retryable, true);
  assert.equal(FAILURE_REASONS.SSH_INTERRUPTED.retryable, true);
});

test("MUT-Q3-A：exit 0 且无 WROTE 回执 -> failed(RECEIPT_MISSING)，绝不 succeeded", () => {
  const out = classifyTaskOutcome({ exitCode: 0, hasReceipt: false });
  assert.equal(out.state, TASK_STATES.FAILED);
  assert.equal(out.reason, "RECEIPT_MISSING");
  assert.equal(toLedgerStatus(out).status, "failed");
});

test("exit 0 且有回执 -> succeeded", () => {
  const out = classifyTaskOutcome({ exitCode: 0, hasReceipt: true });
  assert.equal(out.state, TASK_STATES.SUCCEEDED);
  assert.equal(out.reason, null);
  assert.deepEqual(toLedgerStatus(out), { status: "completed", checkpoint_status: "passed" });
});

test("MUT-Q3-B：exit 4 必须映射 LOCK_CONFLICT，不能混同 STEP_CONTRACT_FAIL 或 succeeded", () => {
  const out = classifyTaskOutcome({ exitCode: 4, hasReceipt: false });
  assert.equal(out.state, TASK_STATES.FAILED);
  assert.equal(out.reason, "LOCK_CONFLICT");
  assert.equal(out.retryable, true, "锁冲突可重试，普通契约失败不可重试");
  const contract = classifyTaskOutcome({ exitCode: 1, hasReceipt: false });
  assert.equal(contract.reason, "STEP_CONTRACT_FAIL");
  assert.equal(contract.retryable, false);
  assert.notEqual(out.reason, contract.reason);
});

test("退出码穷举：1/2/3 契约失败、137/143 OOM、-1 链路中断", () => {
  for (const code of [1, 2, 3]) {
    assert.equal(classifyTaskOutcome({ exitCode: code, hasReceipt: false }).reason, "STEP_CONTRACT_FAIL");
  }
  for (const code of [137, 143]) {
    assert.equal(classifyTaskOutcome({ exitCode: code, hasReceipt: false }).reason, "OOM_GUARD");
  }
  assert.equal(classifyTaskOutcome({ exitCode: -1 }).reason, "SSH_INTERRUPTED");
});

test("SSH 链路中断：无进程且无 RECONCILE_END 哨兵 -> interrupted", () => {
  const out = classifyTaskOutcome({ exitCode: null, processAlive: false, reconcileSentinel: false });
  assert.equal(out.state, TASK_STATES.INTERRUPTED);
  assert.equal(out.reason, "SSH_INTERRUPTED");
  assert.equal(out.retryable, true);
});

test("信号不足保持 UNKNOWN，不升级为失败", () => {
  const out = classifyTaskOutcome({});
  assert.equal(out.state, TASK_STATES.INTERRUPTED);
  assert.equal(out.reason, "UNKNOWN");
  assert.equal(out.retryable, true);
  // 未知时 checkpoint 应为 skipped（未评估），不是 failed
  assert.equal(toLedgerStatus(out).checkpoint_status, "skipped");
});

test("MUT-Q3-C：终态严禁逆向退回 running / queued", () => {
  for (const terminal of TERMINAL_STATES) {
    assert.equal(canTransition(terminal, TASK_STATES.RUNNING), false, terminal + " -> running 必须禁止");
    assert.equal(canTransition(terminal, TASK_STATES.QUEUED), false, terminal + " -> queued 必须禁止");
    assert.equal(canTransition(terminal, TASK_STATES.SUCCEEDED), false);
  }
  assert.ok(isTerminal(TASK_STATES.SUCCEEDED));
  assert.ok(isTerminal(TASK_STATES.FAILED));
  assert.equal(isTerminal(TASK_STATES.RUNNING), false);
});

test("合法转移矩阵：queued->running、running->reconciling/succeeded/failed 等", () => {
  assert.equal(canTransition(TASK_STATES.QUEUED, TASK_STATES.RUNNING), true);
  assert.equal(canTransition(TASK_STATES.RUNNING, TASK_STATES.RECONCILING), true);
  assert.equal(canTransition(TASK_STATES.RUNNING, TASK_STATES.SUCCEEDED), true);
  assert.equal(canTransition(TASK_STATES.RECONCILING, TASK_STATES.SUCCEEDED), true);
  assert.equal(canTransition(TASK_STATES.QUEUED, TASK_STATES.SUCCEEDED), false, "不能跳过 running 直接成功");
  assert.equal(canTransition("bogus", TASK_STATES.RUNNING), false);
  assert.equal(canTransition(TASK_STATES.RUNNING, "bogus"), false);
});

test("纯函数：同一输入总是同一结果，且不碰任何 I/O", () => {
  const a = classifyTaskOutcome({ exitCode: 0, hasReceipt: false });
  const b = classifyTaskOutcome({ exitCode: 0, hasReceipt: false });
  assert.deepEqual(a, b);
  assert.equal(Object.isFrozen(a), false, "返回值本身不必冻结，但枚举必须冻结");
});

test("MUT-P1-A：上游为 DEGRADED 且下游未声明 accept_degraded -> 必须短路为 BLOCKED_UPSTREAM_DEGRADED", () => {
  const res = resolveDownstreamOnUpstreamStatus({
    upstreamState: TASK_STATES.DEGRADED,
    acceptDegraded: false,
  });
  assert.equal(res.allowed, false);
  assert.equal(res.nextState, TASK_STATES.BLOCKED_UPSTREAM_DEGRADED);
  assert.ok(res.reason.includes("accept_degraded"));

  const defaultCall = resolveDownstreamOnUpstreamStatus({
    upstreamState: TASK_STATES.DEGRADED,
  });
  assert.equal(defaultCall.allowed, false);
  assert.equal(defaultCall.nextState, TASK_STATES.BLOCKED_UPSTREAM_DEGRADED);
});

test("上游为 DEGRADED 且下游显式声明 accept_degraded: true -> 放行", () => {
  const res = resolveDownstreamOnUpstreamStatus({
    upstreamState: TASK_STATES.DEGRADED,
    acceptDegraded: true,
  });
  assert.equal(res.allowed, true);
  assert.equal(res.nextState, undefined);
});

test("上游非 DEGRADED 状态 -> 正常放行", () => {
  for (const st of [TASK_STATES.SUCCEEDED, TASK_STATES.RUNNING, TASK_STATES.QUEUED]) {
    const res = resolveDownstreamOnUpstreamStatus({ upstreamState: st });
    assert.equal(res.allowed, true);
  }
});
