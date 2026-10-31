import { useCallback, useEffect, useRef, useState } from 'react';
import { LINES, LINE_LABELS } from '../../server/domain.js';
import type { LedgerResponse, LogLine, StepsResponse, TaskEntry } from './shared/types';

// ============================================================
// 任务面板（复用现有逻辑，改为 CSS class）
// ============================================================

/**
 * 客户端路径形态预检（S29 / R9）：只提示，不阻断提交。
 * 判据在服务端 validateTaskPaths；这里只挑"明显缺 projects/ 段"的行提醒，
 * 历史三线形态与 processed/ 下的相对文件名仍可提交。
 */
function pathShapeWarnings(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item !== '' && !item.includes('projects/'));
}

/**
 * 虚拟敲除类步骤（aims:185）：选中它们时靶基因必填。
 *
 * 这张表与服务端 server/task.js 的 KNOCKOUT_STEPS 同源同内容。前端留一份只为
 * "选完就能看见必填框、按钮即时禁用"，不承担最终裁决：绕过前端的调用方
 * （脚本、curl）由 /api/tasks/submit 的 400 拦住。
 */
const KO_STEPS = ['virtual_knockout', 'spatial_knockout'];

/** 基因符号形态：首字符字母或数字，其余字母数字与 . _ -，总长 1..32（与服务端同口径） */
const KO_GENE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

export function TaskPanel({ project }: { project: string }) {
  const [line, setLine] = useState<string>(LINES[0]);
  const [step, setStep] = useState('');
  // 契约固定种子（aims §一.3）：默认值就是台账复现所需的种子，改动需用户自己负责
  const [seed, setSeed] = useState('20261013');
  const [inputs, setInputs] = useState('');
  const [outputs, setOutputs] = useState('');
  // 步骤清单（/api/projects/steps）与"自定义步骤"开关：下拉是便利入口，不收回手填
  const [stepsData, setStepsData] = useState<StepsResponse['steps'] | null>(null);
  const [stepCustom, setStepCustom] = useState(false);
  // 虚拟敲除靶基因（aims:185）：只有敲除类步骤才显示与提交，其它步骤该值为空且不注入
  const [koGene, setKoGene] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [exitInfo, setExitInfo] = useState<{ code: number | null; entry: TaskEntry | null; note?: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const box = logBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [logs]);

  useEffect(() => () => eventSourceRef.current?.close(), []);

  // 步骤清单来自 /api/projects/steps（三线步骤由 src/ 母版定义）。
  // 拉不到就静默退回纯手填，不阻塞下发（R10：自由文本入口保留）。
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/projects/steps');
        const payload = (await res.json()) as StepsResponse;
        setStepsData(payload.steps);
      } catch {
        // 静默：下拉为空时用户仍可"自定义"手填命令名
      }
    })();
  }, []);

  // 当前步骤是否属于虚拟敲除（决定靶基因框是否显示与必填）。
  // 必须在 submit 之前声明：submit 的依赖数组在渲染时就会求值，
  // 声明在后面会撞上 const 的暂时性死区（ReferenceError）。
  const needsKoGene = KO_STEPS.includes(step.trim());

  const appendLog = useCallback((stream: LogLine['stream'], text: string) => {
    setLogs((prev) => [...prev, { stream, text }]);
  }, []);

  const openLogStream = useCallback(
    (id: string) => {
      eventSourceRef.current?.close();
      const source = new EventSource(`/api/tasks/logs?id=${encodeURIComponent(id)}`);
      source.addEventListener('stdout', (event) => appendLog('stdout', (event as MessageEvent<string>).data));
      source.addEventListener('stderr', (event) => appendLog('stderr', (event as MessageEvent<string>).data));
      source.addEventListener('exit', (event) => {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          code: number | null;
          entry?: TaskEntry;
          note?: string;
        };
        setExitInfo({ code: payload.code, entry: payload.entry ?? null, note: payload.note });
        setRunning(false);
        source.close();
        eventSourceRef.current = null;
      });
      eventSourceRef.current = source;
    },
    [appendLog]
  );

  const submit = useCallback(async () => {
    setSubmitError(null);
    setLogs([]);
    setExitInfo(null);
    if (!step.trim()) {
      setSubmitError('step 必填');
      return;
    }
    // 敲除步骤的前端拦截：与服务端同口径，先在这里给出人话提示，
    // 免得用户点了下发才收到 400（服务端仍是唯一权威）。
    const gene = koGene.trim();
    if (needsKoGene) {
      if (!gene) {
        setSubmitError('虚拟敲除必须指定靶基因（target_ko_gene）');
        return;
      }
      if (!KO_GENE_RE.test(gene)) {
        setSubmitError('靶基因非法：只允许字母数字与 . _ -，长度 1..32，首字符不能是 . 或 -');
        return;
      }
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/tasks/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project,
          lineId: line,
          step: step.trim(),
          inputs: inputs.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
          outputs: outputs.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
          seed: seed.trim() === '' ? undefined : Number(seed),
          // 只有敲除步骤带靶基因；其它步骤不传（服务端语义：传了也忽略）
          targetKoGene: needsKoGene ? gene : undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setSubmitError(payload.error || `HTTP ${response.status}`);
        return;
      }
      setTaskId(payload.taskId);
      setRunning(true);
      openLogStream(payload.taskId);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }, [line, step, seed, inputs, outputs, openLogStream, project, koGene, needsKoGene]);

  const stop = useCallback(async () => {
    if (!taskId) return;
    try {
      await fetch(`/api/tasks/stop?id=${encodeURIComponent(taskId)}`, { method: 'POST' });
    } catch (cause) {
      appendLog('stderr', `[ui] 中止请求失败: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    }
  }, [taskId, appendLog]);

  const exitPalette =
    exitInfo === null
      ? null
      : exitInfo.code === 0
        ? { cls: 'badge-pass', text: 'exit 0（成功）' }
        : exitInfo.code === null
          ? { cls: 'badge-unknown', text: '已中止' }
          : { cls: 'badge-fail', text: `exit ${exitInfo.code}（失败）` };

  const lineSteps: string[] = stepsData ? (stepsData[line as keyof typeof stepsData] ?? []) : [];
  const shapeWarnings = [...pathShapeWarnings(inputs), ...pathShapeWarnings(outputs)];
  // 靶基因填了但形态不对：黄色提示 + 禁用下发按钮（空值另由必填提示与 submit 拦截负责）
  const koGeneInvalid = needsKoGene && koGene.trim() !== '' && !KO_GENE_RE.test(koGene.trim());

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">任务下发 + 日志流</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => void submit()}
            disabled={submitting || running || (needsKoGene && !KO_GENE_RE.test(koGene.trim()))}>
            {submitting ? '提交中...' : running ? '运行中...' : '下发任务'}
          </button>
          <button className="btn" onClick={() => void stop()} disabled={!running}>中止</button>
        </div>
      </div>

      <div className="chip-row">
        {LINES.map((item) => (
          <button key={item} type="button"
            className={`chip${line === item ? ' chip-active' : ''}`}
            onClick={() => {
              setLine(item);
              // 换线后旧步骤名不属于新线，清空避免带着上一条线的步骤提交
              if (!stepCustom) setStep('');
            }}>
            {LINE_LABELS[item as keyof typeof LINE_LABELS]}
          </button>
        ))}
      </div>

      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">步骤名</label>
          <select className="form-input"
            value={stepCustom ? '__custom__' : (lineSteps.includes(step) ? step : '')}
            onChange={(e) => {
              const value = e.target.value;
              if (value === '__custom__') {
                setStepCustom(true);
                setStep('');
              } else {
                setStepCustom(false);
                setStep(value);
              }
            }}>
            <option value="">{lineSteps.length > 0 ? '选择步骤（或自定义）' : '步骤清单未加载，可选自定义'}</option>
            {lineSteps.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
            <option value="__custom__">自定义（手动输入命令名）</option>
          </select>
          {stepCustom && (
            <input className="form-input" style={{ marginTop: 8 }} value={step}
              onChange={(e) => setStep(e.target.value)}
              placeholder="命令名，仅限字母数字与 . _ -" />
          )}
        </div>
        <div className="form-group">
          <label className="form-label">随机种子</label>
          <input className="form-input" value={seed}
            onChange={(e) => setSeed(e.target.value)} inputMode="numeric" />
          <p className="subtle">契约固定种子 20261013（aims §一.3）；改动将使结果不可复现</p>
        </div>
      </div>
      <p className="hint">
        步骤名即远端执行的命令名（只能包含字母数字与 . _ -），参数请走下方输入/输出文件。
        下拉清单来自 /api/projects/steps，取不到或需要新步骤时选「自定义」手填。
      </p>

      {needsKoGene && (
        <div className="form-group">
          <label className="form-label">敲除靶基因 target_ko_gene（必填）</label>
          <input className="form-input" value={koGene}
            onChange={(e) => setKoGene(e.target.value)}
            placeholder="基因符号，如 TNF（line2 默认）/ Spp1（line3 mouse 默认）" />
          <p className="subtle">
            步骤 {step.trim()} 是虚拟敲除：必须指定敲除谁的基因，下发时写入远端环境变量 BIO_KO_GENE。
            基因符号只能含字母数字与 . _ -（长度 1..32），空值或不合法时下发按钮禁用。
          </p>
          {koGeneInvalid && (
            <p className="hint" style={{ color: '#b3261e' }}>
              基因符号非法：只允许字母数字与 . _ -，长度 1..32，首字符不能是 . 或 -
            </p>
          )}
        </div>
      )}

      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">输入文件（每行一个）</label>
          <textarea className="form-input" rows={3} value={inputs}
            onChange={(e) => setInputs(e.target.value)}
            placeholder={`/mnt/ssd/bio_data/projects/${project}/${line}/processed/data/expr.tsv`}
            style={{ fontFamily: 'monospace' }} />
        </div>
        <div className="form-group">
          <label className="form-label">输出文件（每行一个）</label>
          <textarea className="form-input" rows={3} value={outputs}
            onChange={(e) => setOutputs(e.target.value)}
            placeholder={`/mnt/ssd/bio_data/projects/${project}/${line}/results/deg.tsv`}
            style={{ fontFamily: 'monospace' }} />
        </div>
      </div>
      <p className="hint">
        路径须属于当前项目 {project}；提交前会校验归属与形态（跨项目、含 ..、系统目录一律 400），
        存在性由远端任务自行报错。历史三线形态与 processed/ 下的相对文件名仍可提交。
      </p>

      {shapeWarnings.length > 0 && (
        <div className="block-box" style={{ background: '#fffbe6', borderColor: '#f5d9a8', color: '#8a5a00' }}>
          <strong>路径形态提醒（仅提示，不阻断提交）</strong>
          <p className="hint" style={{ color: '#8a5a00' }}>
            以下 {shapeWarnings.length} 条路径缺少 projects/&lt;项目&gt; 段：
            {shapeWarnings.slice(0, 5).join('、')}
            {shapeWarnings.length > 5 ? ` 等 ${shapeWarnings.length} 条` : ''}。
            可能是历史三线形态或 processed/ 下的相对文件名，请确认是刻意使用。
          </p>
        </div>
      )}

      {submitError && (
        <div className="block-box" style={{ background: '#fdecea', borderColor: '#f5b7b1', color: '#b3261e' }}>
          <strong>下发被拒绝</strong>
          <p className="hint" style={{ color: '#b3261e' }}>{submitError}</p>
        </div>
      )}

      {taskId && (
        <p className="subtle">任务 ID：{taskId}（{line} / {step}）</p>
      )}

      {logs.length > 0 && (
        <div ref={logBoxRef} className="log-box">
          {logs.map((log, index) => (
            <div key={index} className={log.stream === 'stderr' ? 'log-stderr' : 'log-stdout'}>
              {log.text}
            </div>
          ))}
        </div>
      )}

      {exitInfo && exitPalette && (
        <div style={{ marginTop: 12 }}>
          <span className={`badge ${exitPalette.cls}`}>{exitPalette.text}</span>
          {exitInfo.note && <span className="hint"> {exitInfo.note}</span>}
          {exitInfo.entry && (
            <table className="data-table">
              <tbody>
                <tr><td>台账 task_id</td><td>{exitInfo.entry.task_id}</td></tr>
                <tr><td>状态 / checkpoint</td><td>{exitInfo.entry.status} / {exitInfo.entry.checkpoint_status}</td></tr>
                <tr><td>种子</td><td>{exitInfo.entry.environment.random_seed ?? '未记录'}</td></tr>
                <tr><td>error_log</td><td style={{ color: exitInfo.entry.error_log ? '#b3261e' : '#52606d' }}>
                  {exitInfo.entry.error_log ? exitInfo.entry.error_log.slice(-500) : '无'}
                </td></tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {logs.length === 0 && !exitInfo && !submitError && (
        <p className="hint">下发后这里实时显示远端 stdout/stderr；任务结束自动回显退出码与台账摘要。跨线内容会被审计直接拒绝（HTTP 400）。</p>
      )}
    </div>
  );
}

// ============================================================
// 台账巡检面板
// ============================================================

export function LedgerPanel() {
  const [result, setResult] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/ledger/check');
      setResult(await response.json());
    } catch (cause) {
      setResult({ error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setLoading(false);
    }
  }, []);

  const exportReport = useCallback(() => {
    if (!result || !('blocked' in result) || result.blocked) return;
    const lines: string[] = [
      `# 台账合规巡检报告`,
      `目录: ${result.dir}`,
      `时间: ${new Date().toLocaleString('zh-CN')}`,
      `总计 ${result.summary.total} 条，合法 ${result.summary.legal}，违规 ${result.summary.violations}`,
      '',
    ];
    for (const entry of result.entries) {
      lines.push(`${entry.legal ? 'OK' : 'VIOLATION'}  ${entry.file}  line_id=${entry.lineId} step=${entry.stepName} status=${entry.status}`);
      for (const problem of entry.problems) lines.push(`    - ${problem}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `ledger_audit_${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }, [result]);

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">台账合规巡检</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => void run()} disabled={loading}>
            {loading ? '巡检中...' : '开始巡检'}
          </button>
          <button className="btn" onClick={exportReport}
            disabled={!result || !('blocked' in result) || result.blocked}>
            导出报告
          </button>
        </div>
      </div>

      {!result && <p className="hint">点"开始巡检"读取服务器台账并逐条判定。</p>}

      {result && 'error' in result && <p className="error-text">后端错误：{result.error}</p>}

      {result && 'blocked' in result && result.blocked && (
        <div className="block-box">
          <strong>阻塞：{result.reason}</strong>
          <p className="hint">{result.hint}</p>
        </div>
      )}

      {result && 'summary' in result && !result.blocked && result.summary && (
        <>
          <div className="compute-row">
            <div className="compute-cell">
              <div className="compute-cell-label">台账总数</div>
              <div className="compute-cell-value">{result.summary.total}</div>
            </div>
            <div className="compute-cell">
              <div className="compute-cell-label">合法</div>
              <div className="compute-cell-value" style={{ color: '#0f7b3f' }}>{result.summary.legal}</div>
            </div>
            <div className="compute-cell">
              <div className="compute-cell-label">违规</div>
              <div className="compute-cell-value" style={{ color: result.summary.violations > 0 ? '#b3261e' : '#1f2933' }}>
                {result.summary.violations}
              </div>
            </div>
          </div>

          <h3 className="card-subtitle">按线统计</h3>
          <table className="data-table">
            <thead>
              <tr><th>线</th><th>合法</th><th>违规</th><th>已记录步骤</th></tr>
            </thead>
            <tbody>
              {LINES.map((line) => {
                const bucket = result.summary.byLine[line];
                return (
                  <tr key={line}>
                    <td>{LINE_LABELS[line as keyof typeof LINE_LABELS]}</td>
                    <td style={{ color: '#0f7b3f' }}>{bucket.legal}</td>
                    <td style={{ color: bucket.violations > 0 ? '#b3261e' : '#52606d' }}>{bucket.violations}</td>
                    <td>
                      {Object.keys(bucket.steps).length === 0
                        ? '无'
                        : Object.entries(bucket.steps)
                            .map(([step, state]) => `${step}（${state === 'legal' ? '合法' : '违规'}）`)
                            .join('；')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {result.entries.length > 0 && (
            <>
              <h3 className="card-subtitle">逐条明细</h3>
              <table className="data-table">
                <thead>
                  <tr><th>文件</th><th>判定</th><th>原因</th></tr>
                </thead>
                <tbody>
                  {result.entries.map((entry) => (
                    <tr key={entry.file}>
                      <td>
                        {entry.file}
                        <div className="subtle">{entry.lineId} / {entry.stepName} / {entry.status}</div>
                      </td>
                      <td style={{ color: entry.legal ? '#0f7b3f' : '#b3261e' }}>
                        {entry.legal ? 'OK' : 'VIOLATION'}
                      </td>
                      <td>
                        {entry.problems.length === 0 ? '无' : entry.problems.map((p) => <div key={p}>{p}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}
