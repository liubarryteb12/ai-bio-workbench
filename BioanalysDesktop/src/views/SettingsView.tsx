import { useCallback, useEffect, useState } from 'react';
import { fetchJson, errorMessage } from '../lib/fetchJson';
import { getDesktop } from '../desktop/desktop';
import type { DesktopAppInfo, DesktopConfig } from '../desktop/desktop';

type Feedback = { kind: 'ok' | 'error' | 'info'; text: string } | null;

export function SettingsView() {
  const desktop = getDesktop();
  const [config, setConfig] = useState<DesktopConfig | null>(null);
  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [testing, setTesting] = useState(false);
  const [testingSelfcheck, setTestingSelfcheck] = useState(false);

  const load = useCallback(async () => {
    if (!desktop) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextConfig, info] = await Promise.all([desktop.settings.get(), desktop.app.getInfo()]);
      setConfig(nextConfig);
      setAppInfo(info);
    } catch (cause) {
      setFeedback({ kind: 'error', text: `读取设置失败：${errorMessage(cause)}` });
    } finally {
      setLoading(false);
    }
  }, [desktop]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!desktop) {
    return (
      <div className="view-container">
        <div className="card" data-testid="empty-state" data-empty-kind="settings-web-mode">
          <h2 className="card-title">设置</h2>
          <p className="subtle">设置页只在 Windows 桌面应用中可用。当前是 Web 开发模式。</p>
        </div>
      </div>
    );
  }

  if (loading || !config) {
    return (
      <div className="view-container">
        <div className="card" data-testid="loading-state">
          <p className="subtle">正在读取桌面设置...</p>
        </div>
      </div>
    );
  }

  const updateCompute = (patch: Partial<DesktopConfig['compute']>) => {
    setConfig({ ...config, compute: { ...config.compute, ...patch } });
  };
  const updateApp = (patch: Partial<DesktopConfig['app']>) => {
    setConfig({ ...config, app: { ...config.app, ...patch } });
  };

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const result = await desktop.settings.set({
        compute: config.compute,
        app: config.app,
        storage: config.storage,
        firstRunCompleted: true,
      });
      if (result.ok) {
        setConfig(result.config);
        setFeedback({ kind: 'ok', text: '设置已保存，本地服务已按新配置重启。' });
      } else {
        setFeedback({ kind: 'error', text: `保存失败：${result.error || '服务未就绪'}` });
      }
    } catch (cause) {
      setFeedback({ kind: 'error', text: `保存失败：${errorMessage(cause)}` });
    } finally {
      setSaving(false);
    }
  };

  const chooseAdb = async () => {
    const file = await desktop.settings.chooseFile({
      title: '选择 adb.exe',
      filters: [{ name: 'adb', extensions: ['exe'] }],
    });
    if (file) updateCompute({ adbPath: file });
  };

  const chooseDataDir = async () => {
    const dir = await desktop.settings.chooseDirectory({ title: '选择数据目录' });
    if (dir) setConfig({ ...config, storage: { ...config.storage, dataDir: dir } });
  };

  const chooseRawDataDir = async () => {
    const dir = await desktop.settings.chooseDirectory({
      title: '选择原始数据存放目录（必须位于便携目录内）',
      defaultPath: appInfo ? `${appInfo.dataDir}\\raw_data` : undefined,
    });
    if (dir) setConfig({ ...config, storage: { ...config.storage, rawDataDir: dir } });
  };

  const testLink = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const payload = await fetchJson<{ overall?: string; segments?: Array<{ name?: string; pass?: boolean; detail?: string }> }>('/api/link/check');
      const segments = Array.isArray(payload?.segments) ? payload.segments : [];
      const passed = segments.filter((item) => item.pass).length;
      setFeedback({
        kind: payload?.overall === 'pass' ? 'ok' : 'info',
        text: `链路检查：${payload?.overall || 'unknown'}，通过 ${passed} / ${segments.length} 段。${segments.map((item) => `${item.name || '-'}:${item.pass ? 'OK' : 'FAIL'}`).join('，')}`,
      });
    } catch (cause) {
      setFeedback({ kind: 'error', text: `链路检查失败：${errorMessage(cause)}` });
    } finally {
      setTesting(false);
    }
  };

  const testSelfcheck = async () => {
    setTestingSelfcheck(true);
    setFeedback(null);
    try {
      const payload = await fetchJson<{ all_pass?: boolean; checks?: Array<{ name?: string; status?: string; detail?: string }> }>('/api/selfcheck');
      const checks = Array.isArray(payload?.checks) ? payload.checks : [];
      const bad = checks.filter((item) => item.status !== 'pass');
      setFeedback({
        kind: payload?.all_pass ? 'ok' : 'error',
        text: payload?.all_pass
          ? `五维自检全部通过（${checks.length} 项）。`
          : `自检存在未通过项：${bad.map((item) => `${item.name || '-'}(${item.status || '?'})`).join('，') || '无明细'}`,
      });
    } catch (cause) {
      setFeedback({ kind: 'error', text: `自检失败：${errorMessage(cause)}` });
    } finally {
      setTestingSelfcheck(false);
    }
  };

  return (
    <div className="view-container settings-view">
      <div className="settings-head">
        <div>
          <h2 className="card-title">设置</h2>
          <p className="subtle">修改算力连接或数据目录后，本地服务会自动重启；界面会重新加载。</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>

      {feedback?.kind === 'error' ? (
        <div
          className="settings-feedback settings-feedback-error"
          role="alert"
          data-testid="error-state"
          data-error-kind="settings-action"
        >
          {feedback.text}
        </div>
      ) : feedback ? (
        <div className={`settings-feedback settings-feedback-${feedback.kind}`} role="status">
          {feedback.text}
        </div>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h3 className="card-title">算力连接</h3>
          <span className="subtle">本地零算力，计算经 ADB 下沉到算力节点</span>
        </div>
        <div className="settings-grid">
          <label className="settings-field">
            <span className="form-label">适配器</span>
            <select
              className="form-input"
              value={config.compute.adapter}
              onChange={(event) => updateCompute({ adapter: event.target.value as 'adb' | 'mock' })}
            >
              <option value="adb">ADB 单通道（生产）</option>
              <option value="mock">离线演示（不连真机）</option>
            </select>
          </label>
          <label className="settings-field">
            <span className="form-label">设备序列号</span>
            <input
              className="form-input"
              value={config.compute.serial}
              placeholder="留空时使用当前唯一在线设备"
              onChange={(event) => updateCompute({ serial: event.target.value })}
            />
          </label>
          <label className="settings-field settings-field-wide">
            <span className="form-label">adb.exe 路径</span>
            <div className="settings-inline">
              <input
                className="form-input"
                value={config.compute.adbPath}
                placeholder="留空时使用随包 platform-tools"
                onChange={(event) => updateCompute({ adbPath: event.target.value })}
              />
              <button type="button" className="btn" onClick={() => void chooseAdb()}>选择</button>
            </div>
          </label>
          <label className="settings-field">
            <span className="form-label">远端数据根</span>
            <input
              className="form-input"
              value={config.compute.remoteDataRoot}
              placeholder="/mnt/ssd/bio_data"
              onChange={(event) => updateCompute({ remoteDataRoot: event.target.value })}
            />
          </label>
          <label className="settings-field">
            <span className="form-label">远端用户空间</span>
            <input
              className="form-input"
              value={config.compute.remoteHome}
              placeholder="留空使用适配器默认值"
              onChange={(event) => updateCompute({ remoteHome: event.target.value })}
            />
          </label>
          <label className="settings-field">
            <span className="form-label">容器名</span>
            <input
              className="form-input"
              value={config.compute.containerName}
              placeholder="ubuntu"
              onChange={(event) => updateCompute({ containerName: event.target.value })}
            />
          </label>
          <label className="settings-field">
            <span className="form-label">单任务内存上限（GB）</span>
            <input
              className="form-input"
              type="number"
              min={1}
              max={8}
              step={0.5}
              value={config.compute.memLimitGb}
              onChange={(event) => updateCompute({ memLimitGb: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className="settings-actions">
          <button type="button" className="btn" disabled={testing} onClick={() => void testLink()}>
            {testing ? '检查中...' : '测试连接'}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 className="card-title">数据与存储</h3>
          <span className="subtle">项目数据、上传暂存、租约库与日志都落在这里</span>
        </div>
        <div className="settings-field settings-field-wide">
          <span className="form-label">数据目录</span>
          <div className="settings-inline">
            <input
              className="form-input"
              value={config.storage.dataDir}
              placeholder={appInfo?.dataDir || '默认使用用户数据目录'}
              onChange={(event) => setConfig({ ...config, storage: { ...config.storage, dataDir: event.target.value } })}
            />
            <button type="button" className="btn" onClick={() => void chooseDataDir()}>选择</button>
            <button type="button" className="btn" onClick={() => void desktop.settings.openDataDir()}>打开</button>
          </div>
          <span className="subtle">留空使用 {appInfo?.dataDir || '便携目录\\data'}。</span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 className="card-title">原始数据存放目录</h3>
          <span className="subtle">仅限便携目录内，不得放在根目录，保持根目录整洁</span>
        </div>
        <div className="settings-field settings-field-wide">
          <span className="form-label">原始数据目录</span>
          <div className="settings-inline">
            <input
              className="form-input"
              value={config.storage.rawDataDir}
              placeholder={`${appInfo?.dataDir || 'data'}\\raw_data`}
              onChange={(event) => setConfig({ ...config, storage: { ...config.storage, rawDataDir: event.target.value } })}
            />
            <button type="button" className="btn" onClick={() => void chooseRawDataDir()}>选择</button>
          </div>
          <span className="subtle">留空使用 {appInfo?.dataDir || 'data'}\raw_data。上传的原始数据文件都落在这个目录。</span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 className="card-title">应用行为</h3>
        </div>
        <div className="settings-grid">
          <label className="settings-field">
            <span className="form-label">关闭窗口时</span>
            <select
              className="form-input"
              value={config.app.closeAction}
              onChange={(event) => updateApp({ closeAction: event.target.value as 'tray' | 'quit' })}
            >
              <option value="tray">最小化到托盘</option>
              <option value="quit">退出应用</option>
            </select>
          </label>
          <label className="settings-field">
            <span className="form-label">主题</span>
            <select
              className="form-input"
              value={config.app.theme}
              onChange={(event) => updateApp({ theme: event.target.value as 'system' | 'light' | 'dark' })}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <label className="settings-field settings-check">
            <input
              type="checkbox"
              checked={config.app.launchAtLogin}
              onChange={(event) => updateApp({ launchAtLogin: event.target.checked })}
            />
            <span>开机自动启动</span>
          </label>
          <label className="settings-field settings-check">
            <input
              type="checkbox"
              checked={config.app.notifications}
              onChange={(event) => updateApp({ notifications: event.target.checked })}
            />
            <span>任务完成时发送系统通知</span>
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 className="card-title">诊断</h3>
        </div>
        <div className="settings-actions">
          <button type="button" className="btn" disabled={testingSelfcheck} onClick={() => void testSelfcheck()}>
            {testingSelfcheck ? '自检中...' : '运行五维自检'}
          </button>
          <button type="button" className="btn" onClick={() => void desktop.logs.openFolder()}>打开日志目录</button>
          <button type="button" className="btn" onClick={() => void desktop.service.restart()}>重启服务</button>
        </div>
        <p className="subtle" style={{ marginTop: 10 }}>
          日志目录：{appInfo?.logsDir || '-'}
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 className="card-title">关于</h3>
        </div>
        <p className="subtle">
          Bioanalys 工作台 {appInfo?.version || '-'}，Electron {appInfo?.electron || '-'}，平台 {appInfo?.platform || '-'}。
        </p>
        <p className="subtle">
          本地只做交互与控制，不在本机启动 R 或 Python 分析代码。报告导出仍走既有脱敏契约。
        </p>
      </section>
    </div>
  );
}
