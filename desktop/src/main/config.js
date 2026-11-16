/**
 * 桌面设置存储。
 *
 * 单一真源：%APPDATA%/BioanalysWorkbench/config.json。
 * 后端不直接读这个文件，由主进程把它翻译成环境变量后注入子进程。
 * 敏感值（未来若新增）用 Electron safeStorage 加密，当前字段不含密钥。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { isInsideDirectory } from './portable-paths.js';

const CONFIG_VERSION = 1;
const ADAPTERS = new Set(['adb', 'mock']);
const CLOSE_ACTIONS = new Set(['tray', 'quit']);
const THEMES = new Set(['system', 'light', 'dark']);

export function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}

export function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    firstRunCompleted: false,
    compute: {
      adapter: 'adb',
      adbPath: '',
      serial: '',
      remoteDataRoot: '',
      remoteHome: '',
      containerName: '',
      memLimitGb: 7.5,
    },
    app: {
      closeAction: 'tray',
      launchAtLogin: false,
      theme: 'system',
      notifications: true,
    },
    storage: {
      dataDir: '',
      rawDataDir: '',
    },
  };
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeConfig(raw) {
  const base = defaultConfig();
  if (!raw || typeof raw !== 'object') return base;
  const compute = raw.compute && typeof raw.compute === 'object' ? raw.compute : {};
  const appCfg = raw.app && typeof raw.app === 'object' ? raw.app : {};
  const storage = raw.storage && typeof raw.storage === 'object' ? raw.storage : {};
  const mem = Number(compute.memLimitGb);
  return {
    version: CONFIG_VERSION,
    firstRunCompleted: asBool(raw.firstRunCompleted, base.firstRunCompleted),
    compute: {
      adapter: ADAPTERS.has(compute.adapter) ? compute.adapter : base.compute.adapter,
      adbPath: asString(compute.adbPath),
      serial: asString(compute.serial),
      remoteDataRoot: asString(compute.remoteDataRoot),
      remoteHome: asString(compute.remoteHome),
      containerName: asString(compute.containerName),
      memLimitGb: Number.isFinite(mem) && mem > 0 && mem <= 8 ? mem : base.compute.memLimitGb,
    },
    app: {
      closeAction: CLOSE_ACTIONS.has(appCfg.closeAction) ? appCfg.closeAction : base.app.closeAction,
      launchAtLogin: asBool(appCfg.launchAtLogin, base.app.launchAtLogin),
      theme: THEMES.has(appCfg.theme) ? appCfg.theme : base.app.theme,
      notifications: asBool(appCfg.notifications, base.app.notifications),
    },
    storage: {
      dataDir: asString(storage.dataDir),
      rawDataDir: asString(storage.rawDataDir),
    },
  };
}

export function loadConfig() {
  const file = configFile();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return normalizeConfig(raw);
  } catch {
    return defaultConfig();
  }
}

export function writeConfig(config) {
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * 校验并合并一份设置补丁。非法值返回错误，不落盘。
 */
export function applyConfigPatch(current, patch) {
  if (!patch || typeof patch !== 'object') return { ok: false, error: '设置载荷必须是对象' };
  const next = structuredClone(current);
  if (patch.compute && typeof patch.compute === 'object') {
    for (const key of ['adbPath', 'serial', 'remoteDataRoot', 'remoteHome', 'containerName']) {
      if (key in patch.compute) next.compute[key] = asString(patch.compute[key]);
    }
    if ('adapter' in patch.compute) {
      if (!ADAPTERS.has(patch.compute.adapter)) return { ok: false, error: 'adapter 只允许 adb 或 mock' };
      next.compute.adapter = patch.compute.adapter;
    }
    if ('memLimitGb' in patch.compute) {
      const value = Number(patch.compute.memLimitGb);
      if (!Number.isFinite(value) || value <= 0 || value > 8) {
        return { ok: false, error: '单任务内存上限必须在 0 到 8 GB 之间' };
      }
      next.compute.memLimitGb = value;
    }
  }
  if (patch.app && typeof patch.app === 'object') {
    if ('closeAction' in patch.app) {
      if (!CLOSE_ACTIONS.has(patch.app.closeAction)) return { ok: false, error: '关闭行为只允许 tray 或 quit' };
      next.app.closeAction = patch.app.closeAction;
    }
    if ('theme' in patch.app) {
      if (!THEMES.has(patch.app.theme)) return { ok: false, error: '主题只允许 system / light / dark' };
      next.app.theme = patch.app.theme;
    }
    if ('launchAtLogin' in patch.app) next.app.launchAtLogin = Boolean(patch.app.launchAtLogin);
    if ('notifications' in patch.app) next.app.notifications = Boolean(patch.app.notifications);
  }
  if (patch.storage && typeof patch.storage === 'object' && 'dataDir' in patch.storage) {
    const value = asString(patch.storage.dataDir);
    if (value && !path.isAbsolute(value)) return { ok: false, error: '数据目录必须是绝对路径' };
    next.storage.dataDir = value;
  }
  if (patch.storage && typeof patch.storage === 'object' && 'rawDataDir' in patch.storage) {
    next.storage.rawDataDir = asString(patch.storage.rawDataDir);
  }
  if ('firstRunCompleted' in patch) next.firstRunCompleted = Boolean(patch.firstRunCompleted);
  return { ok: true, config: normalizeConfig(next) };
}

export function resolveDataDir(config) {
  return path.resolve(config.storage.dataDir || app.getPath('userData'));
}

/**
 * 原始数据目录解析：默认 data\raw_data。
 * 校验失败时返回默认值并带上原因，由调用方提示用户；绝不回落到便携根目录。
 */
export function resolveRawDataDir(config, portableRoot) {
  const fallback = path.join(resolveDataDir(config), 'raw_data');
  const candidate = String(config.storage.rawDataDir || '').trim();
  if (!candidate) return { dir: fallback, warning: '' };
  if (!path.isAbsolute(candidate)) {
    return { dir: fallback, warning: `原始数据目录必须是绝对路径，已回落默认值: ${fallback}` };
  }
  const resolved = path.resolve(candidate);
  if (resolved === path.resolve(portableRoot) || !isInsideDirectory(resolved, portableRoot)) {
    return {
      dir: fallback,
      warning: `原始数据目录必须位于便携目录内且不得是根目录，已回落默认值: ${fallback}`,
    };
  }
  return { dir: resolved, warning: '' };
}

export function ensureDataDirs(dataDir) {
  for (const dir of [
    dataDir,
    path.join(dataDir, 'workspace', 'projects'),
    path.join(dataDir, 'portal', 'inbox'),
    path.join(dataDir, '.uploads'),
    path.join(dataDir, '.ops_state'),
    path.join(dataDir, '.tmp'),
    path.join(dataDir, 'ledger'),
    path.join(dataDir, 'logs'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
