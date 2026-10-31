/**
 * BioanalysDesktop 后端入口
 *
 * 职责边界（本地零算力红线）：
 *   本地只做三件事：跑 ssh / scp / adb、读写本软件自身配置、给前端提供接口。
 *   除此之外的程序一律不启动（见 server/proc.js 白名单）。
 *   所有计算命令都经 ssh 到 k40-ubuntu 执行。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SERIAL, SYSTEM_LOGS, LINES, DEFAULT_PROJECT, sanitizeProjectId, projectLineDir,
  PROJECTS_ROOT, resolveLineFromDataType, normalizeDatasets, normalizeDataSource,
} from './domain.js';
import { findAdb, runSync, runSshRaw, runSshStrict } from './proc.js';
import { checkLink } from './link.js';
import {
  buildHardwareCommand, parseHardwareOutput, evaluateHardware,
  buildIsolationCommand, parseIsolationOutput, evaluateIsolation,
  runSha256ParityCheck, mergeIsolationChecks,
  STORAGE_MIN_FREE_PCT,
} from './selfcheck.js';
import { inspectTaskPath } from './ledger.js';
import { assertFiguresPath, parseFigureList, decorateFigures } from './figures.js';
import {
  readLocalFigures,
} from './pull.js';
import {
  CHUNK_SIZE, initUpload, writeChunk, listChunks, assembleChunks,
  readHeader, validateUpload, remoteRawPath, cleanupUpload, sanitizeFilename,
  deployedRawName, uploadStatus, resolveUploadId, gcStaleUploads, maybeGcStaleUploads,
  checkChunkAdmission, writeSessionMeta, clearSessionMeta, normalizeReservedBytes,
} from './upload.js';
import {
  buildPipelineDag, buildProjectMeta, buildProjectMetaStrict, parseProjectList, buildCreateProjectCommand,
  buildProjectListCommand, buildReadProjectMetaCommand, parseProjectMeta,
  LINE_STEPS, PIPELINE_STEP_META,
} from './project.js';
import { checkTumorBlacklist, validateProjectFields, BLACKLIST_HINT } from './tumor_blacklist.js';
import {
  describeSeries, resolvePlan, validateRegistry, loadWorkflows, modToScriptMap,
} from './workflow_graph.js';
import {
  buildProjectExecutionPlan,
  mergeFigureProjectTasks,
} from './figure_execution_plan.js';
import { prepareFigureProjectTasks } from './figure_project_plan.js';
import { handleUploadRoutes } from './routes/upload.routes.js';
import { handleDiagnosticsRoutes } from './routes/diagnostics.routes.js';
import { handleReportRoutes } from './routes/report.routes.js';
import { handleFiguresRoutes } from './routes/figures.routes.js';
import { handleTasksRoutes } from './routes/tasks.routes.js';
import { handleProjectRoutes } from './routes/projects.routes.js';

const PORT = Number(process.env.BAD_PORT || 18787);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

/** 把项目相对 adapt_vars 输入映射成远端任务可用的绝对路径 */
function remoteTaskInput(rawPath, projectId, lineId) {
  const normalized = String(rawPath || '').split('\\').join('/').replace(/^\.\/+/, '');
  if (!normalized) return `${projectLineDir(projectId, lineId)}/processed/input.tsv`;
  if (normalized.startsWith(`data/${lineId}/`)) {
    return `${PROJECTS_ROOT}/${projectId}/${normalized.slice('data/'.length)}`;
  }
  if (normalized.startsWith(`figures/${lineId}/`)) {
    return `${PROJECTS_ROOT}/${projectId}/${normalized}`;
  }
  if (normalized.startsWith('processed/') || normalized.startsWith('results/')) {
    return `${projectLineDir(projectId, lineId)}/${normalized}`;
  }
  if (!normalized.includes('/')) {
    return `${projectLineDir(projectId, lineId)}/processed/${normalized}`;
  }
  return `${PROJECTS_ROOT}/${projectId}/${normalized}`;
}

function uploadPreparedFigureScripts(preparedFigures) {
  const uploads = [];
  for (const entry of preparedFigures.manifest_entries || []) {
    const remoteDir = path.posix.dirname(entry.remote_path);
    const mkdir = runRemoteRaw(`mkdir -p '${remoteDir}'`);
    if (mkdir.code !== 0) {
      return { ok: false, error: `图模板目录创建失败: ${mkdir.text}`, uploads };
    }
    const scp = runSync([
      'scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
      entry.local_path, `k40-ubuntu:${entry.remote_path}`,
    ]);
    if (scp.code !== 0) {
      return {
        ok: false,
        error: `图模板脚本上传失败: ${scp.stderr || scp.stdout || 'stderr 为空'}`,
        uploads,
      };
    }
    uploads.push({
      template_id: entry.template_id,
      local_path: entry.local_path,
      remote_path: entry.remote_path,
    });
  }
  return { ok: true, error: '', uploads };
}

/**
 * 工作台口令（HTTP Basic）。
 * 18787 会经 frp 暴露到公网，frp 从本机 127.0.0.1 回连，服务端无法用来源地址区分内外，
 * 所以只能整站鉴权。安全口径（D-29 Fail-Closed）：
 *   1. 环境变量给了账号口令就强制校验（正式常驻由 ops/serve_guard.ps1 注入）；
 *   2. 非测试环境且未显式 BIO_ALLOW_DEV_NOAUTH=1 时，若未配置口令，自动生成随机强口令
 *      并打印到控制台（同时落 server/.auth_runtime.json，权限限本机），消灭免密裸奔；
 *   3. node:test 运行环境（NODE_TEST_CONTEXT 存在）与显式豁免保持免密，测试零改动。
 */
let AUTH_USER = process.env.BAD_AUTH_USER || process.env.WORKBENCH_AUTH_USER || '';
let AUTH_PASS = process.env.BAD_AUTH_PASS || process.env.WORKBENCH_AUTH_PASS || '';
let AUTH_ENABLED = Boolean(AUTH_USER && AUTH_PASS);

const IS_TEST_RUNTIME = Boolean(process.env.NODE_TEST_CONTEXT) && process.env.BIO_TEST_FORCE_FAIL_CLOSED !== '1';
const DEV_NOAUTH = process.env.BIO_ALLOW_DEV_NOAUTH === '1';
if (!AUTH_ENABLED && !IS_TEST_RUNTIME && !DEV_NOAUTH) {
  AUTH_USER = 'admin';
  AUTH_PASS = randomBytes(18).toString('base64url');
  AUTH_ENABLED = true;
  console.error('[SECURITY][D-29 Fail-Closed] 未检测到 BAD_AUTH_USER/BAD_AUTH_PASS，已启用临时会话强鉴权。');
  console.error(`[SECURITY] 账号 ${AUTH_USER} 口令 ${AUTH_PASS}（重启重新生成；正式部署用 serve_guard 注入固定口令）`);
  if (process.env.BIO_AUTH_RUNTIME_FILE) {
    fs.writeFileSync(process.env.BIO_AUTH_RUNTIME_FILE, JSON.stringify({
      user: AUTH_USER, pass: AUTH_PASS, enabled: true, generatedAt: new Date().toISOString(),
    }), 'utf8');
  }
}

/** 定长比较，避免按字节提前返回泄露口令前缀 */
function safeEqual(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isAuthorized(req) {
  if (!AUTH_ENABLED) return true;
  if (!AUTH_USER || !AUTH_PASS) return false;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const split = decoded.indexOf(':');
  if (split < 0) return false;
  // 两项都比较完再合并结果，不因用户名错就短路
  const userOk = safeEqual(decoded.slice(0, split), AUTH_USER);
  const passOk = safeEqual(decoded.slice(split + 1), AUTH_PASS);
  return userOk && passOk;
}

const adb = findAdb();

/** 在跑的任务表：id -> {kill, projectId, lineId, step, startedAt}，中止与去重都靠它 */
const runningTasks = new Map();

/**
 * SSE 订阅者表：taskId -> Set<write fn>。
 * 日志先到 sink，再由 sink 推给所有订阅者；这样任务晚于连接启动也不丢消息。
 */
const logSinks = new Map();

function createSink(taskId, write) {
  if (!logSinks.has(taskId)) logSinks.set(taskId, new Set());
  logSinks.get(taskId).add(write);
  return write;
}

function dropSink(taskId, sink) {
  const sinks = logSinks.get(taskId);
  if (!sinks) return;
  sinks.delete(sink);
  if (sinks.size === 0) logSinks.delete(taskId);
}

/** 把一个 SSE 事件推给该任务的所有订阅者 */
function sendEvent(taskId, event, data) {
  const sinks = logSinks.get(taskId);
  if (!sinks || sinks.size === 0) return;
  // data 里可能有换行，SSE 要求按行拆成多个 data: 字段
  const payload = String(data)
    .split(/\r?\n/)
    .map((line) => `data: ${line}`)
    .join('\n');
  for (const sink of sinks) {
    try {
      sink(`event: ${event}\n${payload}\n\n`);
    } catch {
      // 单个订阅者写失败（连接已断）不影响其他订阅者
    }
  }
}

function closeSink(taskId) {
  logSinks.delete(taskId);
}

/**
 * 从服务器读台账 JSON。
 *
 * 用 base64 传输而不是直接 cat，避免 JSON 里的引号、反斜杠、中文被 ssh 层破坏
 * （会话 #1 已踩过这个坑：PowerShell heredoc 传 JSON 全变形）。
 */
async function fetchLedgerFromServer(logsDir = SYSTEM_LOGS) {
  const listing = runRemote(`ls -1 '${logsDir}'/*.json 2>/dev/null || true`);
  const names = listing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.json'));

  const entries = [];
  for (const remotePath of names) {
    const encoded = runRemote(`base64 -w0 '${remotePath}' 2>/dev/null || true`);
    if (!encoded.trim()) continue;
    const text = Buffer.from(encoded.trim(), 'base64').toString('utf8');
    entries.push({
      file: remotePath.split('/').pop(),
      path: remotePath,
      data: JSON.parse(text),
    });
  }
  return { names: entries.map((entry) => entry.file), entries };
}

function runRemoteRaw(command) {
  return runSshRaw('k40-ubuntu', command, { timeoutMs: 40000 });
}

/**
 * 列远端该线 processed/ 下的文件名（不含路径）。
 * 只取一层、不递归：M4 的产物核对只需要文件名集合，递归会在容器里触发 P-23。
 * ssh 失败时返回空集合 -  - 预览端点不该因为链路抖动就 500，缺产物会显示成 missing。
 */
function listRemoteProcessed(projectId, lineId) {
  const dir = `${projectLineDir(projectId, lineId)}/processed`;
  const out = runRemote(`ls -1 ${dir} 2>/dev/null || true`);
  return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
}

/** 宽松版：只要文本，忽略退出码（多数调用点靠命令里的 `|| true` / MISSING 自己兜底） */
function runRemote(command) {
  return runRemoteRaw(command).text;
}

/**
 * 严格版：ssh 退出码非 0 或输出为空一律抛错，供五维自检使用。
 *
 * 存在的理由（踩坑台账 P-15）：宽松版丢弃退出码，链路断时 ssh 返回 255 且
 * stdout 为空，第 1 维会把空串判成"原生 ext4"、第 2 维会把空串算成 100% free，
 * 自检出现假绿灯 -  - 而自检是提交门禁，假绿灯比红灯危险得多。
 */
function runRemoteStrict(command) {
  return runSshStrict('k40-ubuntu', command, { timeoutMs: 40000 });
}

/**
 * 桥接输出的 ssh noise 过滤：只留引擎原文。
 *
 * 真链实测（K40 高负载、known_hosts 首次写入时）stderr 会混进 ssh 客户端自身
 * 的提示行（`Warning: Permanently added ... to the list of known hosts`），
 * 这些不是引擎内容。若不滤掉，400 error 会把 ssh 提示和引擎 [BRIDGE FAIL]
 * 原文糊在一起，调用方难以点名是哪个断言没过。
 * 风险：按最保守口径只删已知 noise 前缀，其余一律保留；两通道重复内容只留一份
 * （2>&1 后 stdout/stderr 可能同文），避免 error 里重复刷屏。
 */
function sanitizeBridgeOutput(stdout = '', stderr = '') {
  const noise = /^(Warning: Permanently added|Warning: .*known hosts)/i;
  const lines = [];
  const seen = new Set();
  for (const chunk of [stdout, stderr]) {
    for (const line of String(chunk ?? '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || noise.test(trimmed) || seen.has(trimmed)) continue;
      seen.add(trimmed);
      lines.push(line);
    }
  }
  return lines.join('\n').trim();
}

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
/**
 * 上传链路错误响应单一出口（task-8 / B）。
 * 以前 init / chunk 回 {error}，status 回 {ok:false, error}，两种形状并存，
 * 前端只能猜；现在四个端点（init / chunk / status / complete）的 4xx/5xx 一律走这里，
 * 统一回 {ok:false, error}。ok:false 是新增字段，前端（App.tsx 只读 error）不受影响；
 * HTTP 状态码语义不变，调用方传什么状态码就回什么。
 * 成功响应不走本函数。
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} message 非空字符串
 */
function uploadError(res, status, message) {
  return json(res, status, { ok: false, error: String(message ?? '') });
}


// ── 任务提交路径预校验（S29 / R9；2026-10-21 收敛到 ledger.js 单一事实源）──
// 单路径归属判定已移到 ledger.js 的 inspectTaskPath / analyzePath，与台账审计
// （classifyPath）、文件访问守卫共用同一套"合法根"口径；本文件只保留批量包装。

/**
 * 任务提交前的路径归属预校验（S29 / R9）。纯函数：不读文件、不连远端。
 * @param {string[]} inputs
 * @param {string[]} outputs
 * @param {string} projectId 已经过 sanitizeProjectId 的项目 id
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateTaskPaths(inputs, outputs, projectId) {
  const fields = [
    { field: 'inputs', list: inputs, direction: 'input' },
    { field: 'outputs', list: outputs, direction: 'output' },
  ];
  for (const { field, list, direction } of fields) {
    if (!Array.isArray(list)) continue; // 数组类型校验在 submit 里更早返回 400
    for (let index = 0; index < list.length; index += 1) {
      const raw = list[index];
      const label = `${field}[${index}]`;
      if (typeof raw !== 'string' || raw.trim() === '') {
        return { ok: false, error: `${label} 路径非法（空值或非字符串）: ${JSON.stringify(raw)}` };
      }
      const verdict = inspectTaskPath(raw.trim(), projectId, direction);
      if (verdict) {
        const detail = verdict.detail ? `，${verdict.detail}` : '';
        return { ok: false, error: `${label} 路径非法（${verdict.reason}）: ${raw.trim()}${detail}` };
      }
    }
  }
  return { ok: true };
}

/**
 * 解析 project 查询参数：缺省用默认项目；非法（含穿越字符）返回 null，调用方回 400。
 */
function resolveProjectParam(url) {
  const raw = url.searchParams.get('project') || DEFAULT_PROJECT;
  return sanitizeProjectId(raw);
}

/**
 * 列出数据面全部项目（含元数据）。
 * 项目目录存在但缺 project.json 时也列出，meta=null，不假装它不存在。
 */
function listProjectsWithMeta() {
  const listing = runRemote(buildProjectListCommand());
  const ids = parseProjectList(listing);
  return ids.map((id) => {
    const encoded = runRemote(buildReadProjectMetaCommand(id));
    let meta = null;
    if (encoded.trim()) {
      meta = parseProjectMeta(Buffer.from(encoded.trim(), 'base64').toString('utf8'));
    }
    return { projectId: id, meta };
  });
}

/**
 * 列出一个项目某条线 figures/ 下的图件（含中文说明），供 API 与后端预览页共用。
 *
 * 优先读本地回搬副本 outputs/<项目>/<线>/figures/（规范要求图件回搬本地），
 * 本地没有时才回落远端实时读取，并用 source 字段标明来源  -  -  不能让
 * "本地还没回搬"被误读成"这条线没出图"。
 */
function listFiguresForLine(projectId, lineId) {
  const guard = assertFiguresPath(projectId, lineId);
  if (!guard.ok) {
    return { blocked: true, reason: guard.reason, figures: [] };
  }
  const local = readLocalFigures(projectId, lineId);
  if (local) {
    return {
      blocked: false,
      dir: local.dir,
      source: 'local',
      figures: decorateFigures(parseFigureList(
        local.figures.map((f) => `${f.name}|${f.size}|${f.mtime}`).join('\n')
      )),
    };
  }
  const probe = runRemote(`if [ -d '${guard.dir}' ]; then echo EXISTS; else echo MISSING; fi`);
  if (!probe.includes('EXISTS')) {
    return { blocked: true, reason: `图件目录不存在: ${guard.dir}`, figures: [] };
  }
  const listing = runRemote(
    `find '${guard.dir}' -maxdepth 1 -type f -printf '%f|%s|%T@\\n' 2>/dev/null`
  );
  return {
    blocked: false,
    dir: guard.dir,
    source: 'remote',
    figures: decorateFigures(parseFigureList(listing)),
  };
}

/** HTML 转义，防文件名/说明里的特殊字符破坏预览页 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 渲染后端自带的出图预览页（服务端 HTML，不依赖前端构建产物）。
 * @param {Array<{lineId: string, blocked: boolean, reason?: string, figures: Array}>} sections
 * @param {string} projectId 当前项目
 */
function renderFiguresPreview(sections, projectId) {
  const lineLabels = {
    line1_bulk: '线1 / GEO bulk',
    line2_scrna: '线2 / 单细胞转录组',
    line3_spatial: '线3 / 空间转录组',
  };
  const total = sections.reduce((sum, s) => sum + (s.figures ? s.figures.length : 0), 0);
  const body = sections.map((section) => {
    const label = lineLabels[section.lineId] || section.lineId;
    if (section.blocked || !section.figures || section.figures.length === 0) {
      const reason = section.blocked ? section.reason : '该线 figures/ 暂无图件';
      return `<h2>${escapeHtml(label)}</h2><p class="empty">${escapeHtml(reason)}</p>`;
    }
    const cards = section.figures.map((fig) => {
      const url = `/api/figures/image?project=${encodeURIComponent(projectId)}&line=${encodeURIComponent(section.lineId)}&name=${encodeURIComponent(fig.name)}`;
      const cap = fig.caption ? `<div class="cap">${escapeHtml(fig.caption)}</div>` : '';
      return `<figure class="card">
  <a href="${url}" target="_blank"><img src="${url}" alt="${escapeHtml(fig.name)}" loading="lazy"></a>
  <figcaption><span class="fn">${escapeHtml(fig.name)}</span>${cap}<span class="sz">${escapeHtml(fig.sizeLabel || '')}</span></figcaption>
</figure>`;
    }).join('\n');
    const sourceLabel = section.source === 'local' ? ' · 本地副本'
      : section.source === 'remote' ? ' · 远端实时（尚未回搬）' : '';
    return `<h2>${escapeHtml(label)}（${section.figures.length} 张${sourceLabel}）</h2>
<div class="grid">
${cards}
</div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BioanalysDesktop · 出图预览</title>
<style>
  body{font-family:system-ui,"Microsoft YaHei",sans-serif;margin:0;background:#f5f6f8;color:#1a1a1a}
  header{background:#1f2937;color:#fff;padding:18px 28px}
  header h1{margin:0;font-size:20px}
  header p{margin:6px 0 0;font-size:13px;opacity:.85}
  main{padding:18px 28px}
  h2{font-size:16px;border-left:4px solid #2563eb;padding-left:10px;margin:24px 0 12px}
  .empty{color:#7b8794;font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
  .card{margin:0;background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden}
  .card img{width:100%;display:block;background:#fff}
  figcaption{padding:8px 10px;font-size:12px;color:#374151;border-top:1px solid #eee;display:flex;flex-direction:column;gap:3px}
  .fn{color:#0b5fff;font-family:Consolas,monospace;font-size:11px}
  .cap{color:#52606d}
  .sz{color:#9aa5b1;font-size:11px}
</style></head>
<body>
<header>
  <h1>出图预览（后端渲染）</h1>
  <p>项目 ${escapeHtml(projectId)} · 共 ${total} 张 · 三条分析线 · 点击图片新窗口看原图 · 图件目录 projects/&lt;项目&gt;/&lt;线&gt;/figures/</p>
</header>
<main>
${body}
</main>
</body></html>`;
}

/** 管理员工作台前端构建产物目录（vite build 输出） */
const DIST_DIR = new URL('../dist/', import.meta.url);

/**
 * 客户需求收件箱：用户提交台（portal/serve.mjs）落盘目录。
 *
 * 解耦原则不变：portal 不调用工作台任何接口，工作台也不主动推送；
 * 这里只是让管理员在新建项目时能主动读取该目录，替代"手工打开 JSON 抄一遍"。
 * 目录位于仓库根，与 BioanalysDesktop 平级。
 */
const PORTAL_INBOX = fileURLToPath(new URL('../../portal/inbox/', import.meta.url));

/**
 * 需求文件名校验：只允许两种形态，禁止任何穿越。
 *   - 旧格式：收件箱根目录的单个 `<时间戳>_需求_<项目名>.json`
 *   - 新格式：提交包 `PKG_<时间戳>_<项目名>/requirement.json`
 * 包名由 portal 生成（时间戳 + 中文项目名），故放行中文字符。
 */
function isSafeManifestName(name) {
  if (typeof name !== 'string' || !name) return false;
  if (name.includes('..') || name.includes('\\')) return false;
  if (/^[\w\u4e00-\u9fa5.-]+\.json$/.test(name)) return true;
  return /^PKG_[\w\u4e00-\u9fa5.-]+\/(requirement|package_manifest)\.json$/.test(name);
}

/** 读包清单（新格式才有）；解析失败返回 null，不让一个坏清单挡住整列表 */
function readPackageManifest(relFile) {
  const slash = relFile.indexOf('/');
  if (slash < 0) return null;
  const dir = relFile.slice(0, slash);
  try {
    return JSON.parse(fs.readFileSync(path.join(PORTAL_INBOX, dir, 'package_manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 列出收件箱需求（按 mtime 倒序）。同时兼容两种落盘形态：
 *   - 旧：根目录平铺 `<时间戳>_需求_<项目名>.json`
 *   - 新：`PKG_<时间戳>_<项目名>/requirement.json` + package_manifest.json
 * 目录不存在时返回 blocked，不假装"没有需求"；单个文件解析失败也如实列出 parseError。
 */
function listInboxManifests() {
  let entries;
  try {
    entries = fs.readdirSync(PORTAL_INBOX, { withFileTypes: true });
  } catch (cause) {
    return {
      blocked: true,
      reason: `收件箱目录不存在或不可读: ${PORTAL_INBOX}`,
      detail: cause instanceof Error ? cause.message : String(cause),
      items: [],
    };
  }

  const names = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      names.push(entry.name);
    } else if (entry.isDirectory() && entry.name.startsWith('PKG_')) {
      const req = path.join(PORTAL_INBOX, entry.name, 'requirement.json');
      if (fs.existsSync(req)) names.push(`${entry.name}/requirement.json`);
    }
  }

  const items = names.map((file) => {
    const full = path.join(PORTAL_INBOX, file);
    let size = 0;
    let mtime = '';
    try {
      const stat = fs.statSync(full);
      size = stat.size;
      mtime = stat.mtime.toISOString();
    } catch {
      // 文件刚被移走，跳过统计即可
    }
    let summary = null;
    let parseError = null;
    try {
      const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
      // 旧需求文件是扁平数组（trainGse/valGse/gpl），归一化后统一成配对表；
      // inferred=true 表示配对是按位置推断的，前端须提示用户核对
      const pairing = normalizeDatasets(raw?.dataSource);
      summary = {
        name: raw?.basicInfo?.name || '',
        disease: raw?.basicInfo?.disease || '',
        domain: raw?.basicInfo?.domain || '',
        species: raw?.basicInfo?.species || '',
        dataType: raw?.dataSource?.dataType || '',
        suggestedLine: resolveLineFromDataType(raw?.dataSource?.dataType),
        // 配对表每行带 dataType / sampleCount / tissue（行级未填时已由
        // normalizeDatasets 回落项目级），前端直接展示，不重算
        datasets: pairing.datasets,
        datasetsInferred: pairing.inferred,
        sampleCount: Number(raw?.dataSource?.sampleCount) || 0,
        tissue: raw?.dataSource?.tissue || '',
        refCount: Array.isArray(raw?.references) ? raw.references.length : 0,
        notes: typeof raw?.notes === 'string' ? raw.notes : '',
        submittedAt: raw?.submitted_at || '',
        stepCount: Array.isArray(raw?.pipelineDag) ? raw.pipelineDag.length : 0,
        groupCount: Array.isArray(raw?.groupingDesign?.groups) ? raw.groupingDesign.groups.length : 0,
      };
    } catch (cause) {
      parseError = cause instanceof Error ? cause.message : String(cause);
    }
    // 新格式带包清单：把附件计数一并给前端，列表页就能看出"这次提交带了几个文件"
    const pkg = readPackageManifest(file);
    return {
      file, size, mtime, summary, parseError,
      packageDir: pkg ? pkg.package_dir || file.split('/')[0] : null,
      attachments: pkg && pkg.counts ? pkg.counts : null,
    };
  });

  items.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return { blocked: false, dir: PORTAL_INBOX, items };
}

/** 静态资源 MIME 映射 */
const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * 托管管理员工作台前端（dist/）。
 * 18787 只提供管理员工作台（/）与后端 API；客户需求提交入口是独立服务（见 portal/），不在此端口。
 * 无扩展名的路径按 SPA 回退到 index.html（React 单页，路由在客户端状态里）。
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 */
function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  // 防目录穿越
  if (rel.includes('..')) {
    return json(res, 400, { error: '非法路径' });
  }
  const lastSlash = rel.lastIndexOf('/');
  const lastDot = rel.lastIndexOf('.');
  const hasExt = lastDot > lastSlash;
  const ext = hasExt ? rel.slice(lastDot).toLowerCase() : '';
  // 有扩展名：只找该文件；无扩展名：先找同名文件再回退 index.html
  const candidates = hasExt ? [rel] : [rel, `${rel}/index.html`, 'index.html'];

  for (const candidate of candidates) {
    try {
      const filePath = fileURLToPath(new URL(candidate, DIST_DIR));
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.writeHead(200, {
          'Content-Type': STATIC_MIME[ext] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    } catch {
      // 继续尝试下一个候选
    }
  }

  // dist 尚未构建时的友好提示
  if (!fs.existsSync(fileURLToPath(DIST_DIR))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(
      '<!doctype html><meta charset="utf-8"><title>工作台未构建</title>' +
      '<body style="font-family:sans-serif;max-width:640px;margin:80px auto;padding:0 20px;color:#0f172a">' +
      '<h1 style="color:#0d9488">工作台前端尚未构建</h1>' +
      '<p>请在 <code>BioanalysDesktop/</code> 目录执行 <code>npm run build</code> 生成 <code>dist/</code> 后刷新本页。</p>' +
      '<p>开发模式可改用 <code>npm run dev</code>（Vite 监听 5173，API 代理到 18787）。</p>' +
      '</body>'
    );
  }
  return json(res, 404, { error: `静态资源未找到: ${pathname}` });
}

/**
 * 从 pipelineDag 推断分析线：取命中步骤数最多的那条线。
 * 为什么不用 dataType：需求文件可能缺 dataType（旧格式），但步骤 id 是母版固定的。
 */
// 导出供测试：双形态（mod id / 母版名）推断分析线是 M3 的关键兼容层，
// 没有测试钉住的话，未来改 LINE_STEPS 或映射时会静默失配。
export function lineFromPipeline(dag) {
  // 双形态兼容：pipelineDag 的 stepId 既可能是母版名（历史提交、runner 直跑），
  // 也可能是 mod id（mod 化后的客户端，如 l2_tf_scenic）。LINE_STEPS 派生自注册表的
  // script 字段即母版名，所以 mod id 要先经 modScriptIndex 翻成母版名再比对，
  // 否则 mod 化后这里会全部失配、分析线推断为空。
  const modToScript = modToScriptMap();
  const ids = (Array.isArray(dag) ? dag : [])
    .map((d) => d?.stepId)
    .filter(Boolean)
    .map((s) => modToScript.get(s) || s);
  if (!ids.length) return '';
  let best = '';
  let bestHits = 0;
  for (const line of LINES) {
    const hits = ids.filter((s) => LINE_STEPS[line].includes(s)).length;
    if (hits > bestHits) { bestHits = hits; best = line; }
  }
  return best;
}

/**
 * 把客户上传的数据文件从提交包复制到远端项目对应分析线的 raw_data/。
 *
 * 为什么要这一步：用户端上传的文件只落在本机 `portal/inbox/PKG_.../raw_data/`，
 * 不搬过去的话，客户填的 `raw_data/xxx.tsv` 路径在服务器上根本不存在，第一步就会失败。
 *
 * 返回每个文件的部署结果；单个文件失败不中断其余文件，但整体会标记 ok=false，
 * 由调用方把问题如实回给界面（不能假装建项完全成功）。
 */
function deployDataFiles(projectId, lineId, dataFiles) {
  const results = [];
  if (!Array.isArray(dataFiles) || !dataFiles.length) return { ok: true, results };
  if (!lineId) {
    return {
      ok: false,
      results: dataFiles.map((f) => ({
        name: f.name, ok: false,
        error: '无法从 pipelineDag 推断分析线，未部署',
      })),
    };
  }
  for (const file of dataFiles) {
    const src = path.resolve(PORTAL_INBOX, file.path);
    if (!src.startsWith(path.resolve(PORTAL_INBOX) + path.sep) || !fs.existsSync(src)) {
      results.push({ name: file.name, ok: false, error: `提交包内找不到源文件: ${file.path}` });
      continue;
    }
    let remote;
    try {
      remote = remoteRawPath(projectId, lineId, deployedRawName(file));
    } catch (cause) {
      results.push({ name: file.name, ok: false, error: cause.message });
      continue;
    }
    const localSize = fs.statSync(src).size;
    const scp = runSync(
      ['scp', '-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes',
        '-P', '10022', src, `root@127.0.0.1:${remote}`],
      { timeoutMs: 900000 }
    );
    if (scp.code !== 0) {
      results.push({ name: file.name, ok: false, error: `scp 失败: ${scp.stderr || scp.stdout}` });
      continue;
    }
    const stat = runRemote(`stat -c %s '${remote}' 2>/dev/null || echo MISSING`);
    const remoteSize = Number(stat.trim());
    if (!Number.isFinite(remoteSize) || remoteSize !== localSize) {
      results.push({
        name: file.name, ok: false,
        error: `字节校验不符（本地 ${localSize} / 远端 ${Number.isFinite(remoteSize) ? remoteSize : 'MISSING'}）`,
      });
      continue;
    }
    results.push({ name: file.name, ok: true, remotePath: remote, size: localSize });
  }
  return { ok: results.every((r) => r.ok), results };
}

// 位置纪律：routeCtx 必须在所有被注入的辅助之后。它是对象字面量，模块加载期就求值，
// 排在 const 声明之前会踩暂时性死区（PORTAL_INBOX 就这样把服务加载打崩过一次）。
// 路由模块共用的响应辅助与远端执行器。定义仍留在本文件：自检路由的守卫断言按本文件对
// runRemoteStrict 的出现次数计数，搬走会让那条守卫计到假数。以对象注入交给路由模块，
// 是为了不把同一份辅助函数复制进每个模块文件。
const routeCtx = {
  json, uploadError, runRemote, runRemoteRaw, runRemoteStrict, fetchLedgerFromServer, resolveProjectParam,
  REPO_ROOT, listFiguresForLine, listRemoteProcessed, remoteTaskInput,
  // 任务路由需要的进程内状态与 SSE sink：runningTasks 是可变 Map，注入引用而不是复制；
  // validateTaskPaths 与 sanitizeBridgeOutput 的定义留在本文件（tests/task_submit_validation.test.js
  // 按 index.js 取 validateTaskPaths，搬走会拿到 undefined）。
  runningTasks, createSink, sendEvent, closeSink, dropSink, sanitizeBridgeOutput, validateTaskPaths,
  // 项目路由需要的本地读盘与收件箱辅助：定义在本文件，注入而不复制第二份。
  listProjectsWithMeta, deployDataFiles, uploadPreparedFigureScripts, lineFromPipeline,
  PORTAL_INBOX, isSafeManifestName, readPackageManifest, listInboxManifests,
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'bioanalys-desktop', port: PORT });
  }

  if (!isAuthorized(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="BioanalysDesktop", charset="UTF-8"',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    return res.end(JSON.stringify({ error: '需要登录：请输入工作台账号口令' }));
  }

  // 项目与建项路由，处理体在 routes/projects.routes.js
  if (handleProjectRoutes(req, res, url, routeCtx)) {
    return;
  }

  // 诊断路由（自检 / 链路 / 台账 / 文件树），处理体在 routes/diagnostics.routes.js
  if (await handleDiagnosticsRoutes(req, res, url, { ...routeCtx, adb })) {
    return;
  }

  // 图件与图形路由，处理体在 routes/figures.routes.js
  if (handleFiguresRoutes(req, res, url, routeCtx)) {
    return;
  }

  if (url.pathname === '/preview/figures') {
    // 后端自带出图预览界面：服务端直接渲染 HTML 画廊，不依赖前端 React。
    // 浏览器打开 http://127.0.0.1:<PORT>/preview/figures?project=<项目> 即可目视审核图件。
    const projectId = resolveProjectParam(url);
    if (!projectId) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('project 参数非法（只允许字母数字 . _ -）');
      return;
    }
    const sections = LINES.map((lineId) => {
      const result = listFiguresForLine(projectId, lineId);
      return { lineId, ...result };
    });
    const html = renderFiguresPreview(sections, projectId);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
    return;
  }

  if (handleReportRoutes(req, res, url, routeCtx)) return;

  if (handleUploadRoutes(req, res, url, routeCtx)) return;

  // 任务路由（列表 / 下发 / 中止 / 日志流），处理体在 routes/tasks.routes.js
  if (handleTasksRoutes(req, res, url, routeCtx)) {
    return;
  }

  // 非 API 路径：托管管理员工作台前端（dist/），无扩展名按 SPA 回退到 index.html
  if (!url.pathname.startsWith('/api/')) {
    return serveStatic(res, url.pathname);
  }

  return json(res, 404, { error: `未知接口: ${url.pathname}` });
});

// 启动时清一次陈旧上传会话：TTL 24h（BIO_UPLOAD_TTL_HOURS 可覆盖），只删 .uploads 下
// 合法 id 且长期没动过的会话目录。旁路动作，失败只记日志，不能影响服务启动。
try {
  const gcReport = gcStaleUploads();
  if (gcReport.removed.length > 0) {
    console.log(`[bioanalys-desktop] 启动清理陈旧上传会话 ${gcReport.removed.length} 个`);
  }
  for (const err of gcReport.errors) {
    console.warn(`[bioanalys-desktop] 启动清理上传会话出错（已忽略）: ${err.name || '<root>'}: ${err.message}`);
  }
} catch (cause) {
  console.warn(`[bioanalys-desktop] 启动清理上传会话异常（已忽略）: ${cause.message}`);
}

// 探针出口：LINE_INFER_PROBE=<JSON> 时只跑纯函数并打印结果，不监听端口。
// 为什么需要它：lineFromPipeline 的失配只在"有 dataFiles 时才报错"，manifest 不带
// dataFiles 时那条路径根本不执行，HTTP 断言抓不到，会假绿。子进程直调纯函数，失配即红。
// 这里不 import 远端链路，所以在 listen 之前就要分流，避免探针进程白起一个服务。
if (process.env.LINE_INFER_PROBE) {
  const dag = JSON.parse(process.env.LINE_INFER_PROBE);
  process.stdout.write(lineFromPipeline(dag));
} else {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[bioanalys-desktop] backend listening on http://127.0.0.1:${PORT}`);
    console.log(`[bioanalys-desktop] adb = ${adb}`);
  });
}

export { server };
