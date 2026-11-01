import { useCallback, useEffect, useRef, useState } from 'react';
import { isTerminalA2ATaskState, normalizeA2ATask } from '../server/a2a_state.js';
import {
  buildTaskPollUrl,
  appendChatMessage,
  dedupeTerminalMessages,
  evaluateCancelResponse,
  extractReplyFromCalls,
  extractReplyFromTask,
  hasUsableTerminalResult,
  loadChatHistory,
  nextPollDelayMs,
  normalizeA2ATaskState,
  canRetryCancel,
  nextPollLoopAction,
  resolvePollSettleAction,
  replaceChatMessage,
  settleTaskMessages,
  saveChatHistory,
} from './pi_chat_state.js';

export type ChatMessage = {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  ts: number;
  taskId?: string;
  status?: string;
  error?: string;
};

type PiOverview = {
  ok?: boolean;
  online?: boolean;
  current_model?: { provider: string; model: string } | null;
  a2a_card?: { name: string; version: string; url: string } | null;
  error?: string;
};
type CancelState = 'pending' | 'confirmed' | 'failed';
type PiCall = { task_id: string; last_text: string };
type PiDispatchResponse = {
  ok: boolean;
  task?: {
    id?: string;
    status?: { state?: string; message?: string } | null;
    artifacts?: Array<{ parts?: Array<{ text?: string } | undefined> | undefined }> | null;
  } | null;
  poll_url?: string | null;
  error?: string;
};

const HISTORY_KEY = 'bioanalys-desktop:pi-agent-chat-history';

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function taskStateLabel(state?: string): string {
  if (!state) return '等待任务';
  const normalized = normalizeA2ATaskState(state);
  if (!normalized) return '等待任务';
  return normalized;
}

export function PiAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const history = loadChatHistory(globalThis.localStorage, HISTORY_KEY) as (ChatMessage | null)[];
      return (history || []).filter((m): m is ChatMessage => m !== null);
    } catch {
      return [];
    }
  });
  const [draft, setDraft] = useState('');
  const [overview, setOverview] = useState<PiOverview | null>(null);
  const [taskId, setTaskId] = useState('');
  const [taskState, setTaskState] = useState('');
  const [sending, setSending] = useState(false);
  const [retryText, setRetryText] = useState('');

  const cancelState = useRef<CancelState | null>(null);
  const pollGeneration = useRef(0);
  const alive = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);

  const persist = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      saveChatHistory(storage(), next, HISTORY_KEY);
      return next;
    });
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/pi-agent/overview');
      setOverview(await res.json() as PiOverview);
    } catch (cause) {
      setOverview({ ok: false, online: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refreshStatus();
    return () => { alive.current = false; };
  }, [refreshStatus]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const finishTask = useCallback((id: string, state: string) => {
    setTaskId(id);
    setTaskState(taskStateLabel(state));
    if (isTerminalA2ATaskState(state)) {
      setSending(false);
    }
  }, []);

  const handleTerminalTask = useCallback(async (id: string, state: string, message?: string, task?: PiDispatchResponse['task']) => {
    const normalizedState = normalizeA2ATaskState(state);
    if (normalizedState === 'completed') {
      const taskReply = extractReplyFromTask(task);
      if (taskReply) {
        persist((prev) => settleTaskMessages(
          appendChatMessage(prev, { role: 'assistant', text: taskReply, ts: Date.now(), taskId: id, status: normalizedState }),
          id,
          normalizedState,
        ));
        finishTask(id, state);
        return;
      }
      let reply: string | null = null;
      let fetchError = '';
      // telemetry 写入与任务终态存在短竞态：按退避重试几次再判定无回复。
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        try {
          const res = await fetch('/api/pi-agent/calls?limit=50');
          const payload = await res.json() as { calls?: PiCall[] };
          reply = extractReplyFromCalls(payload.calls, id);
          fetchError = '';
          if (reply) break;
        } catch (cause) {
          fetchError = cause instanceof Error ? cause.message : String(cause);
        }
      }
      if (reply) {
        persist((prev) => settleTaskMessages(
          appendChatMessage(prev, { role: 'assistant', text: reply, ts: Date.now(), taskId: id, status: normalizedState }),
          id,
          normalizedState,
        ));
      } else {
        const detail = fetchError || 'Pi 任务完成，但 calls 里没有该任务的回复文本。';
        persist((prev) => settleTaskMessages(
          appendChatMessage(prev, { role: 'system', text: detail, ts: Date.now(), taskId: id, status: normalizedState }),
          id,
          normalizedState,
        ));
      }
    } else {
      const label = state === 'canceled' ? '任务已取消。' : `任务 ${taskStateLabel(state)}。`;
      const detail = message ? `${label} ${message}` : label;
      persist((prev) => settleTaskMessages(
        appendChatMessage(prev, { role: 'system', text: detail, ts: Date.now(), taskId: id, status: normalizedState, error: detail }),
        id,
        normalizedState,
      ));
    }
    finishTask(id, state);
  }, [finishTask, persist]);

  const pollTask = useCallback(async (
    pollUrl: string,
    id: string,
    startedAt: number,
    delayMs: (index: number) => number = nextPollDelayMs,
  ) => {
    const generation = pollGeneration.current;
    let pollIndex = 0;
    while (alive.current && pollGeneration.current === generation) {
      const action = nextPollLoopAction({
        elapsedMs: Date.now() - startedAt,
        cancelState: cancelState.current,
        canceled: false,
      });
      if (action === 'timeout') {
        const detail = '轮询超过 24 小时未进入终态。';
        persist((prev) => appendChatMessage(prev, { role: 'system', text: detail, ts: Date.now(), taskId: id, status: 'failed', error: detail }));
        finishTask(id, 'failed');
        return;
      }
      if (action === 'confirmed') return;
      await new Promise((resolve) => setTimeout(resolve, delayMs(pollIndex)));
      pollIndex += 1;
      try {
        const res = await fetch(pollUrl);
        const payload = normalizeA2ATask(await res.json()) as PiDispatchResponse;
        const state = payload.task?.status?.state ?? '';
        const settleAction = resolvePollSettleAction({
          generation,
          activeGeneration: pollGeneration.current,
          cancelState: cancelState.current,
        });
        if (settleAction === 'exit') return;
        if (settleAction === 'ignore') {
          // CancelTask 还在请求中：本次 GetTask 结果不结算，等 cancel fetch 明确成功或失败。
          continue;
        }
        if (!state) continue;
        setTaskId(id);
        setTaskState(taskStateLabel(state));
        if (isTerminalA2ATaskState(state)) {
          await handleTerminalTask(id, state, payload.task?.status?.message, payload.task);
          return;
        }
      } catch {
        // 轮询瞬时失败按既有退避继续，最终由任务态或超时收口。
      }
    }
  }, [finishTask, handleTerminalTask, persist]);

  const sendText = useCallback(async (text: string) => {
    const prompt = text.trim();
    if (!prompt || sending) return;
    const now = Date.now();
    const userMessage: ChatMessage = { id: `user-${now}`, role: 'user', text: prompt, ts: now, status: 'submitted' };
    persist((prev) => appendChatMessage(prev, userMessage));
    setDraft('');
    setRetryText('');
    setSending(true);
    pollGeneration.current += 1;
    cancelState.current = null;
    setTaskState('submitted');
    try {
      const res = await fetch('/api/pi-agent/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt, returnImmediately: true }),
      });
      const payload = normalizeA2ATask(await res.json()) as PiDispatchResponse;
      const id = payload.task?.id ?? '';
      const state = payload.task?.status?.state ?? '';
      if (payload.ok && id) {
        setTaskId(id);
        persist((prev) => replaceChatMessage(prev, userMessage.id, {
          taskId: id,
          status: normalizeA2ATaskState(state || 'submitted'),
        }));
        if (isTerminalA2ATaskState(state)) {
          await handleTerminalTask(id, state, payload.task?.status?.message, payload.task);
        } else {
          await pollTask(buildTaskPollUrl(payload.poll_url, id), id, now);
        }
        return;
      }
      const detail = payload.error || `派发失败（HTTP ${res.status}）。`;
      persist((prev) => appendChatMessage(prev, { role: 'system', text: detail, ts: Date.now(), status: 'failed', error: detail }));
      setRetryText(prompt);
      finishTask('', 'failed');
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      persist((prev) => appendChatMessage(prev, { role: 'system', text: `请求失败：${detail}`, ts: Date.now(), status: 'failed', error: detail }));
      setRetryText(prompt);
      finishTask('', 'failed');
    }
  }, [finishTask, handleTerminalTask, persist, pollTask, sending]);

  useEffect(() => {
    // 页面刷新后恢复未终态任务：历史里最后一个带 taskId 且未终态的用户消息。
    // 该任务若已有一条终态结果（例如另一端已结算过），恢复轮询只会重复追加，直接跳过。
    const pending = [...messages].reverse().find((message) => (
      message.role === 'user' && message.taskId && !isTerminalA2ATaskState(message.status ?? 'submitted')
    ));
    if (pending?.taskId && hasUsableTerminalResult(messages, pending.taskId)) return;
    if (!pending?.taskId || sending) return;
    setSending(true);
    setTaskId(pending.taskId);
    setTaskState(taskStateLabel(pending.status));
    void pollTask(buildTaskPollUrl('', pending.taskId), pending.taskId, Date.now());
    // 恢复只应执行一次，依赖保持 messages 会导致刷新中途再次触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const deduped = dedupeTerminalMessages(messages);
    if (deduped.length !== messages.length) {
      persist(() => deduped);
    }
  }, [messages, persist]);

  const cancelTask = useCallback(async () => {
    if (!taskId || !canRetryCancel(cancelState.current)) return;
    cancelState.current = 'pending';
    try {
      const res = await fetch('/api/pi-agent/task/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId }),
      });
      const payload = await res.json().catch(() => null);
      const verdict = evaluateCancelResponse(res.status, payload);
      if (verdict.ok) {
        cancelState.current = 'confirmed';
        pollGeneration.current += 1;
        const detail = '任务已取消。';
        persist((prev) => settleTaskMessages(
          appendChatMessage(prev, { role: 'system', text: detail, ts: Date.now(), taskId, status: 'canceled', error: detail }),
          taskId,
          'canceled',
        ));
        finishTask(taskId, 'canceled');
      } else {
        cancelState.current = 'failed';
        persist((prev) => appendChatMessage(prev, { role: 'system', text: `取消失败：${verdict.error}`, ts: Date.now(), taskId, status: 'working', error: verdict.error }));
      }
    } catch (cause) {
      cancelState.current = 'failed';
      const detail = cause instanceof Error ? cause.message : String(cause);
      persist((prev) => appendChatMessage(prev, { role: 'system', text: `取消失败：${detail}`, ts: Date.now(), taskId, status: 'working', error: detail }));
    }
  }, [finishTask, persist, taskId]);

  const clearHistory = useCallback(() => {
    if (sending) return;
    try { storage()?.removeItem(HISTORY_KEY); } catch { /* 忽略存储异常，界面仍清空 */ }
    setMessages([]);
    setRetryText('');
    setTaskId('');
    setTaskState('');
  }, [sending]);

  const online = overview?.online === true;
  const canSend = !sending && draft.trim().length > 0;

  return (
    <section className="pi-chat" aria-label="Pi Agent 对话">
      <header className="pi-chat-header" data-testid="pi-chat-status" aria-live="polite">
        <span className="pi-chat-status-item">
          <span className={`selfcheck-dot ${online ? 'selfcheck-dot-pass' : 'selfcheck-dot-fail'}`} />
          {overview == null ? '状态读取中' : online ? '在线' : '离线'}
        </span>
        <span>模型：{overview?.current_model?.model ?? '未知'}</span>
        <span>A2A：{overview?.a2a_card ? `${overview.a2a_card.name} v${overview.a2a_card.version}` : '不可达'}</span>
        <span>任务：{taskState ? taskStateLabel(taskState) : '空闲'}</span>
        <div className="pi-chat-header-actions">
          {taskId && !isTerminalA2ATaskState(taskState) && (
            <button type="button" className="btn" onClick={() => void cancelTask()} title="取消当前任务" aria-label="取消当前任务">取消</button>
          )}
          {retryText && !sending && (
            <button type="button" className="btn" onClick={() => void sendText(retryText)} title="重试上一条消息" aria-label="重试上一条消息">重试</button>
          )}
          <button type="button" className="btn" onClick={clearHistory} disabled={sending} title="清空本地对话历史" aria-label="清空本地对话历史">清空</button>
        </div>
      </header>

      <div className="pi-chat-messages" ref={listRef} aria-live="polite">
        {messages.length === 0 && <p className="pi-chat-empty" data-testid="pi-chat-empty">暂无本地对话。发送后这里只显示真实用户消息、Pi 回复和任务错误。</p>}
        {messages.map((message) => (
          <div key={message.id} className={`pi-chat-message pi-chat-${message.role}`} data-testid={`pi-chat-message-${message.role}`}>
            <span className="pi-chat-role">{message.role === 'user' ? '我' : message.role === 'assistant' ? 'Pi' : '状态'}</span>
            <div className="pi-chat-text">{message.text}</div>
          </div>
        ))}
      </div>

      <footer className="pi-chat-composer">
        <label className="sr-only" htmlFor="pi-chat-input">给 Pi Agent 发送消息</label>
        <textarea
          id="pi-chat-input"
          data-testid="pi-chat-input"
          value={draft}
          placeholder={sending ? '任务执行中，请等待终态' : '输入消息，Enter 发送，Shift+Enter 换行'}
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void sendText(draft);
            }
          }}
        />
        <button
          type="button"
          className="btn pi-chat-send"
          disabled={!canSend}
          onClick={() => void sendText(draft)}
          title="发送给 Pi Agent"
          aria-label="发送给 Pi Agent"
        >
          发送
        </button>
      </footer>
    </section>
  );
}
