/**
 * Bioanalys 工作台桌面主进程。
 *
 * 职责：单实例、窗口、托盘、原生菜单、设置存储、后端守护、受限 IPC。
 * 渲染层只看到 http://127.0.0.1:<port> 的本机界面，看不到终端与浏览器地址栏。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, nativeTheme, shell, session,
} from 'electron';

import { createBackend } from './backend.js';
import {
  applyConfigPatch, defaultConfig, ensureDataDirs, loadConfig, resolveDataDir, resolveRawDataDir, writeConfig,
} from './config.js';
import {
  computePortableRoot, migrateLegacyAppData, portableDataRoot, venvPython,
  validateRawDataDir,
} from './portable-paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, '..', '..');
const DEV_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const IS_DEV = process.argv.includes('--dev');
const IS_SMOKE = process.argv.includes('--smoke-test');
const APP_FILE_ROOT = pathToFileURL(__dirname).href;

let mainWindow = null;
let tray = null;
let backend = null;
let currentConfig = defaultConfig();
let currentDataDir = '';
let logsDir = '';
let backendOrigin = '';
let isQuitting = false;
let quittingInProgress = false;
let statusErrorShown = false;
let backendRestartInProgress = false;
let portableRoot = '';

app.setAppUserModelId('local.bioanalys.workbench');
app.setName('BioanalysWorkbench');

// 便携形态路径裁定：userData 跟着 exe 所在目录走（<portable>\data）。
// 必须在 app ready 前设置，Chromium 缓存与 GPU 目录才会一并收进 data\。
portableRoot = computePortableRoot(app);
if (app.isPackaged) {
  app.setPath('userData', portableDataRoot(portableRoot));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function showErrorPage(message) {
  if (!mainWindow) return;
  const target = pathToFileURL(path.join(__dirname, 'error.html'));
  mainWindow.loadURL(`${target.href}?message=${encodeURIComponent(message)}`);
}

function showLoadingPage() {
  if (!mainWindow) return;
  const target = pathToFileURL(path.join(__dirname, 'loading.html'));
  mainWindow.loadURL(target.href);
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    title: 'Bioanalys 工作台',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (!IS_SMOKE) mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    if (currentConfig.app.closeAction === 'tray') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(APP_FILE_ROOT)) return;
    if (!backendOrigin) return;
    if (url.startsWith(backendOrigin)) return;
    if (/^https?:\/\//i.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
      return;
    }
    event.preventDefault();
  });

  showLoadingPage();
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开数据目录',
          click: () => shell.openPath(currentDataDir),
        },
        {
          label: '打开日志目录',
          click: () => shell.openPath(logsDir),
        },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '查看',
      submenu: [
        { label: '重新加载', role: 'reload' },
        ...(IS_DEV ? [{ label: '开发者工具', role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 Bioanalys 工作台',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于',
              message: `Bioanalys 工作台 ${app.getVersion()}`,
              detail: `本地交互层，零本地算力。\n数据目录：${currentDataDir}`,
              buttons: ['确定'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const iconPath = path.join(DESKTOP_ROOT, 'assets', 'icon.png');
  if (!fs.existsSync(iconPath)) return;
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return;
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip('Bioanalys 工作台');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '显示工作台',
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: '重启服务',
      click: async () => {
        await backend?.restart();
        if (mainWindow) await loadWorkbench();
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });
}

async function loadWorkbench() {
  const status = backend.getStatus();
  if (status.state !== 'ready') {
    showErrorPage(status.lastError || '后端服务未就绪');
    return false;
  }
  backendOrigin = `http://127.0.0.1:${status.port}`;
  await mainWindow.loadURL(`${backendOrigin}/`);
  return true;
}

async function restartBackendAndLoad() {
  backendRestartInProgress = true;
  try {
    const status = await backend.restart();
    if (status.state === 'ready') {
      backendOrigin = `http://127.0.0.1:${status.port}`;
      await loadWorkbench();
    }
    return status;
  } finally {
    backendRestartInProgress = false;
  }
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    dataDir: currentDataDir,
    logsDir,
    dev: IS_DEV,
  }));
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('service:status', () => backend.getStatus());
  ipcMain.handle('service:restart', () => restartBackendAndLoad());

  ipcMain.handle('settings:get', () => currentConfig);
  ipcMain.handle('settings:isConfigured', () => currentConfig.firstRunCompleted === true);
  ipcMain.handle('settings:dataDir', () => currentDataDir);
  ipcMain.handle('settings:openDataDir', () => shell.openPath(currentDataDir));
  ipcMain.handle('settings:set', async (_event, patch) => {
    const applied = applyConfigPatch(currentConfig, patch);
    const rawCheck = validateRawDataDir(applied.config.storage.rawDataDir, portableRoot);
    if (!rawCheck.ok) return { ok: false, error: rawCheck.reason, config: currentConfig };
    if (!applied.ok) return { ok: false, error: applied.error, config: currentConfig };
    currentConfig = applied.config;
    writeConfig(currentConfig);
    currentDataDir = resolveDataDir(currentConfig);
    ensureDataDirs(currentDataDir);
    nativeTheme.themeSource = currentConfig.app.theme;
    app.setLoginItemSettings({ openAtLogin: currentConfig.app.launchAtLogin });
    const needsRestart = Boolean(patch.compute || patch.storage);
    const status = needsRestart ? await restartBackendAndLoad() : backend.getStatus();
    return {
      ok: status.state === 'ready',
      error: status.state === 'ready' ? '' : (status.lastError || '服务未就绪'),
      config: currentConfig,
      status,
    };
  });

  ipcMain.handle('dialog:chooseDirectory', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || '选择目录',
      defaultPath: options.defaultPath || currentDataDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('dialog:chooseFile', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || '选择文件',
      defaultPath: options.defaultPath || currentDataDir,
      properties: ['openFile'],
      filters: Array.isArray(options.filters) ? options.filters : undefined,
    });
    return result.canceled ? '' : result.filePaths[0];
  });

  ipcMain.handle('shell:openPath', async (_event, target) => {
    const text = String(target || '');
    if (!text || !path.isAbsolute(text) || !fs.existsSync(text)) return '路径不存在';
    return shell.openPath(text);
  });
  ipcMain.handle('shell:showItemInFolder', (_event, target) => {
    const text = String(target || '');
    if (!text || !path.isAbsolute(text) || !fs.existsSync(text)) return false;
    shell.showItemInFolder(text);
    return true;
  });

  ipcMain.handle('logs:recent', () => backend.getRecentLogs());
  ipcMain.handle('logs:openFolder', () => shell.openPath(logsDir));
}

async function bootstrap() {
  const migration = migrateLegacyAppData(app, portableRoot);
  if (migration.migrated) {
    console.log(`[portable] 迁移旧安装版数据: ${migration.moved.join(', ') || '无'}`);
  }
  currentConfig = loadConfig();
  currentDataDir = currentConfig.storage.dataDir
    ? resolveDataDir(currentConfig)
    : (app.isPackaged ? portableDataRoot(portableRoot) : portableRoot);
  // 便携首跑即持久化默认配置，后续设置改动以此为基线。
  if (!fs.existsSync(path.join(app.getPath('userData'), 'config.json'))) {
    writeConfig(currentConfig);
  }
  ensureDataDirs(currentDataDir);
  logsDir = path.join(currentDataDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  nativeTheme.themeSource = currentConfig.app.theme;
  app.setLoginItemSettings({ openAtLogin: currentConfig.app.launchAtLogin });

  backend = createBackend({
    app,
    loadConfig,
    resolveDataDir: () => currentDataDir,
    resolveRawDataDir: () => resolveRawDataDir(loadConfig(), portableRoot).dir,
    portableRoot,
    logsDir,
    devRepoRoot: DEV_REPO_ROOT,
    onLog: (entry) => sendToRenderer('logs:line', entry),
    onStatus: (status) => {
      sendToRenderer('service:status', status);
      if (status.state === 'ready' && mainWindow && backendOrigin && !backendRestartInProgress) {
        const origin = `http://127.0.0.1:${status.port}`;
        if (origin !== backendOrigin) void loadWorkbench();
      }
    },
  });

  registerIpc();
  buildMenu();
  createTray();
  if (!tray) currentConfig.app.closeAction = 'quit';
  createWindow();

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  // HTTP Basic 凭证只交给本机后端端口，不写 URL、不进日志。
  app.on('login', (event, _webContents, _details, authInfo, callback) => {
    if (!backend) return;
    const auth = backend.getAuth();
    if (authInfo.isProxy) return;
    if (auth.port && authInfo.port !== auth.port) return;
    event.preventDefault();
    callback(auth.user, auth.pass);
  });

  const status = await backend.start();
  if (status.state === 'ready') {
    await loadWorkbench();
    if (IS_SMOKE) {
      setTimeout(async () => {
        try {
          const title = await mainWindow.webContents.executeJavaScript('document.title');
          const text = await mainWindow.webContents.executeJavaScript(
            'document.body.innerText.replace(/\\s+/g, " ").slice(0, 300)',
          );
          console.log(`[smoke] loaded title=${title}`);
          console.log(`[smoke] body=${text}`);
          await backend.stop();
          app.exit(0);
        } catch (error) {
          console.error(`[smoke] failed: ${error?.message || error}`);
          await backend.stop();
          app.exit(1);
        }
      }, 2500);
    }
  } else {
    showErrorPage(status.lastError || '后端启动失败');
    if (IS_SMOKE) {
      console.error(`[smoke] backend failed: ${status.lastError || 'unknown'}`);
      await backend.stop();
      app.exit(1);
      return;
    }
    if (!statusErrorShown) {
      statusErrorShown = true;
      dialog.showMessageBox({
        type: 'error',
        title: 'Bioanalys 工作台无法启动',
        message: '本地服务启动失败。',
        detail: `${status.lastError || '未知错误'}\n\n日志目录：${logsDir}`,
        buttons: ['打开日志目录', '退出'],
        defaultId: 0,
      }).then((result) => {
        if (result.response === 0) shell.openPath(logsDir);
        else { isQuitting = true; app.quit(); }
      });
    }
  }
}

if (gotLock) {
  app.whenReady().then(bootstrap).catch((error) => {
    dialog.showErrorBox('Bioanalys 工作台启动失败', error?.stack || String(error));
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });

  app.on('window-all-closed', () => {
    if (currentConfig.app.closeAction === 'quit') app.quit();
  });

  app.on('before-quit', (event) => {
    isQuitting = true;
    if (quittingInProgress) return;
    quittingInProgress = true;
    event.preventDefault();
    backend?.stop().finally(() => app.quit());
  });
}
