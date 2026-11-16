/**
 * 适配提案审批弹窗（D4.7 三栏式 MVP）。
 *
 * 专业裁定要素：触发根因与诊断摘要、门禁预检徽章、脚本元数据与哈希、
 * 验证状态、决策动作栏。状态变更经单权威租约（自动获取）后提交。
 */
import { useEffect, useState } from 'react';
import { ensureAuthorityLeaseId, invalidateAuthorityLeaseId } from '../lib/authorityLease';

type Proposal = {
  entry_point: string;
  upstream_mod: string | null;
  purpose: string;
  reason: string;
  sha256: string | null;
  exists: boolean;
  current_sha256: string | null;
  verified: {
    verdict: string;
    validated_at: string;
    memory_cap_gb: number;
    timeout_cap_sec: number;
  } | null;
};

type Props = {
  onClose: () => void;
};

export function PiProposalsModal({ onClose }: Props) {
  const [sessions, setSessions] = useState<Array<{ session_id: string; project_id: string }>>([]);
  const [sessionId, setSessionId] = useState('');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [comment, setComment] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/pi/sessions');
        const payload = await res.json();
        const list = Array.isArray(payload.sessions) ? payload.sessions : [];
        setSessions(list);
        if (list.length > 0) setSessionId(list[0].session_id);
      } catch {
        setNotice('会话列表读取失败');
      }
    })();
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/pi/sessions/${encodeURIComponent(sessionId)}/proposals`);
        const payload = await res.json();
        setProposals(Array.isArray(payload.proposals) ? payload.proposals : []);
      } catch {
        setProposals([]);
      }
    })();
  }, [sessionId]);

  async function decide(entryPoint: string, action: 'approve' | 'reject') {
    if (!sessionId) return;
    setBusy(true);
    setNotice('');
    try {
      const leaseId = await ensureAuthorityLeaseId();
      if (!leaseId) throw new Error('租约获取失败');
      const res = await fetch(
        `/api/pi/sessions/${encodeURIComponent(sessionId)}/proposals/${encodeURIComponent(entryPoint)}/decide`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Bio-Lease-Id': leaseId },
          body: JSON.stringify({ action, comment }),
        },
      );
      const payload = await res.json();
      if (res.status === 409) invalidateAuthorityLeaseId();
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
      setProposals(Array.isArray(payload.proposals) ? payload.proposals : []);
      setNotice(action === 'approve' ? '已批准' : '已驳回并清理');
    } catch (cause) {
      setNotice(`操作失败：${(cause as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-inner" style={{ width: 'min(960px, 92vw)', background: 'var(--color-surface)' }}>
        <div className="modal-bar">
          <span>适配提案审批</span>
          <button type="button" className="btn" onClick={onClose}>关闭</button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto' }}>
          <div className="form-group">
            <label className="form-label">监督会话</label>
            <select
              className="form-input"
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
            >
              {sessions.length === 0 && <option value="">无会话</option>}
              {sessions.map((session) => (
                <option key={session.session_id} value={session.session_id}>
                  {session.session_id}（{session.project_id}）
                </option>
              ))}
            </select>
          </div>

          {proposals.length === 0 && <p className="subtle">当前会话没有待审适配脚本。</p>}

          {proposals.map((proposal) => (
            <div className="card" key={proposal.entry_point} data-testid="pi-proposal-card">
              <div className="card-head">
                <h3 className="card-title">{proposal.entry_point}</h3>
                <span className="badge">
                  {proposal.verified?.verdict === 'VERIFIED_OK' ? '验证通过' : '未验证'}
                </span>
              </div>
              <p className="subtle">
                上游 {proposal.upstream_mod || '未知'} · {proposal.purpose || '无用途说明'}
              </p>
              <p className="subtle">原因：{proposal.reason || '未填写'}</p>
              <p className="subtle">
                哈希 {String(proposal.sha256 || '').slice(0, 12)}… ·
                磁盘一致 {proposal.sha256 === proposal.current_sha256 ? '是' : '否'}
                {proposal.verified
                  ? ` · 验证上限 ${proposal.verified.memory_cap_gb}GB / ${proposal.verified.timeout_cap_sec}s`
                  : ''}
              </p>
              <div className="form-group">
                <input
                  className="form-input"
                  placeholder="批注（驳回必填）"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                />
              </div>
              <div className="chip-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void decide(proposal.entry_point, 'approve')}
                >
                  批准合入并继续
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void decide(proposal.entry_point, 'reject')}
                >
                  驳回并清理
                </button>
              </div>
            </div>
          ))}

          {notice && <p className="subtle">{notice}</p>}
        </div>
      </div>
    </div>
  );
}
