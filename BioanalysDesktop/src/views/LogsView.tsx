import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson, errorMessage } from '../lib/fetchJson';
import { getDesktop } from '../desktop/desktop';
import type { DesktopLogEntry } from '../desktop/desktop';

type RunningTask = { taskId: string; projectId?: string; lineId?: string; step?: string; startedAt?: string };
type TaskLogLine = { stream: string; text: string };

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LogsView({ project }: { project: string }) {
  const desktop = getDesktop();
  const [mode, setMode] = useState<'task' | 'service'>('task');
  const [tasks, setTasks] = useState<RunningTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [taskLines, setTaskLines] = useState<TaskLogLine[]>([]);
  const [serviceLines, setServiceLines] = useState<DesktopLogEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const payload = await fetchJson<{ tasks?: RunningTask[] }>('/api/tasks');
      const list = Array.isArray(payload?.tasks) ? payload.tasks : [];
      setTasks(list);
      setSelectedTaskId((prev) => {
        if (prev && list.some((item) => item.taskId === prev)) return prev;
        return list[0]?.taskId || '';
      });
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadTasks();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadTasks]);

  useEffect(() => {
    if (!desktop) return;
    void desktop.logs.recent().then((entries) => setServiceLines(Array.isArray(entries) ? entries : []));
    return desktop.logs.onLine((entry) => {
      setServiceLines((prev) => [...prev.slice(-3999), entry]);
    });
  }, [desktop]);

  useEffect(() => {
    if (mode !== 'task' || !selectedTaskId) {
      setConnected(false);
      return;
    }
    setTaskLines([]);
    const source = new EventSource(`/api/tasks/logs?id=${encodeURIComponent(selectedTaskId)}`);
    source.addEventListener('open', () => setConnected(true));
    source.addEventListener('stdout', (event) => {
      setTaskLines((prev) => [...prev.slice(-3999), { stream: 'stdout', text: (event as MessageEvent<string>).data }]);
    });
    source.addEventListener('stderr', (event) => {
      setTaskLines((prev) => [...prev.slice(-3999), { stream: 'stderr', text: (event as MessageEvent<string>).data }]);
    });
    source.addEventListener('exit', (event) => {
      setTaskLines((prev) => [...prev, { stream: 'exit', text: (event as MessageEvent<string>).data }]);
      setConnected(false);
      source.close();
    });
    source.addEventListener('error', () => {
      setConnected(false);
    });
    return () => source.close();
  }, [mode, selectedTaskId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [taskLines, serviceLines, mode]);

  const visibleTaskLines = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return taskLines;
    return taskLines.filter((line) => line.text.toLowerCase().includes(needle));
  }, [taskLines, filter]);

  const visibleServiceLines = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return serviceLines;
    return serviceLines.filter((line) => `${line.stream} ${line.line}`.toLowerCase().includes(needle));
  }, [serviceLines, filter]);

  const exportLogs = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (mode === 'task') {
      const text = taskLines.map((line) => `[${line.stream}] ${line.text}`).join('\n');
      downloadText(`task-${selectedTaskId || 'none'}-${stamp}.log`, text);
    } else {
      const text = serviceLines.map((line) => `[${line.at}] [${line.stream}] ${line.line}`).join('\n');
      downloadText(`service-${stamp}.log`, text);
    }
  };

  return (
    <div className="view-container logs-view">
      <div className="logs-head">
        <div>
          <h2 className="card-title">日志</h2>
          <p className="subtle">任务日志走 SSE 实时流；服务日志来自 Electron 主进程捕获的后端 stdout/stderr。</p>
        </div>
        <div className="logs-head-actions">
          <div className="logs-tabs">
            <button
              type="button"
              className={`logs-tab${mode === 'task' ? ' logs-tab-active' : ''}`}
              onClick={() => setMode('task')}
            >
              任务日志
            </button>
            <button
              type="button"
              className={`logs-tab${mode === 'service' ? ' logs-tab-active' : ''}`}
              onClick={() => setMode('service')}
            >
              服务日志
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="card" data-testid="loading-state">
          <p className="subtle">正在读取任务列表...</p>
        </div>
      )}

      {error && (
        <div className="card" data-testid="error-state" data-error-kind="logs-fetch">
          <p className="error-text">{error}</p>
        </div>
      )}

      <div className="card logs-toolbar">
        {mode === 'task' && (
          <>
            <label className="logs-task-select">
              <span className="form-label">运行中任务</span>
              <select
                className="form-input"
                value={selectedTaskId}
                onChange={(event) => setSelectedTaskId(event.target.value)}
              >
                {tasks.length === 0 ? (
                  <option value="">当前没有运行中的任务</option>
                ) : tasks.map((task) => (
                  <option key={task.taskId} value={task.taskId}>
                    {task.step || task.taskId} · {task.projectId || project} · {task.lineId || '-'}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" onClick={() => void loadTasks()}>刷新任务</button>
          </>
        )}
        <input
          className="form-input logs-filter"
          value={filter}
          placeholder="过滤关键字"
          onChange={(event) => setFilter(event.target.value)}
        />
        <button type="button" className="btn" onClick={exportLogs}>导出日志</button>
        <button type="button" className="btn" onClick={() => (mode === 'task' ? setTaskLines([]) : setServiceLines([]))}>
          清空视图
        </button>
        <span className={`logs-conn logs-conn-${connected ? 'on' : 'off'}`}>
          {mode === 'task' ? (connected ? '已连接' : '未连接') : '主进程捕获'}
        </span>
      </div>

      <div className="card logs-panel">
        {mode === 'task' ? (
          visibleTaskLines.length === 0 ? (
            <p className="subtle" data-testid="empty-state" data-empty-kind="logs-task">
              {selectedTaskId ? '等待任务输出...' : '选择一个运行中的任务后查看实时日志。'}
            </p>
          ) : (
            <div className="logs-lines">
              {visibleTaskLines.map((line, index) => (
                <div key={`${index}-${line.stream}`} className={`logs-line logs-line-${line.stream}`}>
                  <span className="logs-stream">{line.stream}</span>
                  <span className="logs-text">{line.text}</span>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )
        ) : visibleServiceLines.length === 0 ? (
          <p className="subtle" data-testid="empty-state" data-empty-kind="logs-service">暂无服务日志。</p>
        ) : (
          <div className="logs-lines">
            {visibleServiceLines.map((line, index) => (
              <div key={`${index}-${line.at}`} className={`logs-line logs-line-${line.stream}`}>
                <span className="logs-time">{line.at.slice(11, 19)}</span>
                <span className="logs-stream">{line.stream}</span>
                <span className="logs-text">{line.line}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
