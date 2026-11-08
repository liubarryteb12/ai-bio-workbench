/**
 * task_fsm.js —— 任务生命周期状态机与失败分类学（第 43 轮 Q3，抄 Temporal + XState）。
 *
 * 为什么需要：判定散落在 run.js（finishTask 用 code===0 定成败）、
 * reconcile.js（classifyRemoteState 五态）、wrapper 退出码约定里，各自写一套 if/else。
 * 新增一种失败（比如无回执）时很容易漏改其中一处。
 *
 * 设计：零 I/O 纯函数 + 冻结的枚举 + 显式转移矩阵。
 *   - 前置同步准入（鉴权/体上限/参数/命令审计/节点选择）不产生任务记录，不进本模块；
 *   - 异步生命周期（幂等锁 -> 执行 -> 回执 -> 对账）围绕 TASK_STATES 流转。
 *
 * 退出码契约来自 ops/run_throttled_task.sh：
 *   0 成功 / 1,2,3 步骤自校验失败 / 4 幂等锁冲突 / 137 OOM(RLIMIT) / 143 信号中断
 *   -1 本地 ssh 链路故障（run.js 探针两次失败时给的值）
 */

/** 任务生命周期状态。冻结：新增状态必须先改这里并补转移矩阵，不许在别处硬编码字符串。 */
export const TASK_STATES = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  RECONCILING: "reconciling",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  INTERRUPTED: "interrupted",
  DEGRADED: "degraded",
  BLOCKED_UPSTREAM_DEGRADED: "blocked_upstream_degraded",
});

/** 终态：一旦进入不允许再退回 running（MUT-Q3-C 要防的就是这个）。 */
export const TERMINAL_STATES = Object.freeze([
  TASK_STATES.SUCCEEDED, TASK_STATES.FAILED, TASK_STATES.INTERRUPTED,
  TASK_STATES.DEGRADED, TASK_STATES.BLOCKED_UPSTREAM_DEGRADED,
]);

/**
 * 失败原因分类学（抄 Temporal 的 ApplicationFailure vs NonRetryable）。
 * 每条都标了是否可重试：锁冲突与链路中断可重试，契约失败/无回执/OOM 不可重试。
 */
export const FAILURE_REASONS = Object.freeze({
  LOCK_CONFLICT: Object.freeze({ code: "LOCK_CONFLICT", exitCode: 4, retryable: true,
    label: "幂等锁冲突：同 line+step 已有任务在跑" }),
  OOM_GUARD: Object.freeze({ code: "OOM_GUARD", exitCode: 137, retryable: false,
    label: "内存闸门触发（RLIMIT_AS / OOM killer）" }),
  STEP_CONTRACT_FAIL: Object.freeze({ code: "STEP_CONTRACT_FAIL", exitCodes: [1, 2, 3], retryable: false,
    label: "步骤自校验失败：输入契约/seed/产物不合法" }),
  RECEIPT_MISSING: Object.freeze({ code: "RECEIPT_MISSING", retryable: false,
    label: "exit 0 但无 WROTE 回执：台账静默丢失，不允许判成功" }),
  SSH_INTERRUPTED: Object.freeze({ code: "SSH_INTERRUPTED", retryable: true,
    label: "SSH 链路中断：无进程且无 RECONCILE_END 哨兵" }),
  UNKNOWN: Object.freeze({ code: "UNKNOWN", retryable: true,
    label: "信号不足，无法判定（保持原判，不升级为失败）" }),
});

/**
 * 合法转移矩阵：TRANSITIONS[from] = 允许到达的状态集合。
 * 矩阵之外一律 false —— 新增状态却忘了登记会被 canTransition 当场挡住。
 */
export const TRANSITIONS = Object.freeze({
  [TASK_STATES.QUEUED]: Object.freeze([TASK_STATES.RUNNING, TASK_STATES.FAILED, TASK_STATES.INTERRUPTED, TASK_STATES.BLOCKED_UPSTREAM_DEGRADED]),
  [TASK_STATES.RUNNING]: Object.freeze([TASK_STATES.RECONCILING, TASK_STATES.SUCCEEDED,
    TASK_STATES.FAILED, TASK_STATES.INTERRUPTED, TASK_STATES.DEGRADED]),
  [TASK_STATES.RECONCILING]: Object.freeze([TASK_STATES.SUCCEEDED, TASK_STATES.FAILED,
    TASK_STATES.INTERRUPTED, TASK_STATES.RUNNING, TASK_STATES.DEGRADED]),
  [TASK_STATES.SUCCEEDED]: Object.freeze([]),
  [TASK_STATES.FAILED]: Object.freeze([]),
  [TASK_STATES.INTERRUPTED]: Object.freeze([]),
  [TASK_STATES.DEGRADED]: Object.freeze([]),
  [TASK_STATES.BLOCKED_UPSTREAM_DEGRADED]: Object.freeze([]),
});

/** 状态转移校验。终态严禁逆向退回 running/queued。 */
export function canTransition(fromState, toState) {
  if (!Object.values(TASK_STATES).includes(fromState)) return false;
  if (!Object.values(TASK_STATES).includes(toState)) return false;
  if (TERMINAL_STATES.includes(fromState)) return false;
  return (TRANSITIONS[fromState] || []).includes(toState);
}

/** 该状态是否为终态。 */
export function isTerminal(state) {
  return TERMINAL_STATES.includes(state);
}

/**
 * 由一次任务执行的原始信号判定结果与失败原因。零 I/O 纯函数。
 *
 * @param {{exitCode: number|null, hasReceipt: boolean|null,
 *   reconcileSentinel: boolean|null, processAlive: boolean|null, timedOut: boolean|null}} signals
 * @returns {{state: string, reason: string|null, retryable: boolean,
 *   note: string}}
 */
export function classifyTaskOutcome({
  exitCode = null, hasReceipt = null, reconcileSentinel = null,
  processAlive = null, timedOut = null,
} = {}) {
  // ── 链路中断类：进程没了且没有 RECONCILE_END 哨兵 ──
  if (processAlive === false && reconcileSentinel === false) {
    return result(TASK_STATES.INTERRUPTED, "SSH_INTERRUPTED");
  }
  if (timedOut === true) {
    return result(TASK_STATES.INTERRUPTED, "SSH_INTERRUPTED");
  }

  // ── 明确退出码 ──
  if (exitCode === 4) return result(TASK_STATES.FAILED, "LOCK_CONFLICT");
  if (exitCode === 137 || exitCode === 143) return result(TASK_STATES.FAILED, "OOM_GUARD");
  if ([1, 2, 3].includes(exitCode)) return result(TASK_STATES.FAILED, "STEP_CONTRACT_FAIL");
  if (exitCode === -1) return result(TASK_STATES.INTERRUPTED, "SSH_INTERRUPTED");

  // ── exit 0：必须拿到 WROTE 回执才算成功（MUT-Q3-A 要防的假绿）──
  if (exitCode === 0) {
    if (hasReceipt === false) return result(TASK_STATES.FAILED, "RECEIPT_MISSING");
    if (hasReceipt === true) return result(TASK_STATES.SUCCEEDED, null);
    // 回执信号未知：不臆断，保持未知而不是判成功
    return result(TASK_STATES.INTERRUPTED, "UNKNOWN");
  }

  // ── 信号不足：保持未知，绝不把「探不到」升级成「已失败」 ──
  return result(TASK_STATES.INTERRUPTED, "UNKNOWN");
}

function result(state, reasonCode) {
  const reason = reasonCode ? FAILURE_REASONS[reasonCode] : null;
  return {
    state,
    reason: reasonCode,
    retryable: reason ? reason.retryable : false,
    note: reason ? reason.label : "执行完成且台账回执完整",
  };
}

/** 把 FSM 结果映射成台账的 status / checkpoint_status（供 run.js 使用）。 */
export function toLedgerStatus(outcome) {
  if (outcome.state === TASK_STATES.SUCCEEDED) {
    return { status: "completed", checkpoint_status: "passed" };
  }
  if (outcome.state === TASK_STATES.DEGRADED) {
    return { status: "degraded", checkpoint_status: "degraded" };
  }
  if (outcome.state === TASK_STATES.BLOCKED_UPSTREAM_DEGRADED) {
    return { status: "failed", checkpoint_status: "blocked_upstream_degraded" };
  }
  if (outcome.state === TASK_STATES.FAILED) {
    return { status: "failed", checkpoint_status: "failed" };
  }
  return { status: "failed", checkpoint_status: "skipped" };
}

/**
 * 判定下游对上游降级状态的准入与短路契约（4 Argon 第 74 轮 Q3/Phase 1）。
 * 当上游处于 DEGRADED 且下游未声明 accept_degraded: true 时，
 * 调度器严禁将下游留在 PENDING 死等，必须立即流转为终态 BLOCKED_UPSTREAM_DEGRADED 并短路退出。
 *
 * @param {{upstreamState: string, acceptDegraded?: boolean}} input
 * @returns {{allowed: boolean, nextState?: string, reason?: string}}
 */
export function resolveDownstreamOnUpstreamStatus({ upstreamState, acceptDegraded = false }) {
  if (upstreamState === TASK_STATES.DEGRADED) {
    if (acceptDegraded === true) {
      return { allowed: true };
    }
    return {
      allowed: false,
      nextState: TASK_STATES.BLOCKED_UPSTREAM_DEGRADED,
      reason: "上游任务处于降级状态 (DEGRADED)，且下游未声明 accept_degraded: true",
    };
  }
  return { allowed: true };
}
