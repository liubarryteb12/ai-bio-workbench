/**
 * 便携版路径真源。
 *
 * 裁定（2026-11-14）：放弃安装版，只保留便携目录形态。所有可写状态必须
 * 跟着便携目录走（exe 所在目录），根目录保持整洁：
 *
 * <portable>\
 * ├── BioanalysWorkbench.exe
 * ├── venv\                    自带 Python 运行环境（schema 网关）
 * ├── resources\               只读运行时
 * ├── index.json               引用关系索引
 * └── data\                    userData：config.json、logs、workspace、上传暂存
 *     └── raw_data\            原始数据自定义存放目录（默认）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function computePortableRoot(app, { env = process.env } = {}) {
  const override = env.BIO_DESKTOP_DATA_HOME;
  if (override) return path.resolve(override);
  if (!app.isPackaged) {
    return path.resolve(HERE, '..', '..', '..');
  }
  return path.dirname(process.execPath);
}

export function portableDataRoot(portableRoot) {
  return path.join(portableRoot, 'data');
}

export function portableWorkspaceRoot(portableRoot) {
  return path.join(portableDataRoot(portableRoot), 'workspace');
}

export function portableReferencesDbRoot(portableRoot) {
  return path.join(portableWorkspaceRoot(portableRoot), 'references_db');
}

export function portableInboxRoot(portableRoot) {
  return path.join(portableWorkspaceRoot(portableRoot), 'inbox');
}

export function portableRunsRoot(portableRoot) {
  return path.join(portableWorkspaceRoot(portableRoot), 'runs');
}

export function portableDeliverablesRoot(portableRoot) {
  return path.join(portableWorkspaceRoot(portableRoot), 'deliverables');
}

export function portableVenvRoot(portableRoot) {
  return path.join(portableRoot, 'venv');
}

export function venvPython(portableRoot) {
  return path.join(portableVenvRoot(portableRoot), 'Scripts', 'python.exe');
}

export function isInsideDirectory(candidate, root) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate === resolvedRoot) return false;
  return resolvedCandidate.startsWith(resolvedRoot + path.sep);
}

/**
 * 原始数据目录校验：必须位于便携目录内，且不得等于便携根目录本身。
 */
export function validateRawDataDir(candidate, portableRoot) {
  const text = String(candidate || '').trim();
  if (!text) return { ok: true, reason: 'empty means default' };
  if (!path.isAbsolute(text)) return { ok: false, reason: '必须提供绝对路径' };
  if (!isInsideDirectory(text, portableRoot)) {
    return { ok: false, reason: `原始数据目录必须位于便携目录内: ${portableRoot}` };
  }
  if (path.resolve(text) === path.resolve(portableRoot)) {
    return { ok: false, reason: '原始数据目录不得是便携根目录，保持根目录整洁' };
  }
  return { ok: true, reason: '' };
}

/**
 * 一次性迁移旧安装版数据（%APPDATA%\BioanalysWorkbench）到便携目录。
 *
 * 触发条件：便携 data 目录还没有 config.json，且旧目录存在。
 * 迁移内容：config.json、logs\、data\workspace 等既有子目录。
 * 幂等：目标存在同名文件即跳过，迁移完成后删除旧目录。
 */
export function migrateLegacyAppData(app, portableRoot) {
  const legacyRoot = path.join(app.getPath('appData'), 'BioanalysWorkbench');
  const dataRoot = portableDataRoot(portableRoot);
  if (!fs.existsSync(legacyRoot)) return { migrated: false, reason: 'legacy missing' };
  if (fs.existsSync(path.join(dataRoot, 'config.json'))) {
    return { migrated: false, reason: 'portable config already exists' };
  }

  fs.mkdirSync(dataRoot, { recursive: true });
  const moved = [];
  const skipped = [];
  const legacyConfig = path.join(legacyRoot, 'config.json');
  if (fs.existsSync(legacyConfig)) {
    fs.copyFileSync(legacyConfig, path.join(dataRoot, 'config.json'));
    moved.push('config.json');
  }
  for (const name of ['logs', 'workspace', 'portal', '.uploads', '.ops_state', '.tmp', 'ledger']) {
    const from = path.join(legacyRoot, name);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dataRoot, name);
    if (fs.existsSync(to)) {
      skipped.push(name);
      continue;
    }
    fs.cpSync(from, to, { recursive: true });
    moved.push(name);
  }

  fs.rmSync(legacyRoot, { recursive: true, force: true, maxRetries: 3 });
  return { migrated: true, moved, skipped };
}
