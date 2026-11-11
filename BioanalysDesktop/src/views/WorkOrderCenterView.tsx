import { useCallback, useEffect, useMemo, useState } from 'react';

import { errorMessage, fetchJson } from '../lib/fetchJson';

type WorkOrderStatus = 'queued' | 'running' | 'completed' | 'failed' | 'blocked';

interface WorkOrderRow {
  work_order_id: string;
  project_id: string;
  line_id: string;
  status: WorkOrderStatus;
  created_at: string;
}

interface QueueRow extends WorkOrderRow {
  position: number;
}

interface ReceiptSummary {
  receipt_id?: string;
  status?: WorkOrderStatus;
  started_at?: string;
  finished_at?: string | null;
  failure_stage?: string | null;
  error?: { code?: string | null; message?: string | null } | null;
  stage_count?: number;
  artifact_count?: number;
  sentinel?: string | null;
}

interface StageEntry {
  name?: string;
  status?: string;
  at?: string;
  code?: string;
  error?: string;
}

interface ReceiptFull extends ReceiptSummary {
  stages?: StageEntry[];
  artifacts?: Array<{ path?: string; role?: string; stage?: string }>;
}

interface DetailPayload {
  work_order: WorkOrderRow;
  queue_position?: number | null;
  receipt: ReceiptSummary | null;
}

interface InboxPackage {
  file: string;
  packageDir?: string | null;
  mtime?: string;
  parseError?: string | null;
  summary?: {
    name?: string;
    dataType?: string;
    suggestedLine?: string;
    modIds?: string[];
  } | null;
  attachments?: {
    data_files?: number;
    references?: number;
  } | null;
}

interface InboxPayload {
  blocked?: boolean;
  dir?: string;
  items?: InboxPackage[];
}

interface PackageForm {
  lineId: string;
  modIds: string;
  seed: string;
}

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  queued: '排队中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  blocked: '阻塞',
};

const STATUS_ORDER: WorkOrderStatus[] = ['queued', 'running', 'completed', 'failed', 'blocked'];

function statusLabel(status: string): string {
  return STATUS_LABELS[status as WorkOrderStatus] || status;
}

export function WorkOrderCenterView({ project }: { project?: string }) {
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueRows, setQueueRows] = useState<QueueRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [receipt, setReceipt] = useState<ReceiptFull | null>(null);
  const [draftText, setDraftText] = useState('');
  const [preview, setPreview] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [packages, setPackages] = useState<InboxPackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [activePackage, setActivePackage] = useState<string | null>(null);
  const [packageForm, setPackageForm] = useState<PackageForm>({
    lineId: '',
    modIds: '',
    seed: '',
  });
  const [packageDraft, setPackageDraft] = useState('');

  const listUrl = useMemo(() => {
    const suffix = project ? `?project=${encodeURIComponent(project)}` : '';
    return `/api/work-orders${suffix}`;
  }, [project]);

  const loadList = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const payload = await fetchJson<{ work_orders?: WorkOrderRow[] }>(listUrl);
      setRows(Array.isArray(payload?.work_orders) ? payload.work_orders : []);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [listUrl]);

  const loadQueue = useCallback(async (silent = false) => {
    if (!silent) setQueueLoading(true);
    if (!silent) setQueueError(null);
    try {
      const payload = await fetchJson<{ queue?: QueueRow[] }>('/api/work-orders/queue');
      setQueueRows(Array.isArray(payload?.queue) ? payload.queue : []);
    } catch (cause) {
      setQueueError(errorMessage(cause));
    } finally {
      if (!silent) setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
    void loadQueue();
  }, [loadList, loadQueue]);

  const loadPackages = useCallback(async () => {
    setPackagesLoading(true);
    setPackageError(null);
    try {
      const payload = await fetchJson<InboxPayload>('/api/portal/inbox');
      const rows = Array.isArray(payload?.items) ? payload.items : [];
      setPackages(rows.filter((item) => item.packageDir));
    } catch (cause) {
      setPackageError(errorMessage(cause));
    } finally {
      setPackagesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  const refreshDetail = useCallback(async (id: string) => {
    try {
      const payload = await fetchJson<DetailPayload>(`/api/work-orders/${encodeURIComponent(id)}`);
      setDetail(payload);
      try {
        const loaded = await fetchJson<{ receipt?: ReceiptFull }>(
          `/api/work-orders/${encodeURIComponent(id)}/receipt`,
        );
        setReceipt(loaded?.receipt || null);
      } catch {
        setReceipt(null);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  const selectWorkOrder = useCallback(async (id: string) => {
    setSelectedId(id);
    setNotice(null);
    setReceipt(null);
    setDetail(null);
    await refreshDetail(id);
  }, [refreshDetail]);

  const parseDraft = useCallback(() => {
    try {
      const parsed = JSON.parse(draftText);
      setPreview(JSON.stringify(parsed, null, 2));
      setNotice('工单预览已生成，确认无误后创建作业');
      return parsed;
    } catch (cause) {
      setError(`工单 JSON 无法解析：${errorMessage(cause)}`);
      return null;
    }
  }, [draftText]);

  const createWorkOrder = useCallback(async () => {
    const parsed = preview ? JSON.parse(preview) : parseDraft();
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await fetchJson<{ work_order?: WorkOrderRow }>('/api/work-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      setNotice(`作业已创建：${payload?.work_order?.work_order_id || ''}`);
      setDraftText('');
      setPreview('');
      await loadList();
      if (payload?.work_order?.work_order_id) {
        await selectWorkOrder(payload.work_order.work_order_id);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [loadList, parseDraft, preview, selectWorkOrder]);

  const runWorkOrder = useCallback(async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await fetchJson<{
        status?: 'queued' | 'running';
        position?: number;
        work_order?: WorkOrderRow;
      }>(
        `/api/work-orders/${encodeURIComponent(selectedId)}/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
        },
      );
      if (payload?.status === 'running') {
        setNotice('作业已在执行，队列位置 0');
      } else {
        setNotice(`已加入队列，当前第 ${payload?.position ?? 1} 位`);
      }
      await loadList(true);
      await loadQueue(true);
      await refreshDetail(selectedId);
    } catch (cause) {
      setError(errorMessage(cause));
      await loadList(true);
      await loadQueue(true);
    } finally {
      setBusy(false);
    }
  }, [loadList, loadQueue, refreshDetail, selectedId]);

  const refreshReceipt = useCallback(async () => {
    if (!selectedId) return;
    try {
      const loaded = await fetchJson<{ receipt?: ReceiptFull }>(
        `/api/work-orders/${encodeURIComponent(selectedId)}/receipt`,
      );
      setReceipt(loaded?.receipt || null);
      setNotice('回执已刷新');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [selectedId]);

  const choosePackage = useCallback((item: InboxPackage) => {
    setActivePackage(item.packageDir || null);
    setPackageDraft('');
    setPackageForm({
      lineId: item.summary?.suggestedLine || '',
      modIds: (item.summary?.modIds || []).join(', '),
      seed: '',
    });
  }, []);

  const createFromPackage = useCallback(async (autoQueue = false) => {
    if (!activePackage) return;
    const modIds = packageForm.modIds
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (modIds.length === 0) {
      setError('请先填写至少一个 Mod');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        package_dir: activePackage,
        mod_ids: modIds,
      };
      if (packageForm.lineId) body.line_id = packageForm.lineId;
      const seedText = packageForm.seed.trim();
      if (seedText) {
        const seed = Number(seedText);
        if (!Number.isInteger(seed) || seed <= 0) {
          setError('seed 必须是正整数，留空则使用分析线默认值');
          setBusy(false);
          return;
        }
        body.seed = seed;
      }
      const payload = await fetchJson<{
        draft?: unknown;
        work_order?: WorkOrderRow;
        status?: 'queued' | 'running';
        position?: number;
      }>('/api/work-orders/from-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setPackageDraft(JSON.stringify(payload?.draft || {}, null, 2));
      const workOrderId = payload?.work_order?.work_order_id || '';
      if (!workOrderId) {
        setError('提交包已生成工单，但接口未返回作业号');
        return;
      }
      if (autoQueue) {
        const queued = await fetchJson<{
          status?: 'queued' | 'running';
          position?: number;
        }>(`/api/work-orders/${encodeURIComponent(workOrderId)}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
        });
        setNotice(queued?.status === 'running'
          ? `作业 ${workOrderId} 已在执行`
          : `作业 ${workOrderId} 已加入队列，当前第 ${queued?.position ?? 1} 位`);
      } else {
        setNotice(`已从提交包创建作业：${workOrderId}`);
      }
      await loadList();
      await loadQueue(true);
      await selectWorkOrder(workOrderId);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [activePackage, loadList, loadQueue, packageForm, selectWorkOrder]);

  const needsPolling = queueRows.length > 0
    || rows.some((row) => row.status === 'running')
    || detail?.work_order?.status === 'running';

  useEffect(() => {
    if (!needsPolling) return undefined;
    const timer = setInterval(() => {
      void loadList(true);
      void loadQueue(true);
      if (selectedId) void refreshDetail(selectedId);
    }, 3000);
    return () => clearInterval(timer);
  }, [needsPolling, loadList, loadQueue, refreshDetail, selectedId]);

  const currentStatus = detail?.work_order?.status || 'queued';
  const stages = Array.isArray(receipt?.stages) ? receipt.stages : [];
  const queuePositions = new Map(queueRows.map((row) => [row.work_order_id, row.position]));
  const runningRow = rows.find((row) => row.status === 'running') || null;
  const recentRows = rows
    .filter((row) => row.status === 'completed' || row.status === 'failed' || row.status === 'blocked')
    .slice(-5)
    .reverse();

  return (
    <div className="view-container work-order-center">
      <div className="card">
        <div className="card-head">
          <h2 className="card-title">作业中心</h2>
          <button type="button" className="btn" onClick={() => void loadList()} disabled={loading}>
            刷新列表
          </button>
        </div>
        <p className="hint">
          作业状态固定为排队中、执行中、已完成、失败、阻塞。管理员确认后加入队列，
          单并发按创建时间顺序执行，执行中的作业每 3 秒自动刷新。
        </p>
        <div className="chip-row">
          {STATUS_ORDER.map((status) => (
            <span key={status} className={`chip${currentStatus === status ? ' chip-active' : ''}`}>
              {STATUS_LABELS[status]}
            </span>
          ))}
        </div>
      </div>

      <div className="card" data-testid="queue-panel">
        <div className="card-head">
          <h3 className="card-title">执行队列</h3>
          <button type="button" className="btn" onClick={() => void loadQueue()} disabled={queueLoading}>
            刷新队列
          </button>
        </div>
        <p className="hint">队列由磁盘元数据派生，只包含已确认且排队中的作业，单并发先进先出。</p>
        {queueError && <p className="error-text">{queueError}</p>}
        <div className="work-order-list">
          <span className="subtle">等待中</span>
          {!queueLoading && queueRows.length === 0 && (
            <p className="subtle" data-testid="empty-state" data-empty-kind="queue">
              当前没有等待执行的作业。
            </p>
          )}
          {queueRows.map((row) => (
            <button
              key={row.work_order_id}
              type="button"
              className="work-order-row"
              data-testid="queue-row"
              onClick={() => void selectWorkOrder(row.work_order_id)}
            >
              <span className="work-order-id">第 {row.position} 位</span>
              <span>{row.work_order_id}</span>
              <span className="subtle">{row.project_id}</span>
              <span className="subtle">{row.line_id}</span>
            </button>
          ))}
        </div>
        <div className="work-order-list">
          <span className="subtle">执行中</span>
          {runningRow ? (
            <div className="work-order-row" data-testid="queue-running">
              <span className="work-order-id">{runningRow.work_order_id}</span>
              <span className="subtle">{runningRow.project_id}</span>
              <span className="badge badge-running">{statusLabel('running')}</span>
            </div>
          ) : (
            <p className="subtle">当前没有执行中的作业。</p>
          )}
        </div>
        <div className="work-order-list">
          <span className="subtle">最近完成</span>
          {recentRows.length === 0 && <p className="subtle">还没有完成的作业。</p>}
          {recentRows.map((row) => (
            <div key={row.work_order_id} className="work-order-row">
              <span className="work-order-id">{row.work_order_id}</span>
              <span className={`badge badge-${row.status}`}>{statusLabel(row.status)}</span>
              <span className="subtle">{row.created_at}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3 className="card-title">客户提交包</h3>
          <div className="chip-row">
            <button type="button" className="btn" onClick={() => void loadPackages()} disabled={packagesLoading}>
              刷新提交包
            </button>
          </div>
        </div>
        <p className="hint">
          从门户收件箱的 PKG_ 包生成 work_order/v2 草稿。分析线按数据类型预选，Mod 与 seed 由管理员显式给出。
        </p>
        {packageError && <p className="error-text">{packageError}</p>}
        {!packagesLoading && packages.length === 0 && (
          <p className="subtle" data-testid="empty-state" data-empty-kind="no-packages">
            收件箱里还没有 PKG_ 提交包。
          </p>
        )}
        <div className="work-order-list">
          {packages.map((item) => (
            <div key={item.packageDir || item.file} className="work-order-row">
              <span className="work-order-id">{item.packageDir}</span>
              <span className="subtle">{item.summary?.name || item.file}</span>
              <span className="subtle">{item.summary?.dataType || '-'}</span>
              <span className="subtle">
                数据 {item.attachments?.data_files ?? 0} / 文献 {item.attachments?.references ?? 0}
              </span>
              <button type="button" className="btn" onClick={() => choosePackage(item)}>
                生成工单
              </button>
            </div>
          ))}
        </div>
        {activePackage && (
          <div className="form-grid-2">
            <div>
              <span className="subtle">提交包</span>
              <p>{activePackage}</p>
            </div>
            <div>
              <span className="subtle">分析线</span>
              <select
                className="form-input"
                value={packageForm.lineId}
                onChange={(event) => setPackageForm((prev) => ({ ...prev, lineId: event.target.value }))}
              >
                <option value="">按数据类型自动</option>
                <option value="line1_bulk">线1 / GEO bulk</option>
                <option value="line2_scrna">线2 / 单细胞</option>
                <option value="line3_spatial">线3 / 空间转录组</option>
              </select>
            </div>
            <div>
              <span className="subtle">Mod（逗号分隔）</span>
              <input
                className="form-input"
                value={packageForm.modIds}
                onChange={(event) => setPackageForm((prev) => ({ ...prev, modIds: event.target.value }))}
                placeholder="l1_ingest_prep"
              />
            </div>
            <div>
              <span className="subtle">seed（留空用分析线默认值）</span>
              <input
                className="form-input"
                value={packageForm.seed}
                onChange={(event) => setPackageForm((prev) => ({ ...prev, seed: event.target.value }))}
                placeholder="20261013"
              />
            </div>
          </div>
        )}
        {activePackage && (
          <div className="chip-row">
            <button type="button" className="btn btn-primary" onClick={() => void createFromPackage()} disabled={busy}>
              生成工单
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void createFromPackage(true)} disabled={busy}>
              一键分析并排队
            </button>
          </div>
        )}
        {packageDraft && (
          <pre className="work-order-preview" data-testid="package-work-order-preview">{packageDraft}</pre>
        )}
      </div>

      {loading && (
        <div className="card" data-testid="loading-state">
          <p className="subtle">正在读取作业列表</p>
        </div>
      )}

      {error && (
        <div className="card" data-testid="error-state" data-error-kind="request">
          <p className="error-text">{error}</p>
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="card" data-testid="empty-state" data-empty-kind="no-work-orders">
          <p className="subtle">当前还没有作业。粘贴一份 work_order/v2 JSON，预览后创建。</p>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3 className="card-title">作业列表</h3>
        </div>
        <div className="work-order-list">
          {rows.map((row) => (
            <button
              key={row.work_order_id}
              type="button"
              className={`work-order-row${selectedId === row.work_order_id ? ' work-order-row-active' : ''}`}
              onClick={() => void selectWorkOrder(row.work_order_id)}
            >
              <span className="work-order-id">{row.work_order_id}</span>
              {queuePositions.has(row.work_order_id) && (
                <span className="badge badge-queued">第 {queuePositions.get(row.work_order_id)} 位</span>
              )}
              <span className="subtle">{row.project_id}</span>
              <span className="subtle">{row.line_id}</span>
              <span className={`badge badge-${row.status}`} data-testid="work-order-status" data-status={row.status}>
                {statusLabel(row.status)}
              </span>
              <span className="subtle">{row.created_at}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3 className="card-title">创建作业</h3>
          <div className="chip-row">
            <button type="button" className="btn" onClick={() => parseDraft()} disabled={!draftText.trim()}>
              预览工单
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void createWorkOrder()} disabled={busy}>
              创建作业
            </button>
          </div>
        </div>
        <textarea
          className="form-input work-order-draft"
          rows={10}
          value={draftText}
          onChange={(event) => {
            setDraftText(event.target.value);
            setPreview('');
          }}
          placeholder="粘贴 work_order/v2 JSON"
        />
        {preview && (
          <pre className="work-order-preview" data-testid="work-order-preview">{preview}</pre>
        )}
      </div>

      {selectedId && (
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">作业详情</h3>
            <div className="chip-row">
              <button type="button" className="btn" onClick={() => void refreshReceipt()}>
                刷新回执
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void runWorkOrder()}
                disabled={busy || currentStatus !== 'queued' || !detail}
              >
                确认并排队
              </button>
            </div>
          </div>
          <div className="form-grid-2">
            <div>
              <span className="subtle">作业号</span>
              <p>{detail?.work_order?.work_order_id || selectedId}</p>
            </div>
            <div>
              <span className="subtle">项目</span>
              <p>{detail?.work_order?.project_id || '-'}</p>
            </div>
            <div>
              <span className="subtle">分析线</span>
              <p>{detail?.work_order?.line_id || '-'}</p>
            </div>
            <div>
              <span className="subtle">状态</span>
              <p className={`badge badge-${currentStatus}`} data-testid="work-order-status" data-status={currentStatus}>
                {statusLabel(currentStatus)}
              </p>
            </div>
            <div>
              <span className="subtle">队列位置</span>
              <p data-testid="queue-position">
                {currentStatus === 'running'
                  ? '执行中'
                  : detail?.queue_position
                    ? `第 ${detail.queue_position} 位`
                    : '-'}
              </p>
            </div>
          </div>
          {detail?.receipt?.error && (
            <p className="error-text">
              错误码：{detail.receipt.error.code || '-'}，{detail.receipt.error.message || '无说明'}
            </p>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3 className="card-title">阶段时间线</h3>
        </div>
        <div className="stage-timeline" data-testid="stage-timeline">
          {stages.length === 0 && <p className="subtle">回执生成后显示阶段时间线</p>}
          {stages.map((stage, index) => (
            <div key={`${stage.name || 'stage'}-${index}`} className="stage-entry">
              <span className={`badge badge-${stage.status || 'unknown'}`}>{stage.status || 'unknown'}</span>
              <span className="stage-name">{stage.name || `阶段 ${index + 1}`}</span>
              <span className="subtle">{stage.at || ''}</span>
              {stage.code && <span className="error-text">{stage.code}</span>}
            </div>
          ))}
        </div>
        {receipt && (
          <p className="hint">
            回执 {receipt.receipt_id || '-'}，阶段 {receipt.stage_count ?? stages.length} 个，产物 {receipt.artifact_count ?? 0} 项
          </p>
        )}
      </div>

      {notice && <p className="hint" role="status">{notice}</p>}
    </div>
  );
}
