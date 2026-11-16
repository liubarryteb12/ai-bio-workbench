/**
 * 检查点二：靶点锁定与报告签发步进器（D5.3）。
 *
 * 单屏单向：靶点卡片 -> 批准靶点 -> 选择交付等级 -> 签发。
 * EXPLORATORY_DEGRADED 必须勾选确认并写不少于 10 字批注。
 */
import { useCallback, useEffect, useState } from 'react';
import { errorMessage, fetchJson } from '../lib/fetchJson';

type Session = {
  session_id: string;
  project_id: string;
  status: string;
  state_version: number;
  context?: {
    target_lock?: Array<{ gene: string; evidence_mod: string; effect_size: number }>;
    qc_summary?: Record<string, unknown>;
    delivery_grade?: string;
  };
};

export function PiReportSigningPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [grade, setGrade] = useState<'STANDARD_VERIFIED' | 'EXPLORATORY_DEGRADED'>('STANDARD_VERIFIED');
  const [ack, setAck] = useState(false);
  const [comment, setComment] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const payload = await fetchJson<{ ok: boolean; sessions: Session[] }>('/api/pi/sessions/active');
      const list = Array.isArray(payload.sessions) ? payload.sessions : [];
      setSessions(list.filter((item) => ['AWAITING_TARGET_APPROVAL', 'TARGET_APPROVED'].includes(item.status)));
    } catch {
      // 轮询失败保留快照。
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [load]);

  async function approveTargets(session: Session) {
    setBusy(session.session_id);
    setNotice('');
    try {
      await fetchJson(`/api/pi/sessions/${encodeURIComponent(session.session_id)}/approve-targets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: 'desktop-admin' }),
      });
      setNotice('靶点已锁定，进入签发阶段');
      await load();
    } catch (cause) {
      setNotice(`批准失败：${errorMessage(cause)}`);
    } finally {
      setBusy('');
    }
  }

  async function sign(session: Session) {
    if (grade === 'EXPLORATORY_DEGRADED') {
      if (!ack) { setNotice('探索版签发必须勾选确认'); return; }
      if (comment.trim().length < 10) { setNotice('探索版批注至少 10 字'); return; }
    }
    setBusy(session.session_id);
    setNotice('');
    try {
      await fetchJson(`/api/pi/sessions/${encodeURIComponent(session.session_id)}/report-signed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delivery_grade: grade,
          override: grade === 'EXPLORATORY_DEGRADED',
          actor: 'desktop-admin',
          comment,
        }),
      });
      setNotice(grade === 'EXPLORATORY_DEGRADED' ? '已按探索版特批签发' : '已按标准版签发');
      await load();
    } catch (cause) {
      setNotice(`签发失败：${errorMessage(cause)}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="card" data-testid="pi-signing-panel">
      <div className="card-head">
        <h3 className="card-title">靶点锁定与报告签发</h3>
      </div>
      {sessions.length === 0 && <p className="subtle">当前没有待锁定或待签发的会话。</p>}
      {sessions.map((session) => (
        <div key={session.session_id} className="card" style={{ marginBottom: 12 }}>
          <p className="subtle">{session.session_id} · {session.project_id} · {session.status}</p>
          {(session.context?.target_lock || []).map((target) => (
            <div key={target.gene} className="chip-row">
              <span className="badge">{target.gene}</span>
              <span className="subtle">证据 {target.evidence_mod}</span>
              <span className="subtle">效应量 {target.effect_size}</span>
            </div>
          ))}
          {session.status === 'AWAITING_TARGET_APPROVAL' && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy === session.session_id}
              onClick={() => void approveTargets(session)}
            >
              批准靶点
            </button>
          )}
          {session.status === 'TARGET_APPROVED' && (
            <>
              <div className="chip-row">
                <label className="subtle">
                  <input
                    type="radio"
                    checked={grade === 'STANDARD_VERIFIED'}
                    onChange={() => setGrade('STANDARD_VERIFIED')}
                  />{' '}标准版
                </label>
                <label className="subtle">
                  <input
                    type="radio"
                    checked={grade === 'EXPLORATORY_DEGRADED'}
                    onChange={() => setGrade('EXPLORATORY_DEGRADED')}
                  />{' '}探索版（统计降级）
                </label>
              </div>
              {grade === 'EXPLORATORY_DEGRADED' && (
                <>
                  <label className="subtle" style={{ display: 'block', margin: '8px 0' }}>
                    <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />{' '}
                    我确认该报告为探索性分析，不作为标准交付背书
                  </label>
                  <input
                    className="form-input"
                    placeholder="降级放行批注（至少 10 字）"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                </>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy === session.session_id}
                onClick={() => void sign(session)}
              >
                签发报告
              </button>
            </>
          )}
        </div>
      ))}
      {notice && <p className="subtle">{notice}</p>}
    </div>
  );
}
