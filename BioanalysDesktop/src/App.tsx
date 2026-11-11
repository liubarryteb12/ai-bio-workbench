import { useEffect, useState, useCallback, useRef } from 'react';
import './app.css';

import { projectDisplayName } from './views/shared/helpers';
import type { ProjectEntry, ProjectsResponse } from './views/shared/types';
import { fetchJson, errorMessage } from './lib/fetchJson';
import { ViewErrorBoundary } from './components/ViewErrorBoundary';
import { ResultPreviewStudio } from './views/ResultStudioView';
import { PreFlightDashboard } from './views/SelfCheckAdminView';
import { OnboardingPortal, CustomerInputConsole } from './views/OnboardingView';
import { WorkOrderCenterView } from './views/WorkOrderCenterView';

// ============================================================
// 视图枚举
// ============================================================

type ViewKey = 'onboarding' | 'console' | 'work-orders' | 'preflight' | 'studio';

const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: 'onboarding', label: '新建项目向导' },
  { key: 'console', label: '分析输入控制台' },
  { key: 'work-orders', label: '作业中心' },
  { key: 'preflight', label: '五维自检' },
  { key: 'studio', label: '结果预览 Studio' },
];

const VIEW_LABELS: Record<ViewKey, string> = VIEWS.reduce(
  (acc, item) => ({ ...acc, [item.key]: item.label }),
  {} as Record<ViewKey, string>,
);

// ============================================================
// App 主组件
// ============================================================

export function App() {
  const [view, setView] = useState<ViewKey>('onboarding');
  const [project, setProject] = useState<string>('default');
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [projectError, setProjectError] = useState<string | null>(null);
  // 计算面模式：'adb' 单通道，'mock' 离线演示。SSH 通道已封存。
  // 只用于顶部提示，不阻塞任何交互；拿不到按 ADB 主通道处理。
  const [computeMode, setComputeMode] = useState<'adb' | 'mock'>('adb');
  // ErrorBoundary 重试计数：递增即让失败视图换 key 重新挂载
  const [retryTick, setRetryTick] = useState(0);
  const projectInit = useRef(false);
  const lastProjectsRefresh = useRef(0);

  const refreshProjects = useCallback(async () => {
    try {
      const payload = await fetchJson<ProjectsResponse>('/api/projects/list');
      // 成功必须清错误：否则一次失败后横幅永久常驻（FE-03）
      setProjectError(null);
      // 契约漂移（缺 projects 数组）不许把 undefined 塞进 state：
      // 渲染期 projects.length 会抛 TypeError，而那已经是 ErrorBoundary 之外
      const list = Array.isArray(payload?.projects) ? payload.projects : [];
      setProjects(list);
      setProject((prev) => {
        if (!projectInit.current) {
          projectInit.current = true;
          return payload?.defaultProject || 'default';
        }
        if (list.some((item) => item.projectId === prev)) return prev;
        return payload?.defaultProject || 'default';
      });
    } catch (cause) {
      setProjectError(errorMessage(cause));
    }
  }, []);

  // 项目列表只在挂载时拉一次会长期停留在旧快照：项目可能在别处新增
  // （用户端提交后由工作台建项、另一个标签页建项），切视图/回到本页时必须重拉，
  // 否则选择器里只剩当时存在的 default（2026-10-19 实测踩到）。
  // 切视图时不再无条件重拉：项目列表是同步 SSH 端点，每次切页都拉会阻塞
  // 事件循环近 10 秒，连带把 Pi 监控/对话的轮询一起拖成假死。
  // 保留新鲜度的做法是 30 秒节流；焦点/可见性变化仍会立即刷新。
  useEffect(() => {
    if (Date.now() - lastProjectsRefresh.current < 30000) return;
    lastProjectsRefresh.current = Date.now();
    void refreshProjects();
  }, [view, refreshProjects]);

  useEffect(() => {
    const reload = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastProjectsRefresh.current < 30000) return;
      lastProjectsRefresh.current = Date.now();
      void refreshProjects();
    };
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', reload);
    return () => {
      window.removeEventListener('focus', reload);
      document.removeEventListener('visibilitychange', reload);
    };
  }, [refreshProjects]);

  // 计算面模式读取：/api/selfcheck 显式透出 compute_mode（第二十二轮 Q5 Ticket 1）。
  // 读失败不影响使用；只在明确 mock 时提示，把「没有真机」摆到明面上，
  // 而不是让用户在 mock 绿灯下误以为真机验过了。
  //
  // 这个 effect 必须与上一个平级：2026-11 审查发现它曾被嵌进上一个 effect 的清理
  // 函数体内，结果是首页挂载时根本不会请求 /api/selfcheck，而卸载时会在清理函数里
  // 调 hooks 触发 Invalid hook call。
  useEffect(() => {
    if (view !== 'preflight') return undefined;
    let alive = true;
    const loadMode = async () => {
      try {
        const response = await fetch('/api/selfcheck');
        if (!response.ok) return;
        const payload = (await response.json()) as { compute_mode?: string };
        if (!alive) return;
        setComputeMode(payload.compute_mode === 'mock' ? 'mock' : 'adb');
      } catch {
        // 静默：模式读取失败不该变成新的错误来源
      }
    };
    void loadMode();
    const onVisible = () => { if (document.visibilityState === 'visible') void loadMode(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [view]);

  const retryFailedView = useCallback(() => {
    setRetryTick((n) => n + 1);
  }, []);

  return (
    <div className="app-root">
      <header className="app-header">
        <h1 className="app-title">BioanalysDesktop</h1>
        <div className="app-header-sep" />
        <nav className="tab-nav">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className={`tab-nav-item${view === v.key ? ' tab-nav-item-active' : ''}`}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <div className="project-selector-wrap">
          <span className="project-selector-label">当前项目</span>
          <select
            className="project-selector"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            {projects.length === 0 ? (
              <option value={project}>{project}</option>
            ) : projects.map((item) => (
              <option key={item.projectId} value={item.projectId}>
                {projectDisplayName(item)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            style={{ marginLeft: 8, padding: '4px 10px', fontSize: 12 }}
            onClick={() => void refreshProjects()}
            title="重新读取项目列表"
          >
            刷新
          </button>
        </div>
      </header>

      {/* Ticket 1：离线演示横幅（compute_mode=mock 时显式提示） */}
      {computeMode === 'mock' && (
        <div className="mock-banner" role="status">
          <strong>离线演示模式</strong>
          <span>
            当前未连接真机（BIO_COMPUTE_ADAPTER=mock）。下方自检绿灯与任务结果均为演示数据，
            不代表真机运行；需要真实算力时请先连上 K40 后重试。
          </span>
        </div>
      )}

      {projectError && (
        <div className="card" style={{ margin: 16 }}>
          <p className="error-text">项目列表错误：{projectError}</p>
        </div>
      )}

      {/* 每个 tab 视图各包一层：一个视图渲染失败只降级这一块，外壳与其他视图照常可用 */}
      <ViewErrorBoundary
        key={view + '-' + retryTick}
        viewName={VIEW_LABELS[view]}
        onRetry={retryFailedView}
      >
        {view === 'onboarding' && <OnboardingPortal onCreated={refreshProjects} onProjectSet={setProject} />}
        {view === 'console' && <CustomerInputConsole project={project} />}
        {view === 'work-orders' && <WorkOrderCenterView project={project} />}
        {view === 'preflight' && <PreFlightDashboard />}
        {view === 'studio' && <ResultPreviewStudio project={project} />}
      </ViewErrorBoundary>
    </div>
  );
}
