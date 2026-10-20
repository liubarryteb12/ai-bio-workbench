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
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';

import { HOSTS, SSD_ROOT, PROJECTS_ROOT, SYSTEM_LOGS, sanitizeProjectId } from './domain.js';
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

// ---------------------------------------------------------------
// 交付前置门禁（docs/delivery_package_spec.md 第三节第 3/5/6 条）
//
// 规范里这三道闸原本属于「尚未实现的 ops/09_package_delivery.ps1」，但打包能力
// 实际由 ops/build_client_report.py 承担、入口在 8787（server/report.js），
// 引擎本身不含水位/台账/校验和检查（已 grep 确认）。所以把三道闸补在调用侧：
// 引擎跑之前先问远端三件事，任一不过就不许生成交付包，避免「包出来了但项目里
// 还有失败步骤」这种最难解释的假交付。
//
// 口径（与 spec 一致）：
//   1. 存储水位：df -P 剩余 >= 20%（打包本身要写几十 MB 到数百 MB）
//   2. 无进行中任务：本项目台账不得有 status=running
//   3. 失败台账需确认：存在 status=failed 时必须 -Force（这里对应 force=true）
// 另加一条防御：远端输出必须带回 END 标记，缺标记按「输出被截断」判失败
// （本项目历史上吃过 argv 静默截断的亏，见 run.js buildLedgerWriteCommand 注释）。
// ---------------------------------------------------------------

/** 打包前要求的最小剩余空间百分比（spec §三.3：剩余 >= 20%） */
export const PREFLIGHT_MIN_FREE_PCT = 20;

/**
 * 远端门禁查询命令（纯函数，不碰 ssh，可单测）。
 *
 * 输出协议（一行一条，便于单测断言，不依赖 JSON 解析失败时的容错）：
 *   DF|<used_pct>%              挂载点已用百分比
 *   LEDGER|<basename>|<status>  本项目每一条台账的状态
 *   END|                        输出完整标记
 *
 * 台账是 JSON.stringify(entry, null, 2) 落的盘，status 是顶层字段（见 task.js
 * buildLedgerEntry 的字段顺序），所以 grep 首个 "status": 命中就是顶层状态，
 * 不会被 checkpoint_status 干扰（那个键名前面是 checkpoint_，不带引号，匹配不上）。
 */
export function buildPreflightCommand(projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const storage = `df -P '${SSD_ROOT}' | awk 'NR==2 {print "DF|" $5}'`;
  const ledgers = `grep -l '"project_id": "${safe}"' '${SYSTEM_LOGS}'/*.json 2>/dev/null`
    + ` | while IFS= read -r f; do`
    + ` s=$(grep -m1 -o '"status": "[a-z_]*"' "$f" | sed 's/.*: "//; s/"$//');`
    + ` echo "LEDGER|$(basename "$f")|$s";`
    + ` done`;
  return { command: `${storage}; ${ledgers}; echo 'END|'`, remoteProjectDir: `${PROJECTS_ROOT}/${safe}` };
}

/**
 * 解析门禁查询输出（纯函数）。
 * @returns {{usedPct: number|null, ledgers: Array<{file: string, status: string}>, sawEnd: boolean}}
 */
export function parsePreflightOutput(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let usedPct = null;
  const ledgers = [];
  let sawEnd = false;
  for (const line of lines) {
    if (line === 'END|') { sawEnd = true; continue; }
    const df = /^DF\|(\d+)%?$/.exec(line);
    if (df) { usedPct = Number(df[1]); continue; }
    const ledger = /^LEDGER\|([^|]+)\|([A-Za-z_]*)$/.exec(line);
    if (ledger) ledgers.push({ file: ledger[1], status: ledger[2] || 'unknown' });
  }
  return { usedPct, ledgers, sawEnd };
}

/**
 * 跑三道门禁。ok=false 时调用方必须拒绝打包（spec §三：任一不过即 exit 1）。
 *
 * @param {string} projectId
 * @param {{force?: boolean}} options force=true 对应 spec 的 -Force：已知有失败台账
 *        且人工确认过产物完整性时才允许继续
 * @returns {Promise<{ok: boolean, projectId: string, usedPct: number|null, freePct: number|null,
 *   force: boolean, checks: Array<{name: string, ok: boolean, detail: string}>,
 *   failedLedgers: Array<{file: string, status: string}>, summary: string}>}
 */
export async function runReportPreflight(projectId, { force = false } = {}) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const { command } = buildPreflightCommand(safe);
  const { stdout } = await runSsh(command);
  const parsed = parsePreflightOutput(stdout);

  const checks = [];

  const freePct = parsed.usedPct === null ? null : 100 - parsed.usedPct;
  checks.push({
    name: 'storage',
    ok: freePct !== null && freePct >= PREFLIGHT_MIN_FREE_PCT,
    detail: freePct === null
      ? `存储水位未知（df 输出未解析到，远端输出: ${JSON.stringify(String(stdout).slice(-200))}）`
      : `剩余 ${freePct}%（要求 >= ${PREFLIGHT_MIN_FREE_PCT}%，已用 ${parsed.usedPct}%）`,
  });

  const running = parsed.ledgers.filter((item) => item.status === 'running');
  checks.push({
    name: 'running',
    ok: running.length === 0,
    detail: running.length === 0
      ? '无进行中任务'
      : `有 ${running.length} 条进行中台账：${running.map((item) => item.file).join(', ')}`,
  });

  const failed = parsed.ledgers.filter((item) => item.status === 'failed');
  checks.push({
    name: 'failed_ledger',
    ok: failed.length === 0 || force === true,
    detail: failed.length === 0
      ? '无失败台账'
      : `有 ${failed.length} 条失败台账（${failed.map((item) => item.file).join(', ')}）`
        + (force === true ? '，已按 force 继续' : '，需人工确认产物完整后加 force 重试'),
  });

  checks.push({
    name: 'remote_output',
    ok: parsed.sawEnd,
    detail: parsed.sawEnd ? '远端输出完整（收到 END 标记）' : '远端输出缺 END 标记（疑似命令被截断或未执行完）',
  });

  const ok = checks.every((check) => check.ok);
  const summary = ok
    ? `前置门禁全部通过（${checks.map((check) => check.detail).join('；')}）`
    : `前置门禁未通过：${checks.filter((check) => !check.ok).map((check) => `[${check.name}] ${check.detail}`).join('；')}`;

  return {
    ok,
    projectId: safe,
    usedPct: parsed.usedPct,
    freePct,
    force: force === true,
    checks,
    failedLedgers: failed,
    summary,
  };
}

/**
 * 给本地已回搬的交付件补 .sha256 旁挂文件（spec §一「生成校验清单，客户可自行核验」）。
 *
 * 引擎不打 CHECKSUMS.sha256（已 grep 确认），这里在本地缓存目录补一份
 * `<文件名>.sha256`，格式是 sha256sum 的 `<hex>  <name>`，客户侧可直接
 * `sha256sum -c <name>.sha256` 复核。
 *
 * @returns {Array<{name: string, sha256: string, sidecar: string}>}
 */
export function writeSha256Sidecars(projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const dir = localDeliverDir(safe);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const written = [];
  for (const name of names.sort()) {
    if (!isAllowedDeliverableName(name)) continue;
    const file = path.join(dir, name);
    let bytes;
    try {
      bytes = fs.readFileSync(file);
    } catch {
      continue;
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(`${file}.sha256`, `${digest}  ${name}\n`, 'utf8');
    written.push({ name, sha256: digest, sidecar: `${name}.sha256` });
  }
  return written;
}

