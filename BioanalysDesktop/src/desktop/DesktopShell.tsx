import type { ReactNode } from 'react';
import type { DesktopAppInfo, DesktopServiceStatus } from './desktop';
import { serviceStateLabel } from './desktop';

export type DesktopNavItem = { key: string; label: string };

type Props = {
  items: DesktopNavItem[];
  active: string;
  onSelect: (key: string) => void;
  title: string;
  service: DesktopServiceStatus | null;
  appInfo: DesktopAppInfo | null;
  projectSelector: ReactNode;
  children: ReactNode;
};

export function DesktopShell({
  items, active, onSelect, title, service, appInfo, projectSelector, children,
}: Props) {
  const state = service?.state || 'starting';
  return (
    <div className="desktop-root">
      <aside className="desktop-sidebar">
        <div className="desktop-brand">
          <span className="desktop-brand-mark">B</span>
          <span className="desktop-brand-text">
            <strong>Bioanalys</strong>
            <small>生信分析工作台</small>
          </span>
        </div>
        <nav className="desktop-nav">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`desktop-nav-item${active === item.key ? ' desktop-nav-item-active' : ''}`}
              onClick={() => onSelect(item.key)}
            >
              <span className="desktop-nav-dot" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="desktop-sidebar-foot">
          <div className={`desktop-service desktop-service-${state}`}>
            <span className="desktop-service-dot" />
            {serviceStateLabel(state)}
          </div>
          <div className="desktop-version">版本 {appInfo?.version || '0.1.0'}</div>
        </div>
      </aside>

      <div className="desktop-main">
        <header className="desktop-topbar">
          <div className="desktop-topbar-title">{title}</div>
          <div className="desktop-topbar-spacer" />
          {projectSelector}
          <button
            type="button"
            className="btn"
            onClick={() => window.bioanlysDesktop?.settings.openDataDir()}
            title="打开数据目录"
          >
            数据目录
          </button>
        </header>

        <main className="desktop-content">
          {service?.state === 'failed' && (
            <div className="desktop-service-banner" role="alert">
              <strong>本地服务未就绪：</strong>
              <span>{service.lastError || '后端进程异常退出'}</span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void window.bioanlysDesktop?.service.restart()}
              >
                重启服务
              </button>
            </div>
          )}
          {children}
        </main>

        <footer className="desktop-statusbar">
          <span>{appInfo?.dataDir || '数据目录加载中'}</span>
          <span className="desktop-statusbar-sep" />
          <span>{service?.state === 'ready' ? `本地端口 ${service.port}` : '本地服务未连接'}</span>
          <span className="desktop-statusbar-spacer" />
          <span>Electron {appInfo?.electron || '-'}</span>
        </footer>
      </div>
    </div>
  );
}
