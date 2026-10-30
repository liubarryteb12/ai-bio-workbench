export const CHAT_HISTORY_LIMIT = 200;
const ROLES = new Set(['user', 'assistant', 'system']);

/** 桌面端本地历史只做展示恢复，Pi 的权威记录仍在手机端 A2A 会话里。 */
export function normalizeChatMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const role = String(value.role ?? '').toLowerCase();
  const text = String(value.text ?? '').trim();
  if (!ROLES.has(role) || !text.trim()) return null;
  const ts = Number(value.ts);
  return {
    id: String(value.id || `${role}-${ts || Date.now()}`),
    role,
    text,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    ...(value.taskId ? { taskId: String(value.taskId) } : {}),
    ...(value.status ? { status: normalizeA2ATaskState(value.status) } : {}),
    ...(value.error ? { error: String(value.error) } : {}),
  };
}

export function loadChatHistory(storage, key) {
  if (!storage || typeof storage.getItem !== 'function') return [];
  let raw;
  try {
    raw = storage.getItem(String(key));
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try { storage.removeItem(String(key)); } catch { /* 存储不可写时保留空态 */ }
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => normalizeChatMessage(item))
    .filter(Boolean)
    .slice(-CHAT_HISTORY_LIMIT);
}

export function saveChatHistory(storage, messages, key) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(String(key), JSON.stringify(messages.slice(-CHAT_HISTORY_LIMIT)));
    return true;
  } catch {
    return false;
  }
}

export function appendChatMessage(messages, input, limit = CHAT_HISTORY_LIMIT) {
  const message = normalizeChatMessage(input);
  if (!message) return Array.isArray(messages) ? [...messages] : [];
  const base = Array.isArray(messages) ? messages : [];
  return [...base, message].slice(-limit);
}

export function replaceChatMessage(messages, id, patch, limit = CHAT_HISTORY_LIMIT) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => {
    if (message.id !== id) return message;
    const next = { ...message, ...patch };
    return normalizeChatMessage(next) || message;
  }).slice(-limit);
}

/** A2A 任务 id 带 task- 前缀，telemetry 文件名解析后的短 id 没有，匹配前先归一。 */
export function normalizeTaskId(taskId) {
  return String(taskId ?? '')
    .trim()
    .replace(/^task-/i, '');
}

/** GetTask 响应里 artifacts[].parts[].text 是 Pi 回复的权威载体。 */
export function extractReplyFromTask(task) {
  if (!task || typeof task !== 'object') return null;
  const parts = (task.artifacts ?? []).flatMap((artifact) => (
    Array.isArray(artifact?.parts) ? artifact.parts : []
  ));
  const texts = parts
    .map((part) => String(part?.text ?? '').trim())
    .filter(Boolean);
  if (texts.length === 0) return null;
  return texts.join('\n\n');
}

/** Pi telemetry 的 recent_calls 按 task_id 关联；没有文本就返回 null，让界面展示终态。 */
export function extractReplyFromCalls(calls, taskId) {
  if (!Array.isArray(calls) || !taskId) return null;
  const normalized = normalizeTaskId(taskId);
  if (!normalized) return null;
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const call = calls[i];
    if (normalizeTaskId(call?.task_id) !== normalized) continue;
    const text = String(call?.last_text ?? '').trim();
    if (text) return text;
  }
  return null;
}

/** 终态结算：把同 taskId 的未终态消息推进到终态，已终态保持不变（幂等）。 */
export function settleTaskMessages(messages, taskId, status) {
  if (!Array.isArray(messages) || !taskId) return messages;
  const normalized = normalizeA2ATaskState(status);
  if (!normalized) return messages;
  const target = normalizeTaskId(taskId);
  return messages.map((message) => {
    if (normalizeTaskId(message?.taskId) !== target) return message;
    if (message.role === 'user' && ['submitted', 'working'].includes(message.status)) {
      return { ...message, status: normalized };
    }
    return message;
  });
}

/** 同一 taskId 只保留一条终态结果（assistant/system），再按 id 去重。 */
export function dedupeTerminalMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const seenIds = new Set();
  const terminalByTask = new Set();
  return messages.filter((message) => {
    if (seenIds.has(message.id)) return false;
    seenIds.add(message.id);
    const taskKey = normalizeTaskId(message.taskId);
    const isTerminalResult = taskKey
      && (message.role === 'assistant' || message.role === 'system')
      && isTerminalMessageStatus(message.status);
    if (isTerminalResult) {
      if (terminalByTask.has(taskKey)) return false;
      terminalByTask.add(taskKey);
    }
    return true;
  });
}

function isTerminalMessageStatus(status) {
  return ['completed', 'failed', 'canceled', 'rejected'].includes(normalizeA2ATaskState(status));
}

/** 该任务在本机历史里是否已存在一条终态结果（assistant/system 均算）。 */
export function hasUsableTerminalResult(messages, taskId) {
  const target = normalizeTaskId(taskId);
  if (!target || !Array.isArray(messages)) return false;
  return messages.some((message) => (
    normalizeTaskId(message?.taskId) === target
    && (message.role === 'assistant' || message.role === 'system')
    && isTerminalMessageStatus(message.status)
  ));
}

/** 取消响应契约：仅 2xx 且 ok true 视为成功；其余返回可展示的错误。 */
export function evaluateCancelResponse(httpStatus, payload) {
  const okHttp = Number(httpStatus) >= 200 && Number(httpStatus) < 300;
  const okPayload = payload?.ok === true;
  if (okHttp && okPayload) return { ok: true, error: '' };
  const statusLabel = Number.isFinite(httpStatus) ? `（HTTP ${httpStatus}）` : '';
  const detail = payload?.error ?? `取消服务不可用${statusLabel}。`;
  return { ok: false, error: String(detail), terminal: false };
}

/** dispatch 没有返回 poll_url 时，用规范化 task endpoint 兜底，禁止派发后失联。 */
export function buildTaskPollUrl(pollUrl, taskId) {
  if (pollUrl && String(pollUrl).trim()) return String(pollUrl).trim();
  const raw = String(taskId ?? '').trim();
  return raw ? `/api/pi-agent/task?id=${encodeURIComponent(raw)}` : '';
}

/** D-06 退避序列：5s -> 10s -> 20s -> 30s 封顶。 */
export const POLL_DELAYS_MS = [5000, 10000, 20000, 30000];

export function nextPollDelayMs(pollIndex) {
  const index = Math.max(0, Number(pollIndex) || 0);
  return POLL_DELAYS_MS[Math.min(index, POLL_DELAYS_MS.length - 1)];
}

/**
 * 取消窗口状态机：
 * - pending：cancel fetch 未返回，GetTask 只观察，不结算。
 * - confirmed：取消成功，旧轮询必须立即退出。
 * - failed：取消失败，旧轮询要继续同一任务。
 */
export function nextCancelPollAction(cancelState) {
  if (cancelState === 'pending') return 'ignore';
  if (cancelState === 'confirmed') return 'stop';
  return 'resume';
}

/**
 * GetTask 回包结算门：
 * - exit：轮询代际已过期，或取消已确认，直接退出，禁止旧回包把 canceled 覆盖成 completed。
 * - ignore：CancelTask 仍在途中，本次回包只观察。
 * - settle：无取消干扰，允许按回包状态推进界面与台账。
 */
export function resolvePollSettleAction({ generation, activeGeneration, cancelState }) {
  if (generation !== activeGeneration) return 'exit';
  if (cancelState === 'confirmed') return 'exit';
  if (cancelState === 'pending') return 'ignore';
  return 'settle';
}

/** failed 只挡 pending/confirmed，允许用户再次取消。 */
export function canRetryCancel(cancelState) {
  return cancelState === 'failed' || cancelState === null;
}

/**
 * 轮询结束后的动作：
 * - canceled：任务已成功取消，进入终态。
 * - confirmed：取消成功，同一轮询退出。
 * - timeout：超过 24h 按失败收口，不递归重启。
 * - resume：取消失败恢复同一轮询；offset 从 0 起算，继续下一循环。
 */
export function nextPollLoopAction({ elapsedMs, cancelState, canceled = false }) {
  if (canceled) return 'canceled';
  if (cancelState === 'confirmed') return 'confirmed';
  if (elapsedMs >= 86_400_000) return 'timeout';
  if (cancelState === 'failed') return 'resume';
  return 'continue';
}

export function normalizeA2ATaskState(state) {
  return String(state ?? '')
    .trim()
    .replace(/^TASK_STATE_/i, '')
    .toLowerCase();
}
