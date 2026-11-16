/**
 * BioanalysDesktop 后端入口
 *
 * 职责边界（本地零算力红线）：
 *   本地只做三件事：跑 ssh / scp / adb、读写本软件自身配置、给前端提供接口。
 *   除此之外的程序一律不启动（见 server/proc.js 白名单）。
 *   计算命令默认经 ADB 到主算力节点执行，节点信息由环境变量提供。
 */

import './env.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { ASSET_ROOT, DATA_ROOT } from './paths.js';
import { cleanupAuthRuntimeFile } from './auth_runtime.js';
import {
  DEFAULT_SERIAL, SYSTEM_LOGS, LINES, DEFAULT_PROJECT, sanitizeProjectId, projectLineDir,
  PROJECTS_ROOT, resolveLineFromDataType, normalizeDatasets, normalizeDataSource,
} from './domain.js';
import {
  findAdb, runSync, runAsync, runSshAsync, runSshRaw, runSshStrict, scpArgv, shellQuote,
} from './proc.js';
import { prepareAndAuditTask, runTask } from './run.js';
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
import { handleWorkOrdersRoutes } from './routes/work_orders.routes.js';
import { handleAuthorityRoutes } from './routes/authority.routes.js';
import { handlePiOrchestratorRoutes } from './routes/pi_orchestrator.routes.js';
import { startQueue, enqueueWorkOrder } from './services/work_order.service.js';
import { createPiToolsBridge } from './services/pi_tools_bridge.js';
import { PiSupervisor } from './services/pi_supervisor.js';
import { PiJobOrchestrator } from './pi_runner.js';
import { checkK40Preflight } from './services/pi_preflight.js';
import { createPortalSyncReceiver } from './services/portal_sync_receiver.js';
import { createPiStepDispatcher } from './services/pi_step_dispatcher.js';
import { createPiTaskRunner } from './services/pi_task_runner.js';
import { verifyNarrative } from '../../tools/reporting/fact_check_narrative.mjs';
import { assertAuthority, readAuthority, defaultAuthorityFile, acquireAuthority } from './services/authority.service.js';
import { resolvePrincipal } from './auth_principal.js';
import { createSink, dropSink, sendEvent, closeSink } from './sinks.js';
import { fetchLedgerFromServer } from './ledger_fetch.js';
import { renderFiguresPreview } from './portal_page.js';
import { serveStatic } from './static_assets.js';
import { PORTAL_INBOX, isSafeManifestName, readPackageManifest, listInboxManifests } from './portal_inbox.js';
import { resolveProjectParam, listProjectsWithMeta, listFiguresForLine } from './query_views.js';
import { remoteTaskInput, uploadPreparedFigureScripts, deployDataFiles } from './task_input.js';

// D2 轻量接收器实例：由 BIO_PORTAL_SYNC_ENABLED=1 显式开启，默认不联网。
let portalSyncReceiver = null;
import {
  runRemoteRaw, listRemoteProcessed, runRemote, runRemoteStrict, sanitizeBridgeOutput,
} from './remote_exec.js';
import { json, uploadError } from './http_response.js';
import { isLoopbackOriginAllowed } from './origin_guard.js';



const PORT = Number(process.env.BAD_PORT || 18787);
const REPO_ROOT = ASSET_ROOT;

/**
 * 工作台口令（HTTP Basic）。
 * 18787 会经 frp 暴露到公网，frp 从本机 127.0.0.1 回连，服务端无法用来源地址区分内外，
 * 所以只能整站鉴权。安全口径（D-29 Fail-Closed）：
 *   1. 环境变量给了账号口令就强制校验（正式常驻由 tools/ops/serve_guard.ps1 注入）；
 *   2. 非测试环境且未显式 BIO_ALLOW_DEV_NOAUTH=1 时，若未配置口令，自动生成随机强口令
 *      并打印到控制台（仅在显式传入 BIO_AUTH_RUNTIME_FILE 时写该临时文件，退出即删），
 *      消灭免密裸奔；Windows 的 0o600 不生效，所以默认不落盘明文口令；
 *   3. node:test 运行环境（NODE_TEST_CONTEXT 存在）与显式豁免保持免密，测试零改动。
 */
let AUTH_USER = process.env.BAD_AUTH_USER || process.env.WORKBENCH_AUTH_USER || '';
let AUTH_PASS = process.env.BAD_AUTH_PASS || process.env.WORKBENCH_AUTH_PASS || '';
let AUTH_ENABLED = Boolean(AUTH_USER && AUTH_PASS);
// AI 管理员独立凭证：与人工账号分开，回执里的 actor 才具备可追责性。
const AI_AUTH_USER = process.env.BIO_AI_AUTH_USER || '';
const AI_AUTH_PASS = process.env.BIO_AI_AUTH_PASS || '';
const AI_AUTH_ON = Boolean(AI_AUTH_USER && AI_AUTH_PASS);

const IS_TEST_RUNTIME = Boolean(process.env.NODE_TEST_CONTEXT) && process.env.BIO_TEST_FORCE_FAIL_CLOSED !== '1';
const DEV_NOAUTH = process.env.BIO_ALLOW_DEV_NOAUTH === '1';
/**
 * 5.6 加固（2026-11-01）：清理上一个已死进程留下的明文口令文件。
 *
 * 为什么需要：退出即焚只覆盖正常 exit / SIGINT / SIGTERM。遇到 Windows 的
 * taskkill /F、掉电或宿主强杀，exit 钩子不会跑，明文 JSON 就会永久留在磁盘上。
 * 所以每次启动先校验文件里记录的 pid：进程已死即判废并删除，再写新的。
 */
function purgeStaleRuntimeAuthFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    const previous = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const pid = Number(previous.pid);
    let alive = false;
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); alive = true; } catch { alive = false; }
    }
    if (alive && pid === process.pid) return false;
    if (alive) return false; // 别的实例还活着，不动它的口令文件
    fs.rmSync(filePath, { force: true });
    return true;
  } catch {
    // 文件损坏同样判废：读不出 pid 的明文口令不该继续留在盘上
    try { fs.rmSync(filePath, { force: true }); } catch { /* 忽略 */ }
    return true;
  }
}
if (!AUTH_ENABLED && !IS_TEST_RUNTIME && !DEV_NOAUTH) {
  AUTH_USER = 'admin';
  AUTH_PASS = randomBytes(18).toString('base64url');
  AUTH_ENABLED = true;
  // 5.6（2026-11-01）：明文口令不再进 stderr。tools/ops/serve_guard.ps1 用
  // -RedirectStandardError 持久化 stderr，口令打 stderr 等于落盘 cn_debug/workbench_err.log。
  // 改为一律写运行时口令文件（退出即焚），人读口令走 node server/print_runtime_auth.js。
  if (!process.env.BIO_AUTH_RUNTIME_FILE) {
    process.env.BIO_AUTH_RUNTIME_FILE = path.join(os.homedir(), '.bioanalys', 'workbench_failclosed.json');
  }
  console.error('[SECURITY][D-29 Fail-Closed] 未检测到 BAD_AUTH_USER/BAD_AUTH_PASS，已启用临时会话强鉴权。');
  console.error(`[SECURITY] 随机口令已写入运行时文件（退出即焚）：${process.env.BIO_AUTH_RUNTIME_FILE}；查看口令用 node server/print_runtime_auth.js；正式部署用 serve_guard 注入固定口令。`);
  fs.mkdirSync(path.dirname(process.env.BIO_AUTH_RUNTIME_FILE), { recursive: true });
  purgeStaleRuntimeAuthFile(process.env.BIO_AUTH_RUNTIME_FILE);
  fs.writeFileSync(process.env.BIO_AUTH_RUNTIME_FILE, JSON.stringify({
    user: AUTH_USER, pass: AUTH_PASS, enabled: true, pid: process.pid, generatedAt: new Date().toISOString(),
  }), 'utf8');
  process.once('exit', () => cleanupAuthRuntimeFile());
  process.once('SIGINT', () => { portalSyncReceiver?.stop(); cleanupAuthRuntimeFile(); process.exit(130); });
  process.once('SIGTERM', () => { portalSyncReceiver?.stop(); cleanupAuthRuntimeFile(); process.exit(143); });
}

// TICKET-D0-01：Electron 主进程强杀时 stdin 会先断开，后端据此自杀，
// 避免 Node 子进程变成孤儿并继续占 SQLite 写锁与 ADB 轮询通道。
if (process.env.BIO_DEATH_PIPE === '1') {
  process.stdin.resume();
  process.stdin.on('end', () => {
    portalSyncReceiver?.stop();
    cleanupAuthRuntimeFile();
    process.exit(0);
  });
  process.stdin.on('error', () => process.exit(1));
}

/**
 * 当前请求的认证主体。身份真源只在这里，路由与 service 都消费它的结果。
 * 人工与 AI 使用独立凭证；两类凭证都未配置时按本地信任环境处理（与改造前一致）。
 */
function currentActor(req) {
  return resolvePrincipal(req, {
    humanUser: AUTH_USER,
    humanPass: AUTH_PASS,
    aiUser: AI_AUTH_USER,
    aiPass: AI_AUTH_PASS,
    devNoAuth: !AUTH_ENABLED && !AI_AUTH_ON,
  }).actor;
}

function isAuthorized(req) {
  if (!AUTH_ENABLED && !AI_AUTH_ON) return true;
  return Boolean(currentActor(req));
}

const adb = findAdb();

/** 在跑的任务表：id -> {kill, projectId, lineId, step, startedAt}，中止与去重都靠它 */
const runningTasks = new Map();

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

// 位置纪律：routeCtx 必须在所有被注入的辅助之后。它是对象字面量，模块加载期就求值，
// 排在 const 声明之前会踩暂时性死区（PORTAL_INBOX 就这样把服务加载打崩过一次）。
// 路由模块共用的响应辅助、远端执行器与前置层辅助，全部从各自模块 import 进来，
// 再以对象注入交给路由模块。远端执行器定义在 remote_exec.js，响应辅助在 http_response.js；
// 相关静态守卫按并集计数，见 tests/selfcheck_isolation_merge.test.js 的 STRICT_GUARD_SRC。
const AUTHORITY_FILE = process.env.BIO_AUTHORITY_FILE || defaultAuthorityFile();

/**
 * Pi 受控工具桥：只读摘要 + 指标卡 + 报告核验，不具任何通用执行能力。
 *
 * 注入给路由层而不是让路由自己造：同一个后端进程里只应有一份桥，
 * 否则台账写入与白名单校验会出现两份口径。收件箱与项目根走路径真源，
 * 桌面打包后自动跟随 data/ 而不是 assets/。
 */
/** D4.9 接线第 1 步：单权威租约校验（三个工单写端点共用）。 */
function assertLeaseFn(leaseId) {
  try {
    assertAuthority(String(leaseId || ''), { file: AUTHORITY_FILE });
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error?.code || 'ERR_AUTHORITY_REQUIRED' };
  }
}

function currentLeaseId() {
  try {
    return String(readAuthority({ file: AUTHORITY_FILE })?.lease_id || '');
  } catch {
    return '';
  }
}

/** 适配脚本 Overlay：本地 scripts/adapt_* 推到算力面项目线 scripts/。 */
async function pushAdaptationScript({ projectId, lineId, entryPoint, localScriptPath }) {
  const remoteDir = `${projectLineDir(projectId, lineId)}/scripts`;
  const remotePath = `${remoteDir}/${entryPoint}`;
  const mkdir = await runSshAsync('k40-ubuntu', `mkdir -p ${shellQuote(remoteDir)}`, { timeoutMs: 40000 });
  if (mkdir.code !== 0) throw new Error(`远端 scripts 目录创建失败: ${mkdir.text || mkdir.stderr || mkdir.code}`);
  const scp = await runAsync(scpArgv(localScriptPath, remotePath), { timeoutMs: 300000 });
  if (scp.code !== 0) throw new Error(`适配脚本上传失败: ${scp.stderr || scp.stdout || scp.code}`);
  return { remotePath };
}

const piTaskRunner = createPiTaskRunner({
  prepareTaskFn: prepareAndAuditTask,
  runTaskFn: runTask,
  pushScriptFn: pushAdaptationScript,
});

const piStepDispatcher = createPiStepDispatcher({
  baseDir: DATA_ROOT,
  assertLease: assertLeaseFn,
  runTaskFn: async (request) => {
    if (request.mode === 'validation') {
      return piTaskRunner.runValidationTask({
        ...request,
        localScriptPath: request.scriptPath,
      });
    }
    return piTaskRunner.runDispatchTask({
      ...request,
      localScriptPath: path.join(DATA_ROOT, 'workspace', 'projects', request.projectId, 'scripts', request.entryPoint),
    });
  },
});

function appendActionLedger(entry) {
  // 追加式写入：失败只记一行警告，不让审计写盘故障阻断业务（台账不是业务闸门）。
  try {
    const ledgerDir = path.join(DATA_ROOT, 'ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.appendFileSync(
      path.join(ledgerDir, 'actions.jsonl'),
      JSON.stringify({
        id: `ACT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        type: 'action',
        ...entry,
      }) + '\n',
      'utf8',
    );
  } catch (error) {
    console.warn('[pi] 台账写入失败：' + error.message);
  }
}

const piToolsBridge = createPiToolsBridge({
  inboxRoot: PORTAL_INBOX,
  workspaceRoot: path.join(DATA_ROOT, 'workspace', 'projects'),
  workflowsPath: path.join(ASSET_ROOT, 'tools', 'bio', 'workflows.json'),
  figureAllowlistPath: path.join(ASSET_ROOT, 'tools', 'dev', 'figure_ready_allowlist.json'),
  assertLease: assertLeaseFn,
  // D4.9 接线第 3、4 步：验证与生产单步执行器（租约取自当前活跃租约）。
  runValidationFn: (args) => piStepDispatcher.runValidation({ ...args, leaseId: args.leaseId || currentLeaseId() }),
  dispatchStepFn: (args) => piStepDispatcher.dispatchStep(args),
  // D4.9 接线第 2 步：项目授权读取器（from-package 时落盘到项目根）。
  autonomyGrantsProvider: (projectId) => {
    const file = path.join(DATA_ROOT, 'workspace', 'projects', String(projectId), '.autonomy_grants.json');
    try {
      const grants = JSON.parse(fs.readFileSync(file, 'utf8'));
      return grants && typeof grants === 'object' ? grants : { allow_l3_data_adaptation: false };
    } catch {
      return { allow_l3_data_adaptation: false };
    }
  },
  ledgerAppend: appendActionLedger,
  narrativeVerifier: ({ narrative, metricsCards, figureAllowlistPath }) => {
    const verdict = verifyNarrative({ narrative, metricsCards, allowlistPath: figureAllowlistPath });
    return {
      ok: verdict.ok,
      reason: verdict.reason,
      unboundedMetrics: verdict.unboundedMetrics,
      unresolvedSlots: verdict.unresolvedSlots,
      unreadyFigures: verdict.unreadyFigures,
      slotCount: verdict.slotCount,
      figureCount: verdict.figureCount,
      audit: verdict.audit,
    };
  },
});

// 检查点一 180 秒宽限的驱动源：面板只展示与拦截，自动放行由服务端按单一真源扫描。
const piSupervisor = new PiSupervisor({
  toolsBridge: piToolsBridge,
  ledgerAppend: appendActionLedger,
  onPlanApproved: (session) => {
    const workOrderId = session?.work_order_id;
    if (!workOrderId) return;
    try {
      const lease = acquireAuthority(
        { kind: 'ai_assist', id: 'pi_cli', role: 'agent' },
        { file: AUTHORITY_FILE },
      );
      enqueueWorkOrder(workOrderId, DATA_ROOT, {
        approved: true,
        actor: { kind: 'ai_assist', id: 'pi_cli', role: 'agent' },
        leaseId: lease.lease_id,
      });
      console.log(`[pi] 检查点一放行自动入队: ${workOrderId}`);
    } catch (error) {
      console.warn(`[pi] 检查点一自动入队失败 ${workOrderId}: ${error.message}`);
      throw error;
    }
  },
});
const piAutonomyTimer = setInterval(() => {
  try {
    const approved = piSupervisor.autoPassDuePlans({
      // 外部工单与本地会话都不许通过 context 注入 golden_regression；
      // 黄金回归豁免只在测试构造的会话里置位。
      factsProvider: (session) => (session?.context?.plan_facts && typeof session.context.plan_facts === 'object'
        ? { ...session.context.plan_facts, goldenRegression: false }
        : {}),
    });
    if (approved.length > 0) {
      console.log(`[pi] 检查点一宽限到期自动放行: ${approved.join(', ')}`);
    }
  } catch (error) {
    console.warn('[pi] 宽限扫描失败：' + error.message);
  }
}, 15_000);
piAutonomyTimer.unref?.();

// Stage 2 自愈用独立 Pi 作业编排器：与路由层的 Pi 会话共享同一份工具桥。
const piOrchestrator = new PiJobOrchestrator({
  toolExecutor: async ({ stage, toolName, args }) => piToolsBridge.executeToolCall(stage, toolName, args),
});

// D2 轻量接收器：显式开关 + 门户地址 + SYNC_TOKEN 三件齐备才启动。
if (process.env.BIO_PORTAL_SYNC_ENABLED === '1') {
  const portalBaseUrl = String(process.env.BIO_PORTAL_SYNC_URL || '').trim();
  const syncToken = String(process.env.SYNC_TOKEN || '').trim();
  if (!portalBaseUrl || !syncToken) {
    console.warn('[portal-sync] BIO_PORTAL_SYNC_ENABLED=1 但缺少 BIO_PORTAL_SYNC_URL 或 SYNC_TOKEN，接收器未启动');
  } else {
    portalSyncReceiver = createPortalSyncReceiver({
      portalBaseUrl,
      syncToken,
      inboxRoot: PORTAL_INBOX,
      cacheDir: path.join(DATA_ROOT, 'portal', 'sync_cache'),
    });
  }
}

const routeCtx = {
  json, uploadError, runRemote, runRemoteRaw, runRemoteStrict, fetchLedgerFromServer, resolveProjectParam,
  REPO_ROOT, DATA_ROOT, listFiguresForLine, listRemoteProcessed, remoteTaskInput,
  // 任务路由需要的进程内状态与 SSE sink：runningTasks 是可变 Map，注入引用而不是复制；
  // validateTaskPaths 的定义必须留在本文件（tests/task_submit_validation.test.js 按 index.js
  // 取它，搬走会拿到 undefined）；sanitizeBridgeOutput 已搬进 remote_exec.js。
  runningTasks, createSink, sendEvent, closeSink, dropSink, sanitizeBridgeOutput, validateTaskPaths,
  // 项目路由需要的本地读盘与收件箱辅助：从前置层模块引入，注入而不复制第二份。
  listProjectsWithMeta, deployDataFiles, uploadPreparedFigureScripts, lineFromPipeline,
  PORTAL_INBOX, isSafeManifestName, readPackageManifest, listInboxManifests,
  // Pi 监督器共享同一份工具桥与台账写入：路由与监督器不得各造一份。
  piToolsBridge, piSupervisor,
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (!isLoopbackOriginAllowed(req.headers)) {
    return json(res, 403, { error: '跨源请求被拒绝' });
  }

  // 顶层异常兜底（2026-11-11 P1）：路由层任何未捕获异常（含 decodeURIComponent
  // 的 URIError、statSync 的 ENOENT）都收敛成 500，不让单个请求把后端带崩、
  // 连带杀掉正在跑的分析任务。
  try {
    await handleRequest(req, res, url);
  } catch (cause) {
    console.error(`[http] 未捕获异常: ${req.method} ${url.pathname}: ${cause instanceof Error ? cause.stack : cause}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '服务器内部错误（详见服务端日志）' }));
    } else {
      res.end();
    }
  }
});

async function handleRequest(req, res, url) {

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

  // 每个请求解析一次主体：人工、AI 与本地信任环境都在这里定性，下游不再重复解析。
  const requestCtx = { ...routeCtx, actor: currentActor(req), authorityFile: AUTHORITY_FILE };

  // 租约路由（读取 / 获取 / 续租 / 释放 / 人工接管）
  if (await handleAuthorityRoutes(req, res, url, requestCtx)) {
    return;
  }

  // Pi Agent RPC 调度、双人工刹车片审批与监督会话路由
  if (await handlePiOrchestratorRoutes(req, res, url, requestCtx)) {
    return;
  }

  // 项目与建项路由，处理体在 routes/projects.routes.js
  if (await handleProjectRoutes(req, res, url, requestCtx)) {
    return;
  }

  // 作业中心路由（创建 / 列表 / 执行 / 回执），处理体在 routes/work_orders.routes.js
  if (await handleWorkOrdersRoutes(req, res, url, requestCtx)) {
    return;
  }

  // 诊断路由（自检 / 链路 / 台账 / 文件树），处理体在 routes/diagnostics.routes.js
  if (await handleDiagnosticsRoutes(req, res, url, { ...routeCtx, adb })) {
    return;
  }

  // 图件与图形路由，处理体在 routes/figures.routes.js
  if (await handleFiguresRoutes(req, res, url, routeCtx)) {
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

  if (await handleReportRoutes(req, res, url, routeCtx)) return;

  if (await handleUploadRoutes(req, res, url, routeCtx)) return;

  // 任务路由（列表 / 下发 / 中止 / 日志流），处理体在 routes/tasks.routes.js
  if (await handleTasksRoutes(req, res, url, routeCtx)) {
    return;
  }

  // 非 API 路径：托管管理员工作台前端（dist/），无扩展名按 SPA 回退到 index.html
  if (!url.pathname.startsWith('/api/')) {
    return serveStatic(res, url.pathname);
  }

  return json(res, 404, { error: `未知接口: ${url.pathname}` });
}

// 清一次陈旧上传会话：TTL 24h（BIO_UPLOAD_TTL_HOURS 可覆盖），只删 .uploads 下
// 合法 id 且长期没动过的会话目录。旁路动作，失败只记日志，不能影响服务启动。
// 08 号书第 7 项：这段同步目录扫描原本压在 listen 之前，冷启动被它拖住；
// 现在挪到 listen 回调里用 setImmediate 执行，端口先开，扫描随后跑。
function runStartupUploadGc() {
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
}

// 探针出口：LINE_INFER_PROBE=<JSON> 时只跑纯函数并打印结果，不监听端口。
// 为什么需要它：lineFromPipeline 的失配只在"有 dataFiles 时才报错"，manifest 不带
// dataFiles 时那条路径根本不执行，HTTP 断言抓不到，会假绿。子进程直调纯函数，失配即红。
// 这里不 import 远端链路，所以在 listen 之前就要分流，避免探针进程白起一个服务。
if (process.env.LINE_INFER_PROBE) {
  const dag = JSON.parse(process.env.LINE_INFER_PROBE);
  process.stdout.write(lineFromPipeline(dag));
} else {
  // 桌面壳的优雅停机通道：父进程经 IPC 发 shutdown，先关监听再退出。
  // 父进程死掉（disconnect）时也退出，避免留下看不见的后台服务。
  if (typeof process.send === 'function') {
    process.on('message', (message) => {
      if (message && message.type === 'shutdown') {
        try {
          server.close(() => process.exit(0));
          setTimeout(() => process.exit(0), 3000).unref();
        } catch {
          process.exit(0);
        }
      }
    });
    process.on('disconnect', () => process.exit(0));
  }
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[bioanalys-desktop] backend listening on http://127.0.0.1:${PORT}`);
    console.log(`[bioanalys-desktop] adb = ${adb}`);
    setImmediate(() => {
      runStartupUploadGc();
      if (portalSyncReceiver) {
        const started = portalSyncReceiver.start();
        console.log(`[portal-sync] 接收器已启动（${started.started ? 'first_start' : 'already_running'}）`);
      }
      if (!IS_TEST_RUNTIME) {
        const headers = AUTH_ENABLED
          ? { Authorization: `Basic ${Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString('base64')}` }
          : {};
        startQueue(DATA_ROOT, {
          baseUrl: `http://127.0.0.1:${PORT}`,
          headers,
          idlePollMs: 1000,
          remediateTask: async ({ workOrderId, projectId, lineId, task, expected, receipt, receiptProblems }) => {
            const exitCode = Number(receipt?.exit_code);
            if (exitCode === 5) {
              // Exit 5 是环境限流，不是算法失败；不消耗适配预算，交给外层退避。
              return { resolved: false, resolution: 'ENV_THROTTLED', reason: 'exit 5' };
            }
            const metaPath = path.join(
              DATA_ROOT, 'workspace', 'projects', String(projectId), 'work_orders', `${workOrderId}.meta.json`,
            );
            let leaseId = '';
            try {
              leaseId = String(JSON.parse(fs.readFileSync(metaPath, 'utf8')).lease_id || '');
            } catch {
              leaseId = '';
            }
            const job = await piOrchestrator.runStage2Remediation({
              workOrderId,
              projectId,
              lineId,
              failedStep: task.step,
              modId: expected.modId,
              leaseId,
              context: {
                entry_point: task.step,
                failure_reason: Array.isArray(receiptProblems) ? receiptProblems.join('; ') : '',
              },
            }, {
              timeoutMs: 600_000,
            });
            const output = job.context?.STAGE_3_COMPUTE_PULL_output || {};
            return {
              resolved: output.resolution === 'RECOVERED',
              resolution: output.resolution || 'UNKNOWN',
              reason: output.reason || job.last_error || null,
              adaptation_trace: output.adaptation_trace || [],
            };
          },
        });
        // TICKET-OPS-01：开机自检脚本哈希与 limma 探活；失败只告警，不阻断控制台启动。
        try {
          const preflight = checkK40Preflight({ runRemote });
          if (preflight.ok) {
            console.log('[pi] K40 preflight OK：脚本哈希同源，limma 可加载');
          } else {
            console.warn(`[pi] K40 preflight 失败：${preflight.error || preflight.mismatches.join(', ') || 'limma unavailable'}`);
          }
        } catch (error) {
          console.warn(`[pi] K40 preflight 异常：${error.message}`);
        }
      }
    });
  });
}

// T0-6：runningTasks 必须可观测。幽灵任务位的回收断言（tests/task_slot_reclaim.test.js）
// 需要在进程外读到这张表；导出的是同一个可变 Map 引用，不是副本。
export { server, runningTasks };
