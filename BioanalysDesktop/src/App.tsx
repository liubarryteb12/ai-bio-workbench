import { useEffect, useState, useCallback, useRef } from 'react';
import './app.css';

import { projectDisplayName } from './views/shared/helpers';
import type { ProjectEntry, ProjectsResponse } from './views/shared/types';
import { ResultPreviewStudio } from './views/ResultStudioView';
import { PreFlightDashboard } from './views/SelfCheckAdminView';
import { OnboardingPortal, CustomerInputConsole } from './views/OnboardingView';
import { PiAgentMonitor } from './views/PiAgentView';
import { PiAgentChat } from './PiAgentChat';

// ============================================================
// 视图枚举
// ============================================================

type ViewKey = 'onboarding' | 'console' | 'preflight' | 'studio' | 'pi-agent' | 'pi-chat';

const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: 'onboarding', label: '新建项目向导' },
  { key: 'console', label: '分析输入控制台' },
  { key: 'preflight', label: '五维自检' },
  { key: 'studio', label: '结果预览 Studio' },
  { key: 'pi-agent', label: 'Pi Agent 监控' },
  { key: 'pi-chat', label: 'Pi Agent 对话' },
];

// ============================================================
// App 主组件
// ============================================================

export function App() {
  const [view, setView] = useState<ViewKey>('onboarding');
  const [project, setProject] = useState<string>('default');
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [projectError, setProjectError] = useState<string | null>(null);
  const projectInit = useRef(false);

  const refreshProjects = useCallback(async () => {
    try {
      const response = await fetch('/api/projects/list');
      const payload = (await response.json()) as ProjectsResponse;
      setProjects(payload.projects);
      setProject((prev) => {
        if (!projectInit.current) {
          projectInit.current = true;
          return payload.defaultProject || 'default';
        }
        if (payload.projects.some((item) => item.projectId === prev)) return prev;
        return payload.defaultProject || 'default';
      });
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  // 项目列表只在挂载时拉一次会长期停留在旧快照：项目可能在别处新增
  // （用户端提交后由工作台建项、另一个标签页建项），切视图/回到本页时必须重拉，
  // 否则选择器里只剩当时存在的 default（2026-10-19 实测踩到）。
  useEffect(() => {
    void refreshProjects();
  }, [view, refreshProjects]);

  useEffect(() => {
    const reload = () => {
      if (document.visibilityState === 'visible') void refreshProjects();
    };
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', reload);
    return () => {
      window.removeEventListener('focus', reload);
      document.removeEventListener('visibilitychange', reload);
    };
  }, [refreshProjects]);

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

      {projectError && (
        <div className="card" style={{ margin: 16 }}>
          <p className="error-text">项目列表错误：{projectError}</p>
        </div>
      )}

      {view === 'onboarding' && <OnboardingPortal onCreated={refreshProjects} onProjectSet={setProject} />}
      {view === 'console' && <CustomerInputConsole project={project} />}
      {view === 'preflight' && <PreFlightDashboard />}
      {view === 'studio' && <ResultPreviewStudio project={project} />}
      {view === 'pi-agent' && <PiAgentMonitor />}
      {view === 'pi-chat' && <PiAgentChat />}
    </div>
  );
}
