import { useCallback, useEffect, useState } from 'react';
import { isTerminalA2ATaskState, normalizeA2ATask } from '../../server/a2a_state.js';

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

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/pi-agent/overview');
      setOverview(await res.json());
    } catch { setOverview({ ok: false, online: false }); }
  }, []);
  const loadCalls = useCallback(async () => {
    try {
      const res = await fetch('/api/pi-agent/calls?limit=15');
      setCalls(await res.json());
    } catch { setCalls({ ok: false }); }
  }, []);
  const loadModel = useCallback(async () => {
    try {
      const res = await fetch('/api/pi-agent/model');
      setModelCfg(await res.json());
    } catch { setModelCfg({ ok: false }); }
  }, []);
  const loadLog = useCallback(async (source: 'daemon' | 'task', file?: string) => {
    try {
      const qs = source === 'task' && file ? `?task_file=${encodeURIComponent(file)}&tail=200` : '?tail=120';
      const res = await fetch(`/api/pi-agent/logs${qs}`);
      const payload = await res.json();
      setLogLines(payload.lines ?? []);
      setTimeline(payload.timeline ?? []);
    } catch { setLogLines(['日志拉取失败']); }
  }, []);

  useEffect(() => {
    void loadOverview(); void loadCalls(); void loadModel(); void loadLog('daemon');
  }, [loadOverview, loadCalls, loadModel, loadLog]);

  // overview/calls 每 10 秒，日志按当前 Tab 每 5 秒
  useEffect(() => {
    const t1 = setInterval(() => { void loadOverview(); void loadCalls(); }, 3000);
    const t2 = setInterval(() => { void loadLog(logSource, selected?.file); }, 2000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [loadOverview, loadCalls, loadLog, logSource, selected]);

  const switchModel = async (provider: string, model: string) => {
    setSwitching(true); setSwitchMsg('');
    try {
      const res = await fetch('/api/pi-agent/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model }),
      });
      const payload = await res.json();
      setSwitchMsg(payload.ok ? '已应用，daemon 正在用新模型重启' : `失败: ${payload.error}`);
      if (payload.ok) { await loadModel(); await loadOverview(); }
    } catch (e) { setSwitchMsg(`请求失败: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSwitching(false); }
  };

  const pollDispatchedTask = async (pollUrl: string, taskId: string) => {
    const delays = [5000, 10000, 20000, 30000];
    const deadline = Date.now() + 86400000;
    let pollIndex = 0;
    while (Date.now() < deadline) {
      const delay = delays[Math.min(pollIndex, delays.length - 1)];
      await new Promise((resolve) => setTimeout(resolve, delay));
      pollIndex += 1;
      try {
        const res = await fetch(pollUrl);
        const payload = await res.json() as PiDispatchResponse;
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
    try {
      const res = await fetch('/api/pi-agent/task/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId }),
      });
      const payload = await res.json();
      setDispatchResult({ ...payload, task: normalizeA2ATask(payload.task) });
    } catch {
      // Preserve the last observed task state when cancellation is unavailable.
    }
  };

  const dispatchTask = async () => {
    if (!dispatchMsg.trim()) return;
    setDispatching(true); setDispatchResult(null);
    try {
      const res = await fetch('/api/pi-agent/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: dispatchMsg, returnImmediately: true }),
      });
      const payload = await res.json();
      const normalizedPayload = { ...payload, task: normalizeA2ATask(payload.task) };
      setDispatchResult(normalizedPayload);
      if (payload.ok) {
        void loadCalls();
        void loadOverview();
        if (payload.poll_url && payload.task?.id) {
          void pollDispatchedTask(payload.poll_url, payload.task.id);
        }
      }
    } catch (e) {
      setDispatchResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
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
            <div>A2A: {overview?.a2a_card ? `${overview.a2a_card.name} v${overview.a2a_card.version}` : '不可达'}</div>
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
              <button key={c.file} className={`pi-call-row${selected?.file === c.file ? ' pi-call-row-active' : ''}`}
                onClick={() => { setSelected(c); setLogSource('task'); void loadLog('task', c.file); }}>
                <span className="pi-call-task">{c.task_id.slice(0, 18)}</span>
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
              <span className="pi-empty">经 A2A v1.0 SendMessage 直发 :9910，token 服务端注入</span>
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
