import { useCallback, useEffect, useState } from 'react';
import { fetchJson, errorMessage } from '../lib/fetchJson';
import { getDesktop } from '../desktop/desktop';
import type { DesktopServiceStatus } from '../desktop/desktop';
import type { ProjectsResponse } from './shared/types';

type DashboardProps = {
  project: string;
  onNavigate: (key: string) => void;
  onRefreshProjects: () => void;
};

type RunningTask = { taskId: string; projectId?: string; lineId?: string; step?: string; startedAt?: string };
type SelfCheckItem = { name?: string; status?: string; detail?: string };

export function DashboardView({ project, onNavigate, onRefreshProjects }: DashboardProps) {
  const desktop = getDesktop();
  const [service, setService] = useState<DesktopServiceStatus | null>(null);
  const [serviceState, setServiceState] = useState<'ok' | 'down' | 'checking'>('checking');
  const [selfcheck, setSelfcheck] = useState<{ all_pass?: boolean; checks?: SelfCheckItem[]; compute_mode?: string } | null>(null);
  const [projectCount, setProjectCount] = useState<number | null>(null);
  const [tasks, setTasks] = useState<RunningTask[]>([]);
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [firstRun, setFirstRun] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);

  const load = useCallback(async () => {
    const problems: string[] = [];
    // 真机口径：projects/list 会在容器里逐项目读元数据（单次可跑 10 秒以上），
    // 且服务端该处理体是同步 ADB 调用，会短暂阻塞事件循环拖慢同批其余请求。
    // 首页超时给到 45 秒，宁慢勿假红。
    const remoteTimeout = { signal: AbortSignal.timeout(45000) };
    const localTimeout = { signal: AbortSignal.timeout(8000) };
    const results = await Promise.allSettled([
      fetchJson<{ ok?: boolean }>('/api/health', localTimeout),
      fetchJson<{ all_pass?: boolean; checks?: SelfCheckItem[]; compute_mode?: string }>('/api/selfcheck', remoteTimeout),
      fetchJson<ProjectsResponse>('/api/projects/list', remoteTimeout),
      fetchJson<{ tasks?: RunningTask[] }>('/api/tasks', remoteTimeout),
      fetchJson<{ queue?: Array<unknown> }>('/api/work-orders/queue', remoteTimeout),
    ]);
    setServiceState(results[0].status === 'fulfilled' ? 'ok' : 'down');
    if (results[0].status === 'rejected') problems.push(`健康检查：${errorMessage(results[0].reason)}`);
    if (results[1].status === 'fulfilled') {
      const payload = results[1].value;
      setSelfcheck({ ...payload, checks: Array.isArray(payload?.checks) ? payload.checks : [] });
    } else {
      problems.push(`自检：${errorMessage(results[1].reason)}`);
    }
    if (results[2].status === 'fulfilled') {
      setProjectCount(Array.isArray(results[2].value?.projects) ? results[2].value.projects.length : 0);
    } else {
      problems.push(`项目列表：${errorMessage(results[2].reason)}`);
    }
    if (results[3].status === 'fulfilled') {
      setTasks(Array.isArray(results[3].value?.tasks) ? results[3].value.tasks : []);
    } else {
      problems.push(`任务列表：${errorMessage(results[3].reason)}`);
    }
    if (results[4].status === 'fulfilled') {
      setQueueCount(Array.isArray(results[4].value?.queue) ? results[4].value.queue.length : 0);
    } else {
      problems.push(`作业队列：${errorMessage(results[4].reason)}`);
    }
    setErrors(problems);
    if (desktop) {
      try {
        setService(await desktop.service.status());
        setFirstRun(!(await desktop.settings.isConfigured()));
      } catch {
        // 桌面桥接读取失败不阻塞页面
      }
    }
    setInitialLoading(false);
  }, [desktop]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15000);
    const unsubscribe = desktop?.service.onStatus((status) => setService(status));
    return () => {
      window.clearInterval(timer);
      unsubscribe?.();
    };
  }, [desktop, load]);

  const healthyChecks = selfcheck?.checks?.filter((item) => item.status === 'pass').length ?? 0;
  const totalChecks = selfcheck?.checks?.length ?? 0;
  const computeMode = selfcheck?.compute_mode === 'mock' ? '演示模式' : 'ADB 单通道';

  if (initialLoading) {
    return (
      <div className="view-container">
        <div className="card" data-testid="loading-state">
          <p className="subtle">正在读取工作台状态...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view-container dashboard-view">
      <div className="dashboard-hero">
        <div>
          <h2 className="dashboard-hero-title">工作台总览</h2>
          <p className="dashboard-hero-sub">
            当前项目 <strong>{project}</strong>。本地只做交互与控制，计算经 ADB 下沉到算力节点。
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void load()}>
          刷新状态
        </button>
      </div>

      {firstRun && (
        <div className="card dashboard-first-run">
          <div>
            <strong>首次使用</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              先去设置页确认算力连接与数据目录。没有算力节点时可以切到演示模式先走通界面流程。
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => onNavigate('settings')}>
            去设置
          </button>
        </div>
      )}

      {errors.length > 0 && (
        <div className="card dashboard-errors" data-testid="error-state" data-error-kind="dashboard-fetch">
          <strong>部分状态读取失败</strong>
          <ul>
            {errors.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      <div className="dashboard-grid">
        <section className="card dashboard-card">
          <div className="dashboard-card-label">本地服务</div>
          <div className="dashboard-card-value">
            {serviceState === 'ok' ? '正常' : serviceState === 'checking' ? '检查中' : '不可用'}
          </div>
          <div className="subtle">
            {service?.state === 'ready' ? `端口 ${service.port}` : (service?.lastError || '等待后端就绪')}
          </div>
        </section>
        <section className="card dashboard-card">
          <div className="dashboard-card-label">算力链路</div>
          <div className="dashboard-card-value">{computeMode}</div>
          <div className="subtle">
            {totalChecks > 0 ? `自检通过 ${healthyChecks} / ${totalChecks}` : '自检结果读取中'}
          </div>
        </section>
        <section className="card dashboard-card">
          <div className="dashboard-card-label">项目</div>
          <div className="dashboard-card-value">{projectCount ?? '-'}</div>
          <div className="subtle">本地与远端合并后的项目数</div>
        </section>
        <section className="card dashboard-card">
          <div className="dashboard-card-label">运行中任务</div>
          <div className="dashboard-card-value">{tasks.length}</div>
          <div className="subtle">已入队 {queueCount ?? '-'} 个作业</div>
        </section>
      </div>

      <div className="dashboard-columns">
        <section className="card">
          <div className="card-head">
            <h3 className="card-title">快捷入口</h3>
          </div>
          <div className="dashboard-actions">
            <button type="button" className="btn" onClick={() => onNavigate('onboarding')}>新建项目</button>
            <button type="button" className="btn" onClick={() => onNavigate('console')}>导入数据</button>
            <button type="button" className="btn" onClick={() => onNavigate('work-orders')}>下发任务</button>
            <button type="button" className="btn" onClick={() => onNavigate('studio')}>查看结果</button>
            <button type="button" className="btn" onClick={() => onNavigate('logs')}>查看日志</button>
            <button type="button" className="btn" onClick={() => { void load(); onRefreshProjects(); }}>刷新项目</button>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3 className="card-title">运行中任务</h3>
            <span className="subtle">{tasks.length} 个</span>
          </div>
          {tasks.length === 0 ? (
            <p className="subtle" data-testid="empty-state" data-empty-kind="dashboard-tasks">
              当前没有运行中的任务。
            </p>
          ) : (
            <ul className="dashboard-task-list">
              {tasks.slice(0, 6).map((task) => (
                <li key={task.taskId}>
                  <strong>{task.step || task.taskId}</strong>
                  <span className="subtle">{task.projectId || project} · {task.lineId || '-'}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn" onClick={() => onNavigate('logs')}>打开实时日志</button>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h3 className="card-title">自检明细</h3>
          <span className="subtle">五维自检与链路状态</span>
        </div>
        {totalChecks === 0 ? (
          <p className="subtle">自检结果尚未返回。</p>
        ) : (
          <div className="dashboard-check-grid">
            {selfcheck?.checks?.map((check, index) => (
              <div key={`${check.name || 'check'}-${index}`} className={`dashboard-check dashboard-check-${check.status || 'unknown'}`}>
                <strong>{check.name || `检查项 ${index + 1}`}</strong>
                <span>{check.status || 'unknown'}</span>
                {check.detail && <small>{check.detail}</small>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
