import { useCallback, useEffect, useState } from 'react';
import { errorMessage, fetchJson } from '../lib/fetchJson';

interface PiJob {
  job_id: string;
  intake_id?: string | null;
  stage: string;
  status: string;
  requires_external_download: boolean;
  checkpoint_reason?: string | null;
  approved_by?: string | null;
  updated_at: string;
}

interface PiEvent {
  id: number;
  stage: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export function PiCheckpointsPanel() {
  const [jobs, setJobs] = useState<PiJob[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [events, setEvents] = useState<PiEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const loadJobs = useCallback(async () => {
    try {
      const data = await fetchJson<{ ok: boolean; jobs: PiJob[] }>('/api/pi/jobs');
      const list = data.jobs || [];
      setJobs(list);
      if (!selectedId && list.length > 0) {
        setSelectedId(list[0].job_id);
      }
    } catch (err) {
      setMsg(`读取 Pi 调度列表失败：${errorMessage(err)}`);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (!selectedId) return;
    setEvents([]);
    const es = new EventSource(`/api/pi/jobs/${encodeURIComponent(selectedId)}/events`);
    const pushEvt = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data) as PiEvent;
        setEvents((prev) => (prev.some((x) => x.id === parsed.id) ? prev : [...prev.slice(-99), parsed]));
      } catch { /* ignore */ }
    };
    const knownTypes = ['checkpoint_suspend', 'checkpoint_resume', 'rpc_prompt', 'rpc_event', 'remote_wiped', 'complete', 'error'];
    knownTypes.forEach((t) => es.addEventListener(t, pushEvt));
    return () => {
      knownTypes.forEach((t) => es.removeEventListener(t, pushEvt));
      es.close();
    };
  }, [selectedId]);

  const handleApprove = async (jobId: string, action: 'approve-external' | 'approve-acceptance') => {
    setBusy(true);
    setMsg('');
    try {
      await fetchJson(`/api/pi/jobs/${encodeURIComponent(jobId)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: 'admin' }),
      });
      setMsg(action === 'approve-external' ? '已批准外源数据下载，Pi Agent 已唤醒执行' : '验收通过，阶段四报告生成已触发');
      await loadJobs();
    } catch (err) {
      setMsg(`操作失败：${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" data-testid="pi-checkpoints-panel">
      <div className="card-head">
        <h3 className="card-title">Pi Agent 调度与双人工刹车片</h3>
        <button type="button" className="btn-secondary" onClick={() => void loadJobs()} disabled={busy}>
          刷新调度
        </button>
      </div>
      {jobs.length === 0 ? (
        <p className="subtle">暂无 Pi Agent 调度任务</p>
      ) : (
        <div className="pi-jobs-list">
          {jobs.map((job) => (
            <div key={job.job_id} className="pi-job-row" style={{ padding: '0.5rem 0', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <button type="button" className="btn-link" onClick={() => setSelectedId(job.job_id)}>
                  <strong>{job.job_id}</strong>
                </button>
                <span>{job.stage} · <strong>{job.status}</strong></span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {job.status === 'SUSPENDED_WAITING_EXTERNAL_APPROVAL' && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy}
                      onClick={() => void handleApprove(job.job_id, 'approve-external')}
                    >
                      批准外源下载（刹车片一）
                    </button>
                  )}
                  {job.status === 'SUSPENDED_WAITING_FINAL_ACCEPTANCE' && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy}
                      onClick={() => void handleApprove(job.job_id, 'approve-acceptance')}
                    >
                      验收通过并生成报告（刹车片二）
                    </button>
                  )}
                </div>
              </div>
              {job.checkpoint_reason && <p className="subtle">{job.checkpoint_reason}</p>}
            </div>
          ))}
        </div>
      )}
      {selectedId && (
        <div style={{ marginTop: '0.75rem' }}>
          <h4 className="subtle">SSE 实时事件流 ({selectedId})</h4>
          <pre style={{ maxHeight: '180px', overflow: 'auto', fontSize: '0.8rem', background: '#f9fafb', padding: '0.5rem' }}>
            {events.length === 0 ? '等待事件…' : events.map((e) => `[${e.created_at}] ${e.stage} ${e.event_type}: ${JSON.stringify(e.payload)}`).join('\n')}
          </pre>
        </div>
      )}
      {msg && <p className="hint" role="status">{msg}</p>}
    </div>
  );
}
