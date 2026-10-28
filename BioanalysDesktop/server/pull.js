/**
 * 产物回搬通道（手机端 k40 → 本地电脑）
 *
 * 规范（aims §3.2 视图 4 / §7.3）：计算全部在手机容器内完成，但**图件必须回搬到
 * 本地** `local_projects/<项目>/figures/<线>/`，工作台视图 4 优先读本地副本；没回搬时
 * 才回落远端实时读取，并在界面标注来源，不能让"本地没图"被误读成"分析没出图"。
 *
 * 本地零算力红线不变：这里只用 ssh 列目录 + scp 传文件，不启动任何分析程序。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LINES, projectLineDir, sanitizeProjectId } from './domain.js';
import { runSync } from './proc.js';

/** 本地项目根：仓库根 local_projects/，与 ops/07_pull_outputs.ps1 同一位置 */
export const LOCAL_OUTPUTS_ROOT = process.env.BIO_LOCAL_OUTPUTS
  ? path.resolve(process.env.BIO_LOCAL_OUTPUTS)
  : fileURLToPath(new URL('../../local_projects/', import.meta.url));

/** 默认回搬的产物子目录。processed/ 可能有 h5ad/rds 大检查点，不默认回搬 */
export const PULL_SUBDIRS = ['figures', 'results'];

export const SSH_TARGET = 'k40-ubuntu';

/** 本项目在本地自包含根。 */
export function localProjectDir(projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`project_id 非法: ${projectId}`);
  return path.join(LOCAL_OUTPUTS_ROOT, safe);
}

/** 本项目本线图件目录。 */
export function localLineDir(projectId, lineId) {
  if (!LINES.includes(lineId)) throw new Error(`line_id 非法: ${lineId}`);
  return path.join(localProjectDir(projectId), 'figures', lineId);
}

/** results 等表格产物落在 data/<line>/<sub>，不进入图件目录。 */
export function localDataDir(projectId, lineId, sub = '') {
  if (!LINES.includes(lineId)) throw new Error(`line_id 非法: ${lineId}`);
  return path.join(localProjectDir(projectId), 'data', lineId, sub);
}

/**
 * 解析 `find -printf '%f|%s\n'` 输出。
 * 只收不带路径分隔符的文件名，防远端输出异常把路径带进本地落点。
 */
export function parseRemoteFileList(raw) {
  return String(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((row) => {
      const [name, size] = row.split('|');
      return { name, size: Number(size) || 0 };
    })
    .filter((entry) => entry.name && !entry.name.includes('/') && !entry.name.includes('\\'));
}

/**
 * 计算待拉 / 可跳过清单。
 *
 * 本地已存在且字节数相同 → 跳过（避免重复传输）；
 * 字节数不同 → 视为远端是新正本，覆盖（这是"回搬"，不是"只增不改"）。
 * force=true 时即使大小相同也重拉。
 */
export function planPull(localDir, remoteFiles, { force = false } = {}) {
  const pull = [];
  const skip = [];
  for (const file of remoteFiles) {
    const localPath = path.join(localDir, file.name);
    let sameSize = false;
    try {
      sameSize = fs.statSync(localPath).size === file.size;
    } catch {
      sameSize = false;
    }
    if (!force && sameSize) {
      skip.push({ ...file, localPath });
    } else {
      pull.push({ ...file, localPath });
    }
  }
  return { pull, skip };
}

/** 列远端某目录下的文件（名称 + 字节数） */
function listRemote(remoteDir, run) {
  const result = run(
    ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', SSH_TARGET,
      `find '${remoteDir}' -maxdepth 1 -type f -printf '%f|%s\\n' 2>/dev/null`],
    { timeoutMs: 40000 }
  );
  return parseRemoteFileList(result.stdout);
}

/**
 * 回搬一条线的产物到本地存档。
 *
 * @param {string} projectId
 * @param {string} lineId
 * @param {{subdirs?: string[], force?: boolean, run?: Function}} [options]
 *        run 可注入（测试用），默认真实 ssh/scp
 * @returns {{projectId, lineId, pulled, skipped, failed, files, dirs}}
 */
export function pullLineOutputs(projectId, lineId, options = {}) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`project_id 非法: ${projectId}`);
  if (!LINES.includes(lineId)) throw new Error(`line_id 非法: ${lineId}`);

  const subdirs = options.subdirs || PULL_SUBDIRS;
  const force = Boolean(options.force);
  const run = options.run || runSync;

  const files = [];
  const dirs = [];
  for (const sub of subdirs) {
    const remoteDir = `${projectLineDir(safe, lineId)}/${sub}`;
    const remoteFiles = listRemote(remoteDir, run);
    if (remoteFiles.length === 0) {
      dirs.push({ sub, remoteDir, pulled: 0, skipped: 0, failed: 0, reason: '远端无文件' });
      continue;
    }

    const localDir = sub === 'figures'
      ? localLineDir(safe, lineId)
      : localDataDir(safe, lineId, sub);
    fs.mkdirSync(localDir, { recursive: true });
    const { pull, skip } = planPull(localDir, remoteFiles, { force });

    let failed = 0;
    if (pull.length > 0) {
      // 一次 scp 传多个源文件，避免逐张图起进程（26 张图 × 1 次往返很慢）
      const scp = run(
        ['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
          ...pull.map((file) => `${SSH_TARGET}:${remoteDir}/${file.name}`),
          localDir],
        { timeoutMs: 180000 }
      );
      const scpOk = scp.code === 0;
      for (const file of pull) {
        let ok = scpOk;
        if (ok) {
          try {
            ok = fs.statSync(file.localPath).size === file.size;
          } catch {
            ok = false;
          }
        }
        if (!ok) failed += 1;
        files.push({
          name: file.name, size: file.size, sub,
          action: ok ? 'pulled' : 'failed',
          localPath: file.localPath,
        });
      }
    }
    for (const file of skip) {
      files.push({ name: file.name, size: file.size, sub, action: 'skipped', localPath: file.localPath });
    }
    dirs.push({ sub, remoteDir, pulled: pull.length - failed, skipped: skip.length, failed });
  }

  const sum = (key) => dirs.reduce((acc, item) => acc + item[key], 0);
  return {
    projectId: safe,
    lineId,
    pulled: sum('pulled'),
    skipped: sum('skipped'),
    failed: sum('failed'),
    files,
    dirs,
    localDir: localProjectDir(safe),
  };
}

/**
 * 读本地已回搬的图件清单。
 * 返回 null 表示本地目录不存在或没有图（调用方据此回落远端）。
 */
export function readLocalFigures(projectId, lineId) {
  const dir = localLineDir(projectId, lineId);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const figures = names
    .filter((name) => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, size: stat.size, mtime: stat.mtimeMs / 1000 };
    });
  if (figures.length === 0) return null;
  return { dir, figures };
}

/** 本地图件文件路径；不存在、非图像扩展名或含路径分隔符时返回 null */
export function localFigurePath(projectId, lineId, name) {
  if (!/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name)) return null;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  const file = path.join(localLineDir(projectId, lineId), name);
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}
