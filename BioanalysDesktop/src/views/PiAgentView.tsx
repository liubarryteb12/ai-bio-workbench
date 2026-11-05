import { useCallback, useEffect, useRef, useState } from 'react';
import { isTerminalA2ATaskState, normalizeA2ATask } from '../../server/a2a_state.js';
import { fetchJson, fetchOk, errorMessage } from '../lib/fetchJson';

// ============================================================
// Pi Agent 观测插槽（P3-03 第三批，picked 自 codex/a2a-v1 的
// 2c4c0ba / 55b9585 / 8e862ae / 72a8394 内联 App 段）。
// 搬入时按视图拆分纪律独立成文件；函数体逐字保留，只改挂点。
// ============================================================
type PiOverview = {
  ok: boolean; online: boolean; error?: string;
  tmux_state?: string; memory?: string;
  current_model?: { provider: string; model: string };
  allowed_models?: Array<{ provider: string; model: string }>;
  a2a_card?: { name: string; version: string; url: string } | null;
  a2a_status?: string;
  a2a_reason?: string | null;
  battery?: { percentage: string; status: string; plugged: string; temperature: string };
  telemetry?: {
    usage: { total_calls: number; input_tokens: number; output_tokens: number; cost_usd: number } | null;
    usage_by_model: Array<{ provider: string; model: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number }>;
    recent_calls: Array<{ task_id: string; model: string; input_tokens: number; output_tokens: number; duration_sec: number; last_text: string }>;
  } | null;
};
type PiCall = {
  file: string; task_id: string; model: string; thinking_level: string;
  input_tokens: number; output_tokens: number; reasoning_tokens: number;
  cost_usd: number; last_text: string; tools: Array<{ name: string; args: string }>;
};
type PiCallsResponse = { ok: boolean; error?: string; calls?: PiCall[]; totals?: { input_tokens: number; output_tokens: number; cost_usd: number } };
type PiModelResponse = { ok: boolean; current?: { provider: string; model: string }; allowed?: Array<{ provider: string; model: string }>; error?: string };
type PiDispatchResponse = { ok: boolean; http_status?: number; task?: { id?: string; status?: { state?: string } } | null; poll_url?: string | null; error?: string };
type PiTimelineEntry = { ts: string; level: string; text: string };

/** 派发轮询的兜底上限：原先 24 小时，切 tab 后仍在跑；改成 30 分钟仍覆盖长任务 */
const POLL_DEADLINE_MS = 30 * 60 * 1000;

/** 可被 AbortSignal 提前唤醒的 setTimeout；abort 后立即 resolve，由调用方自己判断退出 */
function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const onAbort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function PiAgentMonitor() {
  const [overview, setOverview] = useState<PiOverview | null>(null);
  const [calls, setCalls] = useState<PiCallsResponse | null>(null);
  const [modelCfg, setModelCfg] = useState<PiModelResponse | null>(null);
  const [selected, setSelected] = useState<PiCall | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [timeline, setTimeline] = useState<PiTimelineEntry[]>([]);
  const [logLevel, setLogLevel] = useState('ALL');
  const [logSource, setLogSource] = useState<'daemon' | 'task'>('daemon');
  const [switching, setSwitching] = useState(false);
  const [switchMsg, setSwitchMsg] = useState('');
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchMsg, setDispatchMsg] = useState('');
  const [dispatchResult, setDispatchResult] = useState<PiDispatchResponse | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 卸载标记与轮询控制器：视图被切走时必须让在途轮询立刻退出。
  // 没有这两样，pollDispatchedTask 会一直跑到 deadline，期间持续 setState 并打接口。
  const aliveRef = useRef(true);
  const pollAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
    };
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      const payload = await fetchJson<PiOverview>('/api/pi-agent/overview');
      if (!aliveRef.current) return;
      // 后端 ok:false 是「探针没连上」，不是可渲染的数据；统一走错误分支
      setOverview(payload?.ok === false ? { ...payload, online: false } : payload);
      setLoadError(null);
    } catch (cause) {
      if (!aliveRef.current) return;
      setOverview({ ok: false, online: false, error: errorMessage(cause) });
      setLoadError(errorMessage(cause));
    }
  }, []);
  const loadCalls = useCallback(async () => {
    try {
      const payload = await fetchJson<PiCallsResponse>('/api/pi-agent/calls?limit=15');
      if (!aliveRef.current) return;
      setCalls(payload?.calls ? payload : { ...payload, calls: [] });
    } catch (cause) {
      if (!aliveRef.current) return;
      setCalls({ ok: false, calls: [], error: errorMessage(cause) });
    }
  }, []);
  const loadModel = useCallback(async () => {
    try {
      const payload = await fetchJson<PiModelResponse>('/api/pi-agent/model');
      if (!aliveRef.current) return;
      setModelCfg(payload?.allowed ? payload : { ...payload, allowed: [] });
    } catch (cause) {
      if (!aliveRef.current) return;
      setModelCfg({ ok: false, allowed: [], error: errorMessage(cause) });
    }
  }, []);
  const loadLog = useCallback(async (source: 'daemon' | 'task', file?: string) => {
    try {
      const qs = source === 'task' && file ? `?task_file=${encodeURIComponent(file)}&tail=200` : '?tail=120';
      const payload = await fetchJson<{ lines?: string[]; timeline?: PiTimelineEntry[] }>(`/api/pi-agent/logs${qs}`);
      if (!aliveRef.current) return;
      setLogLines(Array.isArray(payload?.lines) ? payload.lines : []);
      setTimeline(Array.isArray(payload?.timeline) ? payload.timeline : []);
    } catch {
      if (!aliveRef.current) return;
      setLogLines(['日志拉取失败']);
    }
  }, []);

  useEffect(() => {
    void loadOverview(); void loadCalls(); void loadModel(); void loadLog('daemon');
  }, [loadOverview, loadCalls, loadModel, loadLog]);

  // overview/calls 每 3 秒，日志按当前 Tab 每 2 秒；卸载时两个定时器都要停
  useEffect(() => {
    const t1 = setInterval(() => { void loadOverview(); void loadCalls(); }, 3000);
    const t2 = setInterval(() => { void loadLog(logSource, selected?.file); }, 2000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [loadOverview, loadCalls, loadLog, logSource, selected]);

  const switchModel = async (provider: string, model: string) => {
    setSwitching(true); setSwitchMsg('');
    try {
      const payload = await fetchJson<PiModelResponse>('/api/pi-agent/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model }),
      });
      setSwitchMsg(payload.ok ? '已应用，daemon 正在用新模型重启' : `失败: ${payload.error}`);
      if (payload.ok) { await loadModel(); await loadOverview(); }
    } catch (cause) { setSwitchMsg(`请求失败: ${errorMessage(cause)}`); }
    finally { setSwitching(false); }
  };

  /**
   * 轮询已派发的任务直到终态。
   *
   * 生命周期契约：signal 一旦 abort（视图卸载）就立刻返回，不再打接口、不再 setState。
   * 24 小时兜底也缩到 30 分钟：面板关掉后没人需要一次跨天的后台轮询。
   */
  const pollDispatchedTask = async (pollUrl: string, taskId: string, signal: AbortSignal) => {
    const delays = [5000, 10000, 20000, 30000];
    const deadline = Date.now() + POLL_DEADLINE_MS;
    let pollIndex = 0;
    while (Date.now() < deadline) {
      if (signal.aborted || !aliveRef.current) return;
      const delay = delays[Math.min(pollIndex, delays.length - 1)];
      await sleepWithSignal(delay, signal);
      if (signal.aborted || !aliveRef.current) return;
      pollIndex += 1;
      try {
        const payload = await fetchJson<PiDispatchResponse>(pollUrl, { signal });
        if (signal.aborted || !aliveRef.current) return;
        const normalizedPayload = { ...payload, task: normalizeA2ATask(payload.task) };
        setDispatchResult(normalizedPayload);
        if (isTerminalA2ATaskState(normalizedPayload.task?.status?.state)) {
          void loadCalls();
          void loadOverview();
          return;
        }
      } catch {
        // Transient polling failures continue with the same backoff schedule.
      }
    }
    if (signal.aborted || !aliveRef.current) return;
    try {
      await fetchOk('/api/pi-agent/task/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId }),
        signal,
      });
      if (signal.aborted || !aliveRef.current) return;
      setDispatchResult({ ok: true, task: normalizeA2ATask({ id: taskId, status: { state: 'canceled' } }) });
    } catch {
      // Preserve the last observed task state when cancellation is unavailable.
    }
  };

  const dispatchTask = async () => {
    if (!dispatchMsg.trim()) return;
    setDispatching(true); setDispatchResult(null);
    try {
      const payload = await fetchJson<PiDispatchResponse>('/api/pi-agent/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: dispatchMsg, returnImmediately: true }),
      });
      const normalizedPayload = { ...payload, task: normalizeA2ATask(payload.task) };
      setDispatchResult(normalizedPayload);
      if (payload.ok) {
        void loadCalls();
        void loadOverview();
        if (payload.poll_url && payload.task?.id) {
          pollAbortRef.current?.abort();
          const controller = new AbortController();
          pollAbortRef.current = controller;
          void pollDispatchedTask(payload.poll_url, payload.task.id, controller.signal);
        }
      }
    } catch (cause) {
      setDispatchResult({ ok: false, error: errorMessage(cause) });
    } finally { setDispatching(false); }
  };
  const dot = overview?.online ? 'selfcheck-dot-pass' : 'selfcheck-dot-fail';
  const totals = overview?.telemetry?.usage ?? calls?.totals;
  const byModel = (calls?.calls ?? []).reduce<Record<string, PiCall>>((acc, c) => {
    const b = acc[c.model] ?? { ...c, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    b.input_tokens += c.input_tokens;
    b.output_tokens += c.output_tokens;
    b.cost_usd += c.cost_usd;
    acc[c.model] = b;
    return acc;
  }, {});
  const byModelSource = overview?.telemetry?.usage_by_model?.length
    ? overview.telemetry.usage_by_model.map((m) => ({ model: m.model, input_tokens: m.input_tokens, output_tokens: m.output_tokens }))
    : Object.values(byModel).map((m) => ({ model: m.model, input_tokens: m.input_tokens, output_tokens: m.output_tokens }));

  return (
    <div className="view-container">
      {loadError && (
        <div className="error-card" role="alert" data-testid="error-state" data-error-kind="pi-calls">
          <h3 className="error-card-title">监控数据加载失败</h3>
          <p className="error-text">{loadError}</p>
          <p className="hint">面板会每 3 秒自动重试一次；也可点下方"刷新"立即重试。</p>
          <button type="button" className="btn" onClick={() => { void loadOverview(); void loadCalls(); void loadModel(); void loadLog(logSource, selected?.file); }}>
            重试
          </button>
        </div>
      )}
      {!loadError && !overview && (
        <p className="hint" role="status" data-testid="loading-state" data-loading-kind="pi-calls">正在读取 Pi Agent 监控数据...</p>
      )}

      {!loadError && overview && !(calls?.calls?.length) && (
        <p className="hint" data-testid="empty-state" data-empty-kind="pi-calls">暂无 A2A 调用记录，面板每 3 秒自动刷新。</p>
      )}

      <div className="pi-status-row">
        <div className="card pi-status-card">
          <div className="card-head"><h2 className="card-title">Pi Agent 状态</h2>
            <button className="btn" onClick={() => { void loadOverview(); void loadCalls(); }}>刷新</button>
          </div>
          <div className="pi-status-grid">
            <div className="pi-status-item"><span className={`selfcheck-dot ${dot}`} />{overview?.online ? '在线' : '离线'}</div>
            <div>模型: <strong>{overview?.current_model?.model ?? '...'}</strong></div>
            <div>tmux: {overview?.tmux_state ?? '...'}</div>
            <div>内存: {overview?.memory ?? '...'}</div>
            <div title={overview?.a2a_reason ?? ''}>
              A2A: {overview?.a2a_card
                ? `${overview.a2a_card.name} v${overview.a2a_card.version}`
                : `不可达（${overview?.a2a_status ?? 'unknown'}）`}
            </div>
          </div>
        </div>
        <div className="card pi-status-card">
          <div className="card-head"><h2 className="card-title">模型切换</h2></div>
          <div className="pi-model-list">
            {(modelCfg?.allowed ?? []).map((m) => (
              <button key={m.model} className={`sub-tab${modelCfg?.current?.model === m.model ? ' sub-tab-active' : ''}`}
                disabled={switching || modelCfg?.current?.model === m.model}
                onClick={() => void switchModel(m.provider, m.model)}>
                {m.model}
              </button>
            ))}
          </div>
          {switchMsg && <p className="pi-switch-msg">{switchMsg}</p>}
        </div>
      </div>
      <div className="pi-usage-row">
        <div className="card pi-usage-card">
          <div className="card-head"><h2 className="card-title">Token 用量（{overview?.telemetry ? '9911 遥测' : 'SSH 探针'}，共 {overview?.telemetry?.usage?.total_calls ?? calls?.calls?.length ?? 0} 次）</h2></div>
          <div className="pi-usage-grid">
            <div>Input: <strong>{totals?.input_tokens ?? 0}</strong></div>
            <div>Output: <strong>{totals?.output_tokens ?? 0}</strong></div>
            <div>Cost: <strong>${(totals?.cost_usd ?? 0).toFixed(4)}</strong></div>
          </div>
        </div>
      </div>
      <div className="pi-dispatch-row">
        <button className="btn pi-dispatch-btn" onClick={() => setDispatchOpen(true)}>
          派发 A2A 测试任务
        </button>
        {dispatchResult && (
          <span className={`pi-dispatch-status${dispatchResult.ok ? ' pi-dispatch-ok' : ' pi-dispatch-fail'}`}>
            {dispatchResult.ok
              ? `任务 ${dispatchResult.task?.id ?? ''} 已派发 (${dispatchResult.task?.status?.state ?? ''})`
              : `派发失败: ${dispatchResult.error}`}
          </span>
        )}
      </div>
      <div className="pi-main-row">
        <div className="card pi-calls-card">
          <div className="card-head"><h2 className="card-title">调用台账</h2></div>
          <div className="pi-calls-list">
            {(calls?.calls ?? []).map((c) => (
              <button key={c.file ?? c.task_id} className={`pi-call-row${selected?.file === c.file ? ' pi-call-row-active' : ''}`}
                onClick={() => { setSelected(c); setLogSource('task'); void loadLog('task', c.file); }}>
                <span className="pi-call-task">{(c.task_id ?? c.file ?? '').slice(0, 18)}</span>
                <span className="pi-call-model">{c.model}</span>
                <span className="pi-call-tokens">{c.input_tokens}/{c.output_tokens}</span>
              </button>
            ))}
            {(calls?.calls?.length ?? 0) === 0 && <p className="pi-empty">暂无调用记录</p>}
          </div>
          {byModelSource.length > 0 && (
            <div className="pi-by-model">
              <p className="pi-empty">按模型: {byModelSource.map((m) => `${m.model} ${m.input_tokens}/${m.output_tokens}`).join(' | ')}</p>
            </div>
          )}
        </div>
        <div className="card pi-log-card">
          <div className="card-head">
            <h2 className="card-title">日志流</h2>
            <div className="sub-tab-row pi-log-tabs">
              <button className={`sub-tab${logSource === 'daemon' ? ' sub-tab-active' : ''}`} onClick={() => { setLogSource('daemon'); void loadLog('daemon'); }}>守护日志</button>
              <button className={`sub-tab${logSource === 'task' ? ' sub-tab-active' : ''}`} disabled={!selected} onClick={() => { setLogSource('task'); void loadLog('task', selected?.file); }}>任务轨迹</button>
            </div>
          </div>
          <div className="pi-log-filter-row">
            <select className="pi-log-level-select" value={logLevel} onChange={(e) => setLogLevel(e.target.value)}>
              <option value="ALL">全部级别</option>
              <option value="INFO">INFO / 状态</option>
              <option value="TOOL">TOOL / 命令执行</option>
              <option value="THINK">THINK / 思考</option>
              <option value="REPLY">REPLY / 回复</option>
              <option value="ARTIFACT">ARTIFACT / 产物</option>
            </select>
          </div>
          <pre className="pi-log-terminal">
            {(() => {
              const text = logLevel === 'ALL' ? logLines : timeline.filter((e) => e.level === logLevel).map((e) => `[${e.ts}] [${e.level}] ${e.text}`);
              return text.length ? text.join('\n') : '暂无日志';
            })()}
          </pre>
        </div>
      </div>
      {dispatchOpen && (
        <div className="pi-modal-backdrop" onClick={() => { setDispatchOpen(false); setDispatchResult(null); }}>
          <div className="pi-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pi-modal-head">
              <h3>向手机端 Pi Agent 派发 A2A 任务</h3>
              <button className="btn" onClick={() => { setDispatchOpen(false); setDispatchResult(null); }}>关闭</button>
            </div>
            <textarea className="pi-dispatch-textarea" rows={5} value={dispatchMsg}
              placeholder="输入任务指令，例如: 在 ~/workspace/projects 下创建 probe.py 并运行"
              onChange={(e) => setDispatchMsg(e.target.value)} />
            <div className="pi-modal-foot">
              <span className="pi-empty">消息由本机服务端直接投递，凭据在服务端注入，不在界面上传递</span>
              <button className="btn" disabled={dispatching || !dispatchMsg.trim()} onClick={() => void dispatchTask()}>
                {dispatching ? '派发中...' : '立即发送'}
              </button>
            </div>
            {dispatchResult && (
              <pre className="pi-log-terminal pi-dispatch-result">{JSON.stringify(dispatchResult, null, 2)}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 视图4：结果预览 Studio（Result Preview Studio）
// ============================================================