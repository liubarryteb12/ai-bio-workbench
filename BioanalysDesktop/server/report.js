/**
 * 客户交付报告工作台入口（架构评审 A4 / R3）。
 *
 * 补齐链路图 §3.1 的手工断点 2/3：以前要人工 ssh 上 K40 跑
 * ops/build_client_report.py、再手动把 deliverables/ 三大件拷回本地；
 * 这里把两步收敛成服务端 build + pull，前端一个按钮触发。
 *
 * 引擎（ops/build_client_report.py，另一会话域，只调用不修改）设计红线：
 *   不编造数字 / 不重写母版 / 交付包脱敏真实路径（{{DATA_ROOT}} 占位）。
 *   退出码 0=成功 1=参数或数据错误 2=环境错误——非 0 一律如实 reject，不吞。
 *
 * 执行接缝说明：run.js（本仓既定范式）执行远端命令用的是 childProcess 默认导入
 * 的 spawn('ssh', [...argv])，而不是把 buildRemoteCommand 的整串命令交给 shell——
 * Windows 本地 shell 是 cmd.exe，单引号不是引用字符，远端命令里的 && 会被 cmd
 * 当成本地命令分隔符拆开。所以这里照 run.js 的 spawn 用法走 argv 数组；scp 拉取
 * 照 pull.js 的 argv 范式。childProcess 用默认导入是为了 node:test 的
 * mock.method 能拦截（ESM 具名导入是链接期快照，拦不到，run.js 注释已实证）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import childProcess from 'node:child_process';

import { HOSTS, SSD_ROOT, PROJECTS_ROOT, sanitizeProjectId } from './domain.js';
import { assertAllowedProgram } from './proc.js';
import { stripSshNoise } from './run.js';

/**
 * 本地交付缓存根：环境变量 BIO_LOCAL_DELIVERABLES 优先，默认仓库根 deliverables/。
 * 只读 env 或取默认，不硬编码其他路径。
 */
export const LOCAL_DELIVER_ROOT = process.env.BIO_LOCAL_DELIVERABLES
  ? path.resolve(process.env.BIO_LOCAL_DELIVERABLES)
  : fileURLToPath(new URL('../../deliverables/', import.meta.url));

/**
 * 本项目在本地交付缓存里的目录。
 * @throws projectId 非法（防路径穿越，拒绝式与 project.js 一致）
 */
export function localDeliverDir(projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  return path.join(LOCAL_DELIVER_ROOT, safe);
}

/**
 * 远端完整交付命令（纯函数，不碰 ssh，可单测）。
 *
 * 目录用项目根而不是某条线的目录：引擎自己会扫三线产物。
 * 远端路径整体用单引号包住（2026-10-13 台账事故教训：裸路径会被
 * 文件名里的空格/特殊字符拆断）；projectId 已消毒，只含 [A-Za-z0-9._-]，
 * 单引号注入进不来。
 *
 * @param {string} projectId
 * @returns {{command: string, remoteProjectDir: string}}
 */
export function buildReportCommand(projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const remoteProjectDir = `${PROJECTS_ROOT}/${safe}`;
  const command = `cd ${SSD_ROOT} && python3 ops/build_client_report.py --project '${remoteProjectDir}'`;
  return { command, remoteProjectDir };
}

/**
 * 引擎交付件允许集合（下载白名单，与 build 拉取集合同一份）：
 *   Analysis_Report.md / Analysis_Report.html / <project>_Client_Delivery.tar.gz
 * 引擎理论上不改名，但 tar 前缀跟随项目 id，按后缀匹配更稳；
 * 纯文本文件名严格全等。任何路径分隔符与 .. 直接拒绝。
 */
const DELIVERABLE_NAME_PATTERNS = [
  /^Analysis_Report\.md$/,
  /^Analysis_Report\.html$/,
  /^[A-Za-z0-9._-]+_Client_Delivery\.tar\.gz$/,
];

export function isAllowedDeliverableName(name) {
  const raw = String(name ?? '');
  if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('..')) return false;
  return DELIVERABLE_NAME_PATTERNS.some((pattern) => pattern.test(raw));
}

/**
 * 本地交付文件绝对路径；projectId 非法、文件名越界或文件不存在时返回 null。
 * 下载路由只认这里的返回值，保证永远落在 localDeliverDir 内。
 */
export function localDeliverFilePath(projectId, name) {
  const safe = sanitizeProjectId(projectId);
  if (!safe || !isAllowedDeliverableName(name)) return null;
  const file = path.join(localDeliverDir(safe), name);
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/**
 * 执行一条远端命令（ssh argv 数组，照 run.js 范式）。
 * 退出码 0 → resolve 去噪后的 {stdout, stderr}；非 0 → reject 且 error 带去噪后的
 * stderr 原文（引擎 1=数据错误 2=环境错误都要如实带回，不许吞成成功）。
 */
function runSsh(command, handlers = {}) {
  assertAllowedProgram(['ssh']);
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOSTS.compute, command],
      { windowsHide: true }
    );
    let out = '';
    let err = '';
    let settled = false;
    // ssh 早退（连接失败）时后续 stdin/stdout 操作会 EPIPE，这里只兜事件本身
    child.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      out += text;
      handlers.onStdout?.(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      err += text;
      handlers.onStderr?.(text);
    });
    child.on('exit', (code) => {
      settled = true;
      const cleanOut = stripSshNoise(out);
      const cleanErr = stripSshNoise(err);
      if (code === 0) return resolve({ stdout: cleanOut, stderr: cleanErr });
      reject(new Error(`exit ${code}: ${cleanErr.trim() || cleanOut.trim() || 'stderr 为空'}`));
    });
    child.on('error', () => {
      if (!settled) reject(new Error(`ssh 启动失败: ${err.trim() || 'unknown error'}`));
    });
  });
}

/**
 * 远端项目目录是否存在（只读 test -d，建项入口校验用）。
 */
export async function checkRemoteProjectDir(projectId) {
  const { remoteProjectDir } = buildReportCommand(projectId);
  try {
    await runSsh(`test -d '${remoteProjectDir}'`);
    return true;
  } catch {
    return false;
  }
}

/**
 * 跑完整交付构建（远端引擎），stdout/stderr 透给 handlers。
 * @returns {Promise<{ok: true, stdout: string}>}
 */
export async function runReportBuild(projectId, handlers = {}) {
  const { command } = buildReportCommand(projectId);
  const result = await runSsh(command, handlers);
  return { ok: true, stdout: result.stdout };
}

/** scp 拉单文件回本地（pull.js 范式的 argv 数组；buildFetchCommand 的整串形式
 * 在 Windows cmd 下同样受单引号/特殊字符限制，故统一走 argv） */
function scpFetch(remotePath, localPath) {
  assertAllowedProgram(['scp']);
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(
      'scp',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', `${HOSTS.compute}:${remotePath}`, localPath],
      { windowsHide: true }
    );
    let err = '';
    let settled = false;
    child.on('error', () => {});
    child.stderr.on('data', (chunk) => { err += chunk.toString(); });
    child.on('exit', (code) => {
      settled = true;
      if (code === 0) return resolve();
      reject(new Error(`scp 拉取失败 (exit ${code}): ${stripSshNoise(err).trim() || 'stderr 为空'}`));
    });
    child.on('error', () => {
      if (!settled) reject(new Error(`scp 启动失败: ${err.trim() || 'unknown error'}`));
    });
  });
}

/**
 * build 成功后把远端 <project>/deliverables/ 三大件拉回 localDeliverDir。
 *
 * 以远端 find 实际清单为准（引擎可能改名），不在允许集合的文件跳过不拉；
 * 三大类任一缺失或任一文件字节数为 0 都明确报错，不许假装成功。
 *
 * @returns {Promise<{ok: true, projectId: string, files: Array<{name: string, bytes: number, path: string}>,
 *   report_md_bytes: number, report_html_bytes: number}>}
 *   files[].path 只回相对 localDeliverDir 的文件名（不回绝对路径，安全红线）。
 */
export async function pullDeliverables(projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const remoteProjectDir = `${PROJECTS_ROOT}/${safe}`;
  const remoteDeliverDir = `${remoteProjectDir}/deliverables`;

  // 递归列远端 deliverables：实测引擎布局是 deliverables/<pid>_Client_Delivery/
  // 03_Interpretation_Report/Analysis_Report.{md,html} + 根下 <pid>_Client_Delivery.tar.gz，
  // 不假设平铺；%P 给出相对 start 点的路径，拉取按相对路径取、本地按 basename 落盘。
  const listing = await runSsh(
    `find '${remoteDeliverDir}' -type f -printf '%P|%s\\n' 2>/dev/null`
  );
  const remoteFiles = listing.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((row) => {
      const separator = row.lastIndexOf('|');
      const relPath = row.slice(0, separator);
      const size = Number(row.slice(separator + 1));
      return { relPath, name: relPath.split('/').pop(), size: Number.isFinite(size) ? size : 0 };
    })
    .filter((entry) => entry.name && !entry.name.includes('/') && !entry.name.includes('\\'));

  const hasMd = remoteFiles.some((f) => f.name === 'Analysis_Report.md');
  const hasHtml = remoteFiles.some((f) => f.name === 'Analysis_Report.html');
  const hasTar = remoteFiles.some((f) => /^[A-Za-z0-9._-]+_Client_Delivery\.tar\.gz$/.test(f.name));
  const missing = [
    hasMd ? null : 'Analysis_Report.md',
    hasHtml ? null : 'Analysis_Report.html',
    hasTar ? null : '<project>_Client_Delivery.tar.gz',
  ].filter(Boolean);
  if (missing.length > 0) {
    const names = remoteFiles.map((f) => f.name).join(', ') || '（空）';
    throw new Error(`远端交付件缺失: ${missing.join(', ')}；远端 deliverables 实际内容: ${names}`);
  }

  const localDir = localDeliverDir(safe);
  fs.mkdirSync(localDir, { recursive: true });

  const files = [];
  for (const file of remoteFiles) {
    if (!isAllowedDeliverableName(file.name)) continue;
    const localPath = path.join(localDir, file.name);
    await scpFetch(`${remoteDeliverDir}/${file.relPath}`, localPath);
    let bytes = 0;
    try {
      bytes = fs.statSync(localPath).size;
    } catch {
      bytes = 0;
    }
    if (bytes <= 0) {
      throw new Error(`交付文件拉取后为空或不存在: ${file.name}（远端 ${file.size} 字节）`);
    }
    files.push({ name: file.name, bytes, path: file.name });
  }

  const md = files.find((f) => f.name === 'Analysis_Report.md');
  const html = files.find((f) => f.name === 'Analysis_Report.html');
  return {
    ok: true,
    projectId: safe,
    files,
    report_md_bytes: md ? md.bytes : 0,
    report_html_bytes: html ? html.bytes : 0,
  };
}
