/**
 * BioanalysDesktop/server/routes/pi_orchestrator.routes.js
 * Pi Agent RPC 调度、双人工刹车片审批与监督会话路由。
 *
 * 端点（无状态 RPC 作业簿，pi_runner.js 驱动）：
 *   GET  /api/pi/jobs
 *   GET  /api/pi/jobs/:id
 *   GET  /api/pi/jobs/:id/events   (SSE 实时流)
 *   POST /api/pi/jobs/start
 *   POST /api/pi/jobs/start-intake          Stage 1：Pi 读需求并编译工单
 *   POST /api/pi/jobs/:id/approve-external
 *   POST /api/pi/jobs/:id/approve-acceptance
 *   POST /api/pi/jobs/:id/package-delivery
 *
 * 端点（监督会话，六工具白名单 + 双检查点，pi_supervisor.js 驱动）：
 *   GET  /api/pi/sessions
 *   GET  /api/pi/sessions/resumable
 *   GET  /api/pi/sessions/:id
 *   POST /api/pi/sessions/start
 *   POST /api/pi/sessions/:id/plan            提交立项方案（进入检查点一待批准）
 *   POST /api/pi/sessions/:id/approve-plan    检查点一批准（必须留 actor）
 *   POST /api/pi/sessions/:id/reject-plan     检查点一驳回（必须写理由）
 *   POST /api/pi/sessions/:id/dispatch        检查点一批准后才许下发 DAG
 *   POST /api/pi/sessions/:id/targets         提交 1–3 个待锁定靶点（进入检查点二）
 *   POST /api/pi/sessions/:id/approve-targets 检查点二批准
 *   POST /api/pi/sessions/:id/report-signed   检查点二批准后才许签发报告
 *   POST /api/pi/sessions/:id/tool            受控工具调用（越权一律 403）
 */
import { collectJsonBody, runJsonRoute, JSON_BODY_LIMIT } from '../http_body.js';
import { PiJobOrchestrator } from '../pi_runner.js';
import { composeStandaloneReport } from '../services/report_composer.js';
import { packageDeliverables } from '../services/delivery_packager.js';
import { PiSupervisor, getSession, listCheckpoints, listToolCalls } from '../services/pi_supervisor.js';
import { assertAuthority, takeoverAuthority } from '../services/authority.service.js';
import { DATA_ROOT, assetPath } from '../paths.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyDelivery } from '../../../tools/reporting/ed25519_tools.mjs';
import { wipeProjectSandbox } from '../services/pi_wipe.js';

let defaultOrchestrator = null;
function getOrchestrator(ctx = {}) {
  if (ctx.piOrchestrator) return ctx.piOrchestrator;
  if (!defaultOrchestrator) {
    defaultOrchestrator = new PiJobOrchestrator({
      toolExecutor: ctx.piToolsBridge
        ? async ({ stage, toolName, args }) => ctx.piToolsBridge.executeToolCall(stage, toolName, args)
        : null,
    });
  }
  return defaultOrchestrator;
}

let defaultSupervisor = null;
function getSupervisor(ctx = {}) {
  if (ctx.piSupervisor) return ctx.piSupervisor;
  if (!defaultSupervisor) {
    defaultSupervisor = new PiSupervisor({
      toolsBridge: ctx.piToolsBridge || null,
      ledgerAppend: ctx.ledgerAppend || (() => {}),
    });
  }
  return defaultSupervisor;
}

const ADAPTATION_ENTRY_RE = /^adapt_[A-Za-z0-9._-]{1,80}\.(R|py)$/;

function workspaceProjectsRoot(ctx = {}) {
  return ctx.workspaceProjectsRoot || path.join(DATA_ROOT, 'workspace', 'projects');
}

function projectScriptsDir(projectId, ctx = {}) {
  return path.join(workspaceProjectsRoot(ctx), String(projectId), 'scripts');
}

function readScriptsManifest(projectId, ctx = {}) {
  const file = path.join(projectScriptsDir(projectId, ctx), 'scripts_manifest.json');
  if (!fs.existsSync(file)) return { file, manifest: { scripts: [] } };
  try {
    return { file, manifest: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { file, manifest: { scripts: [] } };
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** 适配提案视图：脚本 + 登记 + 验证状态，供桌面三栏弹窗渲染。 */
function listAdaptationProposals(session, ctx = {}) {
  const { manifest } = readScriptsManifest(session.project_id, ctx);
  const scriptsDir = projectScriptsDir(session.project_id, ctx);
  return (manifest.scripts || []).map((entry) => {
    const scriptFile = path.join(scriptsDir, String(entry.entry_point || ''));
    const verifiedFile = path.join(scriptsDir, '.val_tmp', `${entry.entry_point}.verified.json`);
    let verified = null;
    if (fs.existsSync(verifiedFile)) {
      try { verified = JSON.parse(fs.readFileSync(verifiedFile, 'utf8')); } catch { verified = null; }
    }
    return {
      entry_point: entry.entry_point,
      upstream_mod: entry.upstream_mod || null,
      purpose: entry.purpose || '',
      reason: entry.reason || '',
      sha256: entry.sha256 || null,
      exists: fs.existsSync(scriptFile),
      current_sha256: fs.existsSync(scriptFile) ? sha256File(scriptFile) : null,
      verified: verified ? {
        verdict: verified.verdict,
        validated_at: verified.validated_at,
        memory_cap_gb: verified.memory_cap_gb,
        timeout_cap_sec: verified.timeout_cap_sec,
      } : null,
    };
  });
}

function appendActionLedger(entry) {
  try {
    const ledgerDir = path.join(DATA_ROOT, 'ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.appendFileSync(
      path.join(ledgerDir, 'actions.jsonl'),
      `${JSON.stringify({ id: `ACT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ts: new Date().toISOString(), ...entry })}\n`,
      'utf8',
    );
  } catch {
    // 台账失败不阻断业务，与工具桥同口径。
  }
}

/** 提案决定：approve 保留脚本并留痕；reject 移除登记、删除脚本与验证记录。 */
function decideAdaptationProposal(session, entryPoint, { action, comment, actor, leaseId, ctx = {} }) {
  if (!ADAPTATION_ENTRY_RE.test(entryPoint)) {
    const err = new Error(`适配提案名非法: ${entryPoint}`);
    err.code = 'PI_PROPOSAL_INVALID';
    throw err;
  }
  const scriptsDir = projectScriptsDir(session.project_id, ctx);
  const { file: manifestFile, manifest } = readScriptsManifest(session.project_id, ctx);
  const index = (manifest.scripts || []).findIndex((item) => item && item.entry_point === entryPoint);
  if (index < 0) {
    const err = new Error(`适配提案不存在: ${entryPoint}`);
    err.code = 'PI_PROPOSAL_NOT_FOUND';
    throw err;
  }

  if (action === 'approve') {
    manifest.scripts[index].approved_by = actor || 'unknown';
    manifest.scripts[index].approved_at = new Date().toISOString();
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  } else {
    manifest.scripts.splice(index, 1);
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const scriptFile = path.join(scriptsDir, entryPoint);
    const verifiedFile = path.join(scriptsDir, '.val_tmp', `${entryPoint}.verified.json`);
    try { fs.rmSync(scriptFile, { force: true }); } catch { /* 已不存在 */ }
    try { fs.rmSync(verifiedFile, { force: true }); } catch { /* 已不存在 */ }
  }

  appendActionLedger({
    kind: 'pi_proposal_decision',
    action: `proposal_${action}`,
    detail: {
      session_id: session.session_id,
      project_id: session.project_id,
      entry_point: entryPoint,
      actor: actor || null,
      lease_id: leaseId || null,
      comment: comment || '',
    },
  });
  return {
    action,
    entry_point: entryPoint,
    proposals: listAdaptationProposals(session, ctx),
  };
}

/**
 * POST 处理体的统一壳：采集 JSON 体 → 解析 → 交给 handler。
 *
 * 为什么不用 runJsonRoute 的旧五参形态：http_body.js 的 runJsonRoute 签名是
 * (run, res, json)，只负责把异步处理体抛错收敛成 500，请求体采集归 collectJsonBody。
 * 两者职责分开后，413 短路与 500 收敛各有唯一出口。
 */
function withJsonBody(req, res, json, handler) {
  return runJsonRoute(async () => {
    const raw = await collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT });
    // null 表示已短路（413 / 客户端断开 / 流错误），再写响应会 ERR_HTTP_HEADERS_SENT
    if (raw === null) return;
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch (cause) {
      json(res, 400, { ok: false, error: `请求体不是合法 JSON: ${cause.message}` });
      return;
    }
    await handler(body || {});
  }, res, json);
}

/** 监督器错误到 HTTP 状态码的映射：状态机冲突是 409，参数面是 400，越权是 403。 */
function supervisorStatus(code) {
  if (code === 'INVALID_STATE_TRANSITION') return 409;
  if (code === 'PI_TOOL_NOT_ALLOWED') return 403;
  if (code === 'CHECKPOINT_ACTOR_REQUIRED' || code === 'CHECKPOINT_REASON_REQUIRED') return 400;
  if (code === 'ERR_DEGRADED_STATS_REQUIRE_OVERRIDE') return 409;
  if (code === 'PI_PROPOSAL_NOT_FOUND') return 404;
  if (typeof code === 'string' && code.startsWith('ERR_AUTHORITY')) return 409;
  return 400;
}

function jsonError(json, res, err) {
  const code = err?.code || null;
  json(res, supervisorStatus(code), {
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    code,
  });
}

export async function handlePiOrchestratorRoutes(req, res, url, ctx = {}) {
  const { json } = ctx;
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/pi/')) return false;

  // 监督会话路由先判定：/api/pi/sessions 不得被下面的 jobs 分支吞掉。
  if (pathname.startsWith('/api/pi/sessions')) {
    return handleSessionRoutes(req, res, ctx);
  }

  const orch = getOrchestrator(ctx);

  if (pathname === '/api/pi/jobs' && req.method === 'GET') {
    json(res, 200, { ok: true, jobs: orch.listJobs() });
    return true;
  }

  if (pathname === '/api/pi/jobs/start' && req.method === 'POST') {
    withJsonBody(req, res, json, async (body) => {
      try {
        const job = await orch.startFromIntake(body, { jobId: body.job_id });
        json(res, 200, { ok: true, job });
      } catch (err) {
        json(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
    return true;
  }

  if (pathname === '/api/pi/jobs/start-intake' && req.method === 'POST') {
    withJsonBody(req, res, json, async (body) => {
      try {
        const job = await orch.runStage1Intake(body, { jobId: body.job_id });
        json(res, 200, { ok: true, job });
      } catch (err) {
        json(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
    return true;
  }

  const jobMatch = pathname.match(/^\/api\/pi\/jobs\/([A-Za-z0-9_-]+)$/);
  if (jobMatch && req.method === 'GET') {
    const jobId = jobMatch[1];
    const job = orch.getJob(jobId);
    if (!job) {
      json(res, 404, { ok: false, error: `任务不存在: ${jobId}` });
      return true;
    }
    json(res, 200, { ok: true, job, events: orch.listEvents(jobId) });
    return true;
  }

  const sseMatch = pathname.match(/^\/api\/pi\/jobs\/([A-Za-z0-9_-]+)\/events$/);
  if (sseMatch && req.method === 'GET') {
    const jobId = sseMatch[1];
    const job = orch.getJob(jobId);
    if (!job) {
      json(res, 404, { ok: false, error: `任务不存在: ${jobId}` });
      return true;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    const history = orch.listEvents(jobId);
    for (const evt of history) {
      res.write(`id: ${evt.id}\nevent: ${evt.event_type}\ndata: ${JSON.stringify(evt)}\n\n`);
    }

    const onEvent = (evt) => {
      if (!res.writableEnded) {
        res.write(`id: ${evt.id}\nevent: ${evt.event_type}\ndata: ${JSON.stringify(evt)}\n\n`);
      }
    };
    orch.on(`job:${jobId}`, onEvent);
    req.on('close', () => {
      orch.off(`job:${jobId}`, onEvent);
    });
    return true;
  }

  const extMatch = pathname.match(/^\/api\/pi\/jobs\/([A-Za-z0-9_-]+)\/approve-external$/);
  if (extMatch && req.method === 'POST') {
    const jobId = extMatch[1];
    withJsonBody(req, res, json, async (body) => {
      try {
        const actor = String(body.actor || 'operator');
        const job = await orch.approveExternalDownload(jobId, actor);
        json(res, 200, { ok: true, job });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        json(res, msg.includes('INVALID_STATE_TRANSITION') ? 409 : 400, { ok: false, error: msg });
      }
    });
    return true;
  }

  const accMatch = pathname.match(/^\/api\/pi\/jobs\/([A-Za-z0-9_-]+)\/approve-acceptance$/);
  if (accMatch && req.method === 'POST') {
    const jobId = accMatch[1];
    withJsonBody(req, res, json, async (body) => {
      try {
        const actor = String(body.actor || 'operator');
        const job = await orch.approveFinalAcceptance(jobId, actor, { summaryPaths: body.summaryPaths });
        json(res, 200, { ok: true, job });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes('INVALID_STATE_TRANSITION') ? 409
          : (msg.includes('TOKEN_BOUNDARY_VIOLATION') ? 422 : 400);
        json(res, status, { ok: false, error: msg });
      }
    });
    return true;
  }

  const pkgMatch = pathname.match(/^\/api\/pi\/jobs\/([A-Za-z0-9_-]+)\/package-delivery$/);
  if (pkgMatch && req.method === 'POST') {
    const jobId = pkgMatch[1];
    withJsonBody(req, res, json, async (body) => {
      try {
        const composed = composeStandaloneReport({
          jobId,
          title: body.title,
          narrativeText: body.narrativeText || '',
          summaryStats: body.summaryStats || {},
          topDegsTsv: body.topDegsTsv || '',
          enrichmentTsv: body.enrichmentTsv || '',
          figures: Array.isArray(body.figures) ? body.figures : [],
        });
        const packed = packageDeliverables({
          jobId,
          reportHtml: composed.html,
          reportMarkdown: composed.markdown,
          summaryFiles: Array.isArray(body.summaryFiles) ? body.summaryFiles : [],
          figureFiles: Array.isArray(body.figureFiles) ? body.figureFiles : [],
          actor: String(body.actor || 'operator'),
          deliveryGrade: body.deliveryGrade || 'STANDARD_VERIFIED',
          adaptationTrace: Array.isArray(body.adaptationTrace) ? body.adaptationTrace : [],
        });
        let wipe = null;
        let deliveryVerified = null;
        if (body.projectId) {
          const publicKeyPath = process.env.BIO_ED25519_PUBLIC_KEY_PATH
            || assetPath('tools', 'ops', 'secrets', 'ed25519_public.pem');
          const verdict = verifyDelivery(packed.deliverableDir, { publicKeyPath });
          deliveryVerified = verdict.ok === true;
          if (deliveryVerified) {
            wipe = wipeProjectSandbox(String(body.projectId), {
              runRemote: ctx.runRemote,
              dataRoot: DATA_ROOT,
              token: `VERIFIED_AT_${new Date().toISOString()}`,
            });
          }
        }
        json(res, 200, { ok: true, ...packed, delivery_verified: deliveryVerified, wipe });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = (msg.includes('FACT_CHECK_HALLUCINATION_ABORT')
          || msg.includes('REDACTION_LEAK_ABORT')
          || msg.includes('COMPOSITE_FIGURE_FORBIDDEN')
          || msg.includes('ERR_NARRATIVE_HALLUCINATION_DETECTED')) ? 422 : 400;
        json(res, status, { ok: false, error: msg });
      }
    });
    return true;
  }

  return false;
}

/**
 * 监督会话路由实现。
 *
 * 设计约束：
 *   1. 每个状态变更端点只做一件事，判定放在 PiSupervisor（单一真源）；
 *   2. 批准类端点必须带 actor，缺 actor 由 supervisor 抛 CHECKPOINT_ACTOR_REQUIRED；
 *   3. 工具调用端点把越权错误映射成 403。
 */
async function handleSessionRoutes(req, res, ctx) {
  const { json } = ctx;
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;
  const sup = getSupervisor(ctx);

  if ((pathname === '/api/pi/sessions' || pathname === '/api/pi/sessions/resumable') && req.method === 'GET') {
    json(res, 200, { ok: true, sessions: sup.resumableSessions() });
    return true;
  }

  if (pathname === '/api/pi/sessions/active' && req.method === 'GET') {
    const sessions = sup.resumableSessions().filter((session) => [
      'AWAITING_PLAN_APPROVAL', 'PLAN_APPROVED', 'RUNNING_DAG',
      'AWAITING_TARGET_APPROVAL', 'TARGET_APPROVED',
    ].includes(session.status));
    json(res, 200, { ok: true, sessions });
    return true;
  }

  if (pathname === '/api/pi/sessions/start' && req.method === 'POST') {
    withJsonBody(req, res, json, async (body) => {
      try {
        const session = sup.start({
          workOrderId: body.work_order_id || null,
          projectId: String(body.project_id || ''),
          lineId: String(body.line_id || 'line1_bulk'),
          context: body.context || {},
          sessionId: body.session_id,
        });
        json(res, 201, { ok: true, session });
      } catch (err) {
        jsonError(json, res, err);
      }
    });
    return true;
  }

  // ---- D4.7 适配提案审批（三栏弹窗后端） ----
  const proposalList = pathname.match(/^\/api\/pi\/sessions\/([A-Za-z0-9_.-]+)\/proposals$/);
  if (proposalList && req.method === 'GET') {
    const session = sup.getSession(proposalList[1]);
    if (!session) {
      json(res, 404, { ok: false, error: `会话不存在: ${proposalList[1]}` });
      return true;
    }
    json(res, 200, { ok: true, proposals: listAdaptationProposals(session, ctx) });
    return true;
  }

  const proposalDecide = pathname.match(
    /^\/api\/pi\/sessions\/([A-Za-z0-9_.-]+)\/proposals\/([A-Za-z0-9_.-]+)\/decide$/,
  );
  if (proposalDecide && req.method === 'POST') {
    const session = sup.getSession(proposalDecide[1]);
    if (!session) {
      json(res, 404, { ok: false, error: `会话不存在: ${proposalDecide[1]}` });
      return true;
    }
    withJsonBody(req, res, json, async (body) => {
      try {
        // 状态变更必须带有效租约（与工单写端点同一条单权威租约）。
        const leaseId = String(req.headers['x-bio-lease-id'] || '');
        assertAuthority(leaseId, { file: ctx.authorityFile });
        const action = String(body.action || '');
        if (!['approve', 'reject'].includes(action)) {
          json(res, 400, { ok: false, error: 'action 必须是 approve 或 reject' });
          return;
        }
        const outcome = decideAdaptationProposal(session, proposalDecide[2], {
          action,
          comment: String(body.comment || '').slice(0, 1000),
          actor: ctx.actor || null,
          leaseId,
          ctx,
        });
        json(res, 200, { ok: true, ...outcome });
      } catch (err) {
        jsonError(json, res, err);
      }
    });
    return true;
  }

  const one = pathname.match(/^\/api\/pi\/sessions\/([A-Za-z0-9_.-]+)$/);
  if (one && req.method === 'GET') {
    const session = getSession(one[1]);
    if (!session) {
      json(res, 404, { ok: false, error: `会话不存在: ${one[1]}` });
      return true;
    }
    json(res, 200, {
      ok: true,
      session,
      checkpoints: listCheckpoints(one[1]),
      tool_calls: listToolCalls(one[1]),
    });
    return true;
  }

  const action = pathname.match(/^\/api\/pi\/sessions\/([A-Za-z0-9_.-]+)\/([a-z-]+)$/);
  if (!action || req.method !== 'POST') return false;
  const sessionId = action[1];
  const verb = action[2];

  withJsonBody(req, res, json, async (body) => {
    try {
      switch (verb) {
        case 'plan':
          json(res, 200, {
            ok: true,
            session: sup.submitPlan(sessionId, {
              planText: body.plan_text,
              dag: Array.isArray(body.dag) ? body.dag : [],
              parameterNotes: Array.isArray(body.parameter_notes) ? body.parameter_notes : [],
              recommendedMods: Array.isArray(body.recommended_mods) ? body.recommended_mods : [],
            }),
          });
          return;
        case 'approve-plan':
          json(res, 200, { ok: true, session: sup.approvePlan(sessionId, { actor: body.actor, reason: body.reason }) });
          return;
        case 'intercept': {
          const actor = ctx.actor || { kind: 'human', id: body.actor || 'desktop-admin', role: 'admin' };
          if (!ctx.authorityFile) {
            json(res, 400, { ok: false, error: '拦截需要租约服务' });
            return;
          }
          takeoverAuthority(actor, { file: ctx.authorityFile, reason: body.reason || 'human_intercept' });
          const outcome = sup.interceptPlan(sessionId, {
            actor: actor.id || actor.kind || 'human',
            reason: body.reason || null,
            ...(Number.isInteger(body.expected_version) ? { expectedVersion: body.expected_version } : {}),
          });
          json(res, 200, { ok: true, ...outcome });
          return;
        }
        case 'reject-plan':
          json(res, 200, { ok: true, session: sup.rejectPlan(sessionId, { actor: body.actor, reason: body.reason }) });
          return;
        case 'dispatch':
          json(res, 200, { ok: true, session: sup.markDagRunning(sessionId) });
          return;
        case 'targets':
          json(res, 200, {
            ok: true,
            session: sup.submitTargetLock(sessionId, {
              targets: Array.isArray(body.targets) ? body.targets : [],
              qcSummary: body.qc_summary || {},
            }),
          });
          return;
        case 'approve-targets':
          json(res, 200, {
            ok: true,
            session: sup.approveTargetLock(sessionId, { actor: body.actor, reason: body.reason }),
          });
          return;
        case 'report-signed':
          json(res, 200, {
            ok: true,
            session: sup.markReportSigned(sessionId, {
              receiptId: body.receipt_id || null,
              ...(body.delivery_grade ? { deliveryGrade: body.delivery_grade } : {}),
              override: body.override === true,
              actor: body.actor || ctx.actor || null,
              comment: String(body.comment || ''),
            }),
          });
          return;
        case 'tool':
          json(res, 200, {
            ok: true,
            result: await sup.invokeTool(sessionId, String(body.tool_name || ''), body.params || {}),
          });
          return;
        default:
          json(res, 404, { ok: false, error: `未知会话动作: ${verb}` });
      }
    } catch (err) {
      jsonError(json, res, err);
    }
  });
  return true;
}
