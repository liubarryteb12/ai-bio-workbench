/**
 * 从 App.tsx 原样搬来：函数体逐字未改，只加了 export 关键字。
 * DeliveryReportCard 只在本视图内使用，故不导出。
 */
import { useCallback, useEffect, useState } from 'react';

import { LINES, LINE_LABELS } from '../../server/domain.js';
import { FigureAdaptCard } from './FigureGalleryView';
import { SUBDIRS, LAYOUT_TEMPLATE_LABEL } from './shared/constants';
import { readApiState } from './shared/helpers';
import type {
  FigureEntry, FiguresResponse, FilesResponse, ProjectMetaBrief, TreeNode,
} from './shared/types';
// ============================================================
// 视图4：结果预览 Studio（Result Preview Studio）
// ============================================================

export function ResultPreviewStudio({ project }: { project: string }) {
  const [figuresByLine, setFiguresByLine] = useState<Record<string, FigureEntry[]>>({});
  const [figuresSource, setFiguresSource] = useState<Record<string, 'local' | 'remote'>>({});
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullNote, setPullNote] = useState('');
  const [zoom, setZoom] = useState<{ name: string; line: string } | null>(null);
  const [selectedFig, setSelectedFig] = useState<{ name: string; line: string } | null>(null);
  // 项目出图配置：让对接人一眼看到"这批图按哪个模板/阈值出的"
  const [projectMeta, setProjectMeta] = useState<ProjectMetaBrief | null>(null);

  const loadProjectMeta = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/meta?project=${encodeURIComponent(project)}`);
      const payload = (await res.json()) as ProjectMetaBrief & { error?: string };
      setProjectMeta(payload && !payload.error ? payload : null);
    } catch {
      setProjectMeta(null);
    }
  }, [project]);

  useEffect(() => {
    void loadProjectMeta();
  }, [loadProjectMeta]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const result: Record<string, FigureEntry[]> = {};
    const source: Record<string, 'local' | 'remote'> = {};
    for (const line of LINES) {
      try {
        const res = await fetch(
          `/api/figures/list?project=${encodeURIComponent(project)}&line=${encodeURIComponent(line)}`
        );
        const payload = (await res.json()) as FiguresResponse;
        if (!('blocked' in payload) && !('error' in payload)) continue;
        if ('blocked' in payload && !payload.blocked) {
          result[line] = payload.figures;
          if (payload.source) source[line] = payload.source;
        }
      } catch {
        // 跳过单线失败
      }
    }
    setFiguresByLine(result);
    setFiguresSource(source);
    setLoading(false);
  }, [project]);

  /** 把远端图件回搬到本地 outputs/，之后视图 4 直接读本地副本 */
  const pullFigures = useCallback(async () => {
    setPulling(true);
    setPullNote('');
    try {
      const res = await fetch('/api/figures/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project }),
      });
      const payload = (await res.json()) as {
        ok?: boolean; error?: string; localRoot?: string;
        results?: Array<{ lineId: string; pulled: number; skipped: number; failed: number }>;
      };
      if (payload.error) {
        setPullNote(`回搬失败：${payload.error}`);
      } else {
        const summary = (payload.results || [])
          .map((item) => `${item.lineId} 拉取 ${item.pulled} / 跳过 ${item.skipped} / 失败 ${item.failed}`)
          .join('；');
        setPullNote(`回搬完成（${payload.localRoot}）：${summary}`);
      }
    } catch (cause) {
      setPullNote(`回搬失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setPulling(false);
      await loadAll();
    }
  }, [project, loadAll]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const imgUrl = (name: string, line: string) =>
    `/api/figures/image?project=${encodeURIComponent(project)}&line=${encodeURIComponent(line)}&name=${encodeURIComponent(name)}`;

  // 判断图件类型标签：DEG vs DR Genes
  const getGeneTypeTag = (name: string): { label: string; cls: string } => {
    const lower = name.toLowerCase();
    // DR 相关特征（优先匹配，DR 非 DEG）
    if (lower.includes('dr_') || lower.includes('_dr') || lower.includes('dr_gsea') ||
        lower.includes('dr_overlap') || lower.includes('dr_network') || lower.includes('dr_by_domain') ||
        lower.includes('ko_dr') || lower.includes('knockout_dr') || lower.includes('summarize_dr')) {
      return { label: 'DR Genes', cls: 'gene-type-tag-dr' };
    }
    // DEG 相关特征
    if (lower.includes('deg') || lower.includes('volcano') || lower.includes('differential')) {
      return { label: 'DEG', cls: 'gene-type-tag-deg' };
    }
    // 其他默认不标
    return { label: '', cls: '' };
  };

  // 解读卡片内容
  const getInterpretation = (fig: FigureEntry) => {
    const tag = getGeneTypeTag(fig.name);
    const sections: Array<{ title: string; body: string }> = [];

    if (tag.label === 'DEG') {
      sections.push({
        title: '统计口径',
        body: '差异表达基因（DEG）：基于 FDR 校正后的 p 值阈值，对比实验组 vs 对照组。火山图中红=上调、蓝=下调、灰=非显著。',
      });
      sections.push({
        title: '解读重点',
        body: fig.caption || '查看显著基因数量、上下调比例，结合后续富集分析评估生物学意义。',
      });
    } else if (tag.label === 'DR Genes') {
      sections.push({
        title: '统计口径',
        body: '疾病调控基因（DR）：由 SCENIC/虚拟敲除等调控网络分析得出，区别于 DEG。DR 基因反映调控关系而非纯表达差异。',
      });
      sections.push({
        title: '解读重点',
        body: fig.caption || 'DR 基因与 DEG 的交集规模反映调控层与表达层的一致性。交集越大，下游机制假说越可靠。',
      });
    } else {
      sections.push({
        title: '图件说明',
        body: fig.caption || '该图件暂无自动说明。',
      });
    }

    return { tag, sections };
  };

  // 当前选中的图件信息
  const selectedFigEntry = selectedFig
    ? figuresByLine[selectedFig.line]?.find((f) => f.name === selectedFig.name)
    : null;
  const interpretation = selectedFigEntry ? getInterpretation(selectedFigEntry) : null;

  return (
    <div className="view-container" style={{ padding: 16 }}>
      <div className="card" style={{ marginBottom: 12, paddingBottom: 12 }}>
        <div className="card-head">
          <h2 className="card-title">结果预览 Studio</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => void pullFigures()} disabled={pulling}>
              {pulling ? '回搬中...' : '回搬图件到本地'}
            </button>
            <button className="btn" onClick={() => void loadAll()} disabled={loading}>
              {loading ? '加载中...' : '刷新全部'}
            </button>
          </div>
        </div>
        <p className="subtle">左侧步骤树 · 中间图廊+TSV预览 · 右侧三段式解读卡片</p>
        {pullNote && <p className="subtle">{pullNote}</p>}
        {Object.entries(figuresSource).some(([, src]) => src === 'remote') && (
          <p className="hint">
            当前有分析线在读远端实时图件（本地尚无回搬副本）。点「回搬图件到本地」把图存到
            outputs/&lt;项目&gt;/&lt;线&gt;/figures/，之后离线也能看。
          </p>
        )}
        {projectMeta && (
          <div className="studio-meta-strip">
            <span className="studio-meta-item">
              出图模板：{LAYOUT_TEMPLATE_LABEL[projectMeta.plotLayoutConfig?.template_id || ''] || '未指定（按默认 Nature 侧边型）'}
            </span>
            <span className="studio-meta-item">
              DPI：{projectMeta.plotLayoutConfig?.dpi || 300}
            </span>
            <span className="studio-meta-item">
              阈值档：{projectMeta.analysisCutoffs?.profile || '未记录'}
            </span>
            {projectMeta.focusGenes.length > 0 && (
              <span className="studio-meta-item">
                关注基因：{projectMeta.focusGenes.join('、')}
              </span>
            )}
            {projectMeta.targetKoGene && (
              <span className="studio-meta-item">敲除靶基因：{projectMeta.targetKoGene}</span>
            )}
          </div>
        )}
      </div>

      <FigureAdaptCard project={project} />

      <DeliveryReportCard project={project} />

      <div className="studio-layout">
        {/* 左侧步骤树 */}
        <div className="studio-left">
          {LINES.map((line) => {
            const figs = figuresByLine[line] || [];
            if (figs.length === 0) return null;
            return (
              <div key={line} className="studio-tree-group">
                <div className="studio-tree-group-title">
                  {LINE_LABELS[line as keyof typeof LINE_LABELS]}（{figs.length}）
                </div>
                {figs.map((fig) => (
                  <div
                    key={fig.name}
                    className={`studio-tree-item${selectedFig?.name === fig.name && selectedFig?.line === line ? ' studio-tree-item-active' : ''}`}
                    onClick={() => setSelectedFig({ name: fig.name, line })}
                  >
                    {fig.name}
                  </div>
                ))}
              </div>
            );
          })}
          {Object.values(figuresByLine).every((arr) => arr.length === 0) && !loading && (
            <p className="hint">暂无图件。先跑 *_figures 步骤。</p>
          )}
        </div>

        {/* 中间图廊 */}
        <div className="studio-center">
          {selectedFig && selectedFigEntry ? (
            <>
              <div style={{ marginBottom: 12 }}>
                <span className="subtle">当前选中：</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedFig.name}</span>
                <span className="subtle" style={{ marginLeft: 8 }}>
                  {LINE_LABELS[selectedFig.line as keyof typeof LINE_LABELS]}
                </span>
              </div>
              <div className="studio-fig-grid" style={{ gridTemplateColumns: '1fr' }}>
                <div className="studio-fig-card" onClick={() => setZoom(selectedFig)}>
                  <img src={imgUrl(selectedFig.name, selectedFig.line)} alt={selectedFig.name} loading="lazy" />
                  <div className="studio-fig-cap">
                    <span className="studio-fig-name">{selectedFig.name}</span>
                    {selectedFigEntry.caption && <span className="studio-fig-desc">{selectedFigEntry.caption}</span>}
                    {selectedFigEntry.sizeLabel && <span className="subtle">{selectedFigEntry.sizeLabel}</span>}
                  </div>
                </div>
              </div>

              {/* Top TSV 表格预览占位 */}
              <div className="tsv-preview">
                <h3 className="card-subtitle">Top TSV 表格预览</h3>
                <p className="hint">TSV 表格预览通过 /api/files/tree 在该线 results/ 目录下查找 .tsv 文件后展示。</p>
              </div>
            </>
          ) : (
            <>
              {/* 默认展示全部图件 */}
              {LINES.map((line) => {
                const figs = figuresByLine[line] || [];
                if (figs.length === 0) return null;
                return (
                  <div key={line} style={{ marginBottom: 20 }}>
                    <h3 className="card-subtitle">
                      {LINE_LABELS[line as keyof typeof LINE_LABELS]}（{figs.length} 张）
                    </h3>
                    <div className="studio-fig-grid">
                      {figs.map((fig) => {
                        const tag = getGeneTypeTag(fig.name);
                        return (
                          <div key={fig.name} className="studio-fig-card"
                            onClick={() => { setSelectedFig({ name: fig.name, line }); }}>
                            <img src={imgUrl(fig.name, line)} alt={fig.name} loading="lazy" />
                            <div className="studio-fig-cap">
                              {tag.label && <span className={`gene-type-tag ${tag.cls}`}>{tag.label}</span>}
                              <span className="studio-fig-name">{fig.name}</span>
                              {fig.caption && <span className="studio-fig-desc">{fig.caption}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {Object.values(figuresByLine).every((arr) => arr.length === 0) && !loading && (
                <p className="hint">暂无图件。</p>
              )}
            </>
          )}
        </div>

        {/* 右侧三段式解读卡片 */}
        <div className="studio-right">
          {selectedFig && interpretation ? (
            <div className="interpretation-card">
              {interpretation.tag.label && (
                <span className={`gene-type-tag ${interpretation.tag.cls}`}>{interpretation.tag.label}</span>
              )}
              {interpretation.sections.map((sec, i) => (
                <div key={i} className="interpretation-section">
                  <div className="interpretation-section-title">{sec.title}</div>
                  <div className="interpretation-section-body">{sec.body}</div>
                </div>
              ))}
              {/* 第三段：元数据 */}
              <div className="interpretation-section">
                <div className="interpretation-section-title">图件元数据</div>
                <div className="interpretation-section-body">
                  文件名：{selectedFig.name}<br />
                  大小：{selectedFigEntry?.sizeLabel || ' - '}<br />
                  分析线：{LINE_LABELS[selectedFig.line as keyof typeof LINE_LABELS]}
                </div>
              </div>
            </div>
          ) : (
            <div className="interpretation-card">
              <p className="hint">点击左侧步骤树或中间图件，查看三段式解读。</p>
              <p className="subtle" style={{ marginTop: 8 }}>
                顶部强制醒目标签区分 DEG vs DR Genes。
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 图件放大模态 */}
      {zoom && (
        <div className="modal-overlay" onClick={() => setZoom(null)}>
          <div className="modal-inner" onClick={(e) => e.stopPropagation()}>
            <div className="modal-bar">
              <span>{zoom.name}  -  {LINE_LABELS[zoom.line as keyof typeof LINE_LABELS]}</span>
              <button className="btn" onClick={() => setZoom(null)}>关闭</button>
            </div>
            <img className="modal-img" src={imgUrl(zoom.name, zoom.line)} alt={zoom.name} />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 客户交付报告卡片（A4/R3）：一个按钮补齐手工断点 2/3
// ============================================================

type DeliverableFile = { name: string; bytes: number };
type ReportFilesResponse = { ok: boolean; projectId: string; files: DeliverableFile[] };
type ReportBuildResponse = {
  ok: boolean;
  error?: string;
  files?: DeliverableFile[];
  report_md_bytes?: number;
  report_html_bytes?: number;
};

const formatDeliverBytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB`
    : `${bytes} B`;

const deliverDownloadUrl = (project: string, name: string) =>
  `/api/report/download?projectId=${encodeURIComponent(project)}&file=${encodeURIComponent(name)}`;

function DeliveryReportCard({ project }: { project: string }) {
  const [files, setFiles] = useState<DeliverableFile[]>([]);
  const [building, setBuilding] = useState(false);
  // 服务端 error 原样透出（引擎的退出码/stderr 是排查依据，不美化不截断）
  const [errorText, setErrorText] = useState('');
  const [note, setNote] = useState('');

  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/report/files?projectId=${encodeURIComponent(project)}`);
      const payload = (await res.json()) as ReportFilesResponse & { error?: string };
      if (payload.error) {
        setErrorText(payload.error);
        return;
      }
      setFiles(payload.files || []);
    } catch (cause) {
      setErrorText(cause instanceof Error ? cause.message : String(cause));
    }
  }, [project]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const buildReport = useCallback(async () => {
    setBuilding(true);
    setErrorText('');
    setNote('');
    try {
      const res = await fetch('/api/report/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project }),
      });
      const payload = (await res.json()) as ReportBuildResponse;
      if (!res.ok || !payload.ok) {
        // 失败原因（引擎 stderr / 缺失文件名）原样展示
        setErrorText(payload.error || `HTTP ${res.status}`);
        return;
      }
      setNote(`交付件已生成并回搬本地：${(payload.files || []).map((f) => `${f.name}（${formatDeliverBytes(f.bytes)}）`).join('、')}`);
      await loadFiles();
    } catch (cause) {
      setErrorText(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBuilding(false);
    }
  }, [project, loadFiles]);

  return (
    <div className="card" style={{ marginBottom: 12, paddingBottom: 12 }}>
      <div className="card-head">
        <h2 className="card-title">客户交付报告</h2>
        <button className="btn" onClick={() => void buildReport()} disabled={building}>
          {building ? '生成中...' : '生成交付报告'}
        </button>
      </div>
      <p className="subtle">
        在服务器上组装七章解读报告（Analysis_Report.md / .html + Client_Delivery.tar.gz），
        完成后自动回搬本地；生成需在服务器读取全部产物，可能需要数分钟。
      </p>
      {note && <p className="subtle">{note}</p>}
      {errorText && (
        <p className="hint" style={{ color: '#b91c1c', whiteSpace: 'pre-wrap' }}>
          {errorText}
        </p>
      )}
      {files.length > 0 && (
        <div>
          {files.map((file) => (
            <div key={file.name} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '4px 0' }}>
              <span style={{ fontFamily: 'Consolas, monospace', fontSize: 12 }}>{file.name}</span>
              <span className="subtle">{formatDeliverBytes(file.bytes)}</span>
              <a href={deliverDownloadUrl(project, file.name)} download>下载</a>
            </div>
          ))}
        </div>
      )}
      {files.length === 0 && !building && !errorText && (
        <p className="hint">本地暂无交付文件。分析产物齐全后点「生成交付报告」。</p>
      )}
    </div>
  );
}


// ============================================================
// 文件浏览面板
// ============================================================

export function FilesPanel({ project }: { project: string }) {
  const [activeLine, setActiveLine] = useState<string>(LINES[0]);
  const [subdir, setSubdir] = useState<string>('processed');
  const [result, setResult] = useState<FilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const browse = useCallback(
    async (line: string, sub: string) => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/files/tree?project=${encodeURIComponent(project)}&line=${encodeURIComponent(line)}&sub=${encodeURIComponent(sub)}`
        );
        setResult(await response.json());
      } catch (cause) {
        setResult({ error: cause instanceof Error ? cause.message : String(cause) });
      } finally {
        setLoading(false);
      }
    },
    [project]
  );

  useEffect(() => {
    void browse(activeLine, subdir);
  }, [activeLine, subdir, browse]);

  const toggle = (path: string) => setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));

  const renderNode = (node: TreeNode, depth: number) => {
    const isOpen = expanded[node.path] ?? depth < 2;
    const isDir = node.type === 'd';
    return (
      <div key={node.path}>
        <div className="tree-row" style={{ paddingLeft: 8 + depth * 16 }} onClick={() => isDir && toggle(node.path)}>
          <span className="tree-icon">{isDir ? (isOpen ? '▾' : '▸') : ''}</span>
          <span style={{ color: isDir ? '#1f2933' : '#52606d' }}>{node.name}</span>
          {!isDir && <span className="tree-size">{(node.size / 1024).toFixed(1)} KB</span>}
          {isDir && node.children.length === 0 && <span className="tree-size">空</span>}
        </div>
        {isDir && isOpen && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">数据面文件浏览</h2>
        <button className="btn" onClick={() => void browse(activeLine, subdir)} disabled={loading}>
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

      <div className="chip-row">
        {SUBDIRS.map((sub) => (
          <button key={sub} type="button"
            className={`chip${subdir === sub ? ' chip-active' : ''}`}
            onClick={() => setSubdir(sub)}>
            {sub}
          </button>
        ))}
      </div>

      {(() => {
        const state = readApiState<Exclude<FilesResponse, { error: string }>>(result as never);
        if (state.kind === 'loading') return <p className="hint">读取中...</p>;
        if (state.kind === 'failed') return <p className="error-text">后端错误：{state.message}</p>;
        if (state.data.blocked) {
          return (
            <div className="block-box">
              <strong>阻塞：{state.data.reason}</strong>
              <p className="hint">{state.data.hint}</p>
            </div>
          );
        }
        return (
          <>
            <p className="subtle">根：{state.data.root}</p>
            {state.data.tree.children.length === 0 ? (
              <p className="hint">该目录为空。</p>
            ) : (
              <div className="file-tree">{state.data.tree.children.map((node) => renderNode(node, 0))}</div>
            )}
          </>
        );
      })()}
    </div>
  );
}
