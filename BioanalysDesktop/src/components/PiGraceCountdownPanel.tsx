/**
 * 检查点一 180 秒倒计时面板（D5.2）。
 *
 * 服务端 grace_deadline_ms 是唯一真源；本面板只做 1 秒轮询与人工拦截入口。
 * 点「拦截并接管」调用统一 intercept 接口，服务端 CAS 抢占并停机交权。
 */
import { useCallback, useEffect, useState } from 'react';
import { errorMessage, fetchJson } from '../lib/fetchJson';

type ActiveSession = {
  session_id: string;
  project_id: string;
  status: string;
  state_version: number;
  context?: { grace_deadline_ms?: number };
};

function remainingSeconds(session: ActiveSession, now: number) {
  const deadline = Number(session.context?.grace_deadline_ms || 0);
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function PiGraceCountdownPanel() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const payload = await fetchJson<{ ok: boolean; sessions: ActiveSession[] }>('/api/pi/sessions/active');
      setSessions(Array.isArray(payload.sessions) ? payload.sessions : []);
    } catch {
      // 轮询失败保留上一次快照，不打断倒计时显示。
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      setNow(Date.now());
      void load();
    }, 1000);
    return () => clearInterval(timer);
  }, [load]);

  async function intercept(session: ActiveSession) {
    setBusy(session.session_id);
    setNotice('');
    try {
      const payload = await fetchJson<{ ok: boolean; mode: string; error?: string }>(
        `/api/pi/sessions/${encodeURIComponent(session.session_id)}/intercept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: 'manual intercept from desktop',
            expected_version: session.state_version,
          }),
        },
      );
      setNotice(payload.mode === 'PRE_DISPATCH_INTERCEPTED' ? '已拦截，会话回到草稿' : '已强制停机交权');
      await load();
    } catch (cause) {
      setNotice(`拦截失败：${errorMessage(cause)}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="card" data-testid="pi-grace-panel">
      <div className="card-head">
        <h3 className="card-title">立项宽限倒计时</h3>
      </div>
      {sessions.length === 0 && <p className="subtle">当前没有等待放行的会话。</p>}
      {sessions.map((session) => {
        const remaining = remainingSeconds(session, now);
        return (
          <div key={session.session_id} className="chip-row" style={{ alignItems: 'center', gap: 12 }}>
            <span className="subtle">{session.session_id}</span>
            <span className="subtle">{session.project_id}</span>
            <span className="badge">{session.status}</span>
            {remaining !== null && session.status === 'AWAITING_PLAN_APPROVAL' && (
              <span style={{ fontWeight: 600 }}>{remaining}s 后自动放行</span>
            )}
            <button
              type="button"
              className="btn"
              disabled={busy === session.session_id}
              onClick={() => void intercept(session)}
            >
              拦截并接管
            </button>
          </div>
        );
      })}
      {notice && <p className="subtle">{notice}</p>}
    </div>
  );
}
