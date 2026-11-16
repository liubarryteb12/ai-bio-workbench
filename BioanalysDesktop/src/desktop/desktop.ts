/**
 * 桌面桥接类型与访问器。
 *
 * Web 开发模式没有 window.bioanlysDesktop，调用方必须按 null 分支降级。
 */
export type DesktopConfig = {
  version: number;
  firstRunCompleted: boolean;
  compute: {
    adapter: 'adb' | 'mock';
    adbPath: string;
    serial: string;
    remoteDataRoot: string;
    remoteHome: string;
    containerName: string;
    memLimitGb: number;
  };
  app: {
    closeAction: 'tray' | 'quit';
    launchAtLogin: boolean;
    theme: 'system' | 'light' | 'dark';
    notifications: boolean;
  };
  storage: { dataDir: string; rawDataDir: string };
};

export type DesktopServiceStatus = {
  state: 'stopped' | 'starting' | 'ready' | 'failed';
  port: number;
  pid: number | null;
  startedAt: number | null;
  lastError: string;
  uptimeMs: number;
};

export type DesktopLogEntry = {
  at: string;
  stream: string;
  line: string;
};

export type DesktopAppInfo = {
  version: string;
  electron: string;
  platform: string;
  dataDir: string;
  logsDir: string;
  dev: boolean;
};

export type DesktopApi = {
  isDesktop: true;
  app: {
    getInfo: () => Promise<DesktopAppInfo>;
    getVersion: () => Promise<string>;
  };
  service: {
    status: () => Promise<DesktopServiceStatus>;
    restart: () => Promise<DesktopServiceStatus>;
    onStatus: (callback: (status: DesktopServiceStatus) => void) => () => void;
  };
  settings: {
    get: () => Promise<DesktopConfig>;
    set: (patch: Partial<DesktopConfig>) => Promise<{
      ok: boolean;
      error?: string;
      config: DesktopConfig;
      status?: DesktopServiceStatus;
    }>;
    isConfigured: () => Promise<boolean>;
    dataDir: () => Promise<string>;
    openDataDir: () => Promise<string>;
    chooseDirectory: (options?: { title?: string; defaultPath?: string }) => Promise<string>;
    chooseFile: (options?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string>;
  };
  shell: {
    openPath: (target: string) => Promise<string>;
    showItemInFolder: (target: string) => Promise<boolean>;
  };
  logs: {
    recent: () => Promise<DesktopLogEntry[]>;
    openFolder: () => Promise<string>;
    onLine: (callback: (entry: DesktopLogEntry) => void) => () => void;
  };
};

declare global {
  interface Window {
    bioanlysDesktop?: DesktopApi;
  }
}

export function getDesktop(): DesktopApi | null {
  if (typeof window === 'undefined') return null;
  return window.bioanlysDesktop ?? null;
}

export function serviceStateLabel(state?: string): string {
  if (state === 'ready') return '服务正常';
  if (state === 'starting') return '服务启动中';
  if (state === 'failed') return '服务异常';
  if (state === 'stopped') return '服务已停止';
  return '服务未知';
}
