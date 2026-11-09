import { useCallback, useEffect, useState } from 'react';

import { LINES, LINE_LABELS } from '../../server/domain.js';
import { readApiState } from './shared/helpers';
import type {
  FigureAdaptResponse,
  FigureTemplateItem,
  FigureTemplateResponse,
  FiguresResponse,
} from './shared/types';

// ============================================================
// 图模板适配卡：选择 ready 模板、生成项目私有派生副本、派发任务
// ============================================================

const TEMPLATE_LINE_PREFIX: Record<string, string> = {
  line1_bulk: 'l1_',
  line2_scrna: 'l2_',
  line3_spatial: 'l3_',
};

const LIST_ADAPT_VARS = ['label_genes', 'axis_cols'];

function adaptValue(key: string, value: string): string | string[] {
  if (!LIST_ADAPT_VARS.includes(key)) return value.trim();
  return value.split(/[,\s\n\r，；]+/).map((item) => item.trim()).filter(Boolean);
}

export function FigureAdaptCard({ project }: { project: string }) {
  const [line, setLine] = useState<string>(LINES[0]);
  const [templates, setTemplates] = useState<FigureTemplateItem[]>([]);
  const [registryOk, setRegistryOk] = useState(false);
  const [registryError, setRegistryError] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [adaptVars, setAdaptVars] = useState<Record<string, string>>({});
  const [deriving, setDeriving] = useState(false);
  const [derivation, setDerivation] = useState<FigureAdaptResponse | null>(null);
  const [adaptError, setAdaptError] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [dispatchNote, setDispatchNote] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/figures/templates');
        const payload = await res.json() as FigureTemplateResponse;
        setTemplates(payload.templates || []);
        setRegistryOk(payload.registry_ok === true);
        setRegistryError(payload.registry_errors || []);
        if (payload.error) setAdaptError(payload.error);
      } catch (cause) {
        setAdaptError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, []);

  useEffect(() => {
    const selected = templates.find((item) => item.id === templateId);
    const next: Record<string, string> = {};
    for (const key of Object.keys(selected?.adapt_vars || {})) next[key] = '';
    setAdaptVars(next);
    setDerivation(null);
    setAdaptError('');
  }, [templateId, templates]);

  const selected = templates.find((item) => item.id === templateId);
  const lineTemplates = templates.filter((item) => (
    (item.lines || []).includes(line)
    || item.linked_mods.some((mod) => mod.startsWith(TEMPLATE_LINE_PREFIX[line]))
  ));
  const hasRequiredVars = selected && Object.keys(adaptVars).length > 0
    ? Object.values(adaptVars).every((value) => value.trim() !== '')
    : false;

  const derive = useCallback(async () => {
    if (!selected) return;
    setDeriving(true);
    setAdaptError('');
    setDerivation(null);
    setDispatchNote('');
    try {
      const body = {
        projectId: project,
        lineId: line,
        templateId: selected.id,
        adaptVars: Object.fromEntries(Object.entries(adaptVars).map(([key, value]) => [key, adaptValue(key, value)])),
        seed: 20261013,
      };
      const res = await fetch('/api/figures/adapt/derive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json() as FigureAdaptResponse & { errors?: string[] };
      if (!res.ok || !result.ok) {
        setAdaptError(result.errors?.join('；') || `HTTP ${res.status}`);
        return;
      }
      setDerivation(result);
    } catch (cause) {
      setAdaptError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeriving(false);
    }
  }, [adaptVars, line, project, selected]);

  const dispatchAdaptTask = useCallback(async () => {
    if (!derivation?.task) return;
    setDispatching(true);
    setDispatchNote('');
    try {
      const res = await fetch('/api/tasks/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(derivation.task),
      });
      const payload = await res.json() as { taskId?: string; error?: string };
      if (!res.ok || payload.error) {
        setDispatchNote(payload.error || `HTTP ${res.status}`);
        return;
      }
      setDispatchNote(`已派发 ${payload.taskId}`);
    } catch (cause) {
      setDispatchNote(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDispatching(false);
    }
  }, [derivation]);

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">图模板适配</h2>
        <span className={`badge ${registryOk ? 'badge-pass' : 'badge-unknown'}`}>
          {registryOk ? '模板库正常' : '模板库异常'}
        </span>
      </div>

      {registryError.length > 0 && <p className="error-text">{registryError.join('；')}</p>}

      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">分析线</label>
          <select className="form-select" value={line} onChange={(e) => {
            setLine(e.target.value);
            setTemplateId('');
          }}>
            {LINES.map((item) => (
              <option key={item} value={item}>{LINE_LABELS[item as keyof typeof LINE_LABELS]}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">图模板</label>
          <select className="form-select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">选择图模板</option>
            {lineTemplates.map((item) => (
              <option key={item.id} value={item.id} disabled={item.deps_status !== 'ready'}>
                {item.name}（{item.english_name || item.id}）
                {item.deps_status !== 'ready' ? `（${item.status_label || item.deps_status}${item.block_reason ? `: ${item.block_reason}` : ''}）` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selected && (
        <div className="studio-fig-grid" style={{ gridTemplateColumns: 'auto 1fr', marginBottom: 12 }}>
          <img
            src={`/api/figures/templates/preview?id=${encodeURIComponent(selected.id)}`}
            alt={`${selected.name} 最新测试项目实例`}
            loading="lazy"
            style={{ maxHeight: 160, objectFit: 'contain', borderRadius: 6 }}
          />
          <div>
            <p className="subtle">{selected.english_name} · {selected.category_label || selected.category} · {selected.language_label || selected.language} · {selected.level_label || selected.level}</p>
            {selected.purpose && <p className="subtle">{selected.purpose}</p>}
            {selected.introduction && <p className="subtle">{selected.introduction}</p>}
            {selected.input_artifact && <p className="subtle">输入：{selected.input_artifact}，产出：{(selected.produces || []).join('、') || '尚未登记'}</p>}
            <p className="subtle">分析线：{(selected.line_labels || []).join('、') || '未绑定'}，对应步骤：{selected.analysis_step || '未绑定'}，状态：{selected.status_label || selected.deps_status}</p>
            <p className="subtle">依赖：{(selected.dependencies || []).slice(0, 10).join('、') || '未登记'}</p>
            {selected.example_source && <p className="subtle">实例来源：{selected.example_source} 最新测试数据</p>}
            {selected.source_sha256 && <p className="subtle">母版校验码：{selected.source_sha256.slice(0, 16)}</p>}
          </div>
        </div>
      )}

      {selected && Object.entries(selected.adapt_vars).map(([key, description]) => (
        <div className="form-group" key={key}>
          <label className="form-label">{key}</label>
          <input
            className="form-input"
            value={adaptVars[key] || ''}
            placeholder={description}
            onChange={(e) => setAdaptVars((prev) => ({ ...prev, [key]: e.target.value }))}
          />
        </div>
      ))}

      <div className="chip-row">
        <button className="btn btn-primary" onClick={() => void derive()}
          disabled={deriving || !selected || !hasRequiredVars}>
          {deriving ? '派生中...' : '生成交付副本'}
        </button>
        <button className="btn" onClick={() => void dispatchAdaptTask()}
          disabled={dispatching || !derivation?.task}>
          {dispatching ? '派发中...' : '派发出图任务'}
        </button>
      </div>

      {adaptError && <p className="error-text">{adaptError}</p>}
      {derivation && (
        <div className="block-box">
          <strong>派生副本已生成</strong>
          <p className="subtle">母版校验码：{derivation.master_sha256}</p>
          <p className="subtle">远端：{derivation.remote_path}</p>
          <p className="subtle">任务步骤：{derivation.task.step}</p>
        </div>
      )}
      {dispatchNote && <p className={dispatchNote.startsWith('已派发') ? 'subtle' : 'error-text'}>{dispatchNote}</p>}
    </div>
  );
}

// ============================================================
// 图件面板
// ============================================================

export function FiguresPanel({ project }: { project: string }) {
  const [activeLine, setActiveLine] = useState<string>(LINES[0]);
  const [result, setResult] = useState<FiguresResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  const load = useCallback(async (line: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/figures/list?project=${encodeURIComponent(project)}&line=${encodeURIComponent(line)}`
      );
      setResult(await response.json());
    } catch (cause) {
      setResult({ error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void load(activeLine);
  }, [activeLine, load]);

  const imgUrl = (name: string) =>
    `/api/figures/image?project=${encodeURIComponent(project)}&line=${encodeURIComponent(activeLine)}&name=${encodeURIComponent(name)}`;

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">结果图件浏览</h2>
        <button className="btn" onClick={() => void load(activeLine)} disabled={loading}>
          {loading ? '读取中...' : '刷新'}
        </button>
      </div>

      <div className="chip-row">
        {LINES.map((line) => (
          <button key={line} type="button"
            className={`chip${activeLine === line ? ' chip-active' : ''}`}
            onClick={() => setActiveLine(line)}>
            {LINE_LABELS[line as keyof typeof LINE_LABELS]}
          </button>
        ))}
      </div>

      {(() => {
        const state = readApiState<Exclude<FiguresResponse, { error: string }>>(result as never);
        // 三态与空态各带固定 data-testid 锚点（T3-5 契约）。
        // 原实现三态逻辑都在，但全是裸 <p>，E2E 只能靠文案猜，
        // 而 t35 测试把本视图列进 VIEWS 却从未断言它，等于有一块盲区。
        if (state.kind === 'loading') return <p className="hint" data-testid="loading-state">读取中...</p>;
        if (state.kind === 'failed') {
          return <p className="error-text" data-testid="error-state" data-error-kind="figures">后端错误：{state.message}</p>;
        }
        if (state.data.blocked) {
          return (
            <div className="block-box" data-testid="error-state" data-error-kind="blocked">
              <strong>阻塞：{state.data.reason}</strong>
              <p className="hint">{state.data.hint}</p>
            </div>
          );
        }
        if (state.data.figures.length === 0) {
          return <p className="hint" data-testid="empty-state" data-empty-kind="figures">该线 figures/ 目录暂无图件。先跑该线的 *_figures 步骤。</p>;
        }
        return (
          <>
            <p className="subtle">
              目录：{state.data.dir}（{state.data.figures.length} 张，点击放大）
            </p>
            {state.data.source && (
              <p className="subtle">
                来源：{state.data.source === 'local' ? '本地回搬 (local)' : '远端实时 (remote)'}
              </p>
            )}
            <div className="studio-fig-grid">
              {state.data.figures.map((fig) => (
                <div key={fig.name} className="studio-fig-card" onClick={() => setZoom(fig.name)}>
                  <img src={imgUrl(fig.name)} alt={fig.name} loading="lazy" />
                  <div className="studio-fig-cap">
                    <span className="studio-fig-name">{fig.name}</span>
                    {fig.caption && <span className="studio-fig-desc">{fig.caption}</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        );
      })()}

      {zoom && (
        <div className="modal-overlay" onClick={() => setZoom(null)}>
          <div className="modal-inner" onClick={(e) => e.stopPropagation()}>
            <div className="modal-bar">
              <span>{zoom}</span>
              <button className="btn" onClick={() => setZoom(null)}>关闭</button>
            </div>
            <img className="modal-img" src={imgUrl(zoom)} alt={zoom} />
          </div>
        </div>
      )}
    </div>
  );
}
