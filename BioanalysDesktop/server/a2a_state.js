const TERMINAL_STATES = new Set(['completed', 'failed', 'canceled', 'rejected']);

/** Pi 返回 TASK_STATE_COMPLETED 等 A2A 枚举；界面和状态机统一使用小写短名。 */
export function normalizeA2ATaskState(state) {
  return String(state ?? '')
    .trim()
    .replace(/^TASK_STATE_/i, '')
    .toLowerCase();
}

export function isTerminalA2ATaskState(state) {
  return TERMINAL_STATES.has(normalizeA2ATaskState(state));
}

/** 保留原始远端状态用于审计，同时把 status.state 归一化给控制面使用。 */
export function normalizeA2ATask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return task;
  const status = task.status;
  if (!status || typeof status !== 'object' || Array.isArray(status)) return task;

  const remoteState = status.remote_state ?? status.state;
  return {
    ...task,
    status: {
      ...status,
      state: normalizeA2ATaskState(status.state),
      ...(remoteState ? { remote_state: remoteState } : {}),
    },
  };
}
