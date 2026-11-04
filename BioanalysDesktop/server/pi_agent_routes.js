/**
 * Pi Agent 观测与模型管控路由（mod-pi-observability）。
 *
 * 责任边界：
 *   - 只处理 /api/pi-agent/*，返回 true 表示已接管；
 *   - 远程读取经注入的 runSshRaw，本地只写追加式 actions 台账；
 *   - token 永不出手机，所有错误信息经 redact。
 */

import fs from 'node:fs';
import path from 'node:path';
import { collectJsonBody, JSON_BODY_LIMIT } from './http_body.js';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_MODELS,
  PI_SSH_TARGET,
  buildCallDetailCommand,
  buildCallsCommand,
  buildCurrentModelCommand,
  buildDaemonLogCommand,
  buildOverviewCommand,
  buildPeerTokenCommand,
  buildTelemetryProbeCommand,
  buildTelemetryRestartCommand,
  buildSwitchModelCommand,
  cancelA2ATask,
  classifyAgentCard,
  extractTaskFromRpcData,
  fetchAgentCard,
  fetchTelemetry,
  fetchTelemetryViaPath,
  getA2ATask,
  parseCurrentModel,
  parseOverview,
  parseSessionList,
  parseTelemetryProbe,
  parseTranscript,
  parseTranscriptTimeline,
  postA2ARequest,
  redact,
} from './pi_agent.js';
import { normalizeA2ATask } from './a2a_state.js';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const DISPATCH_TIMEOUT_MS = 240000;

export function parseBattery(raw) {
  if (typeof raw === 'string' && raw.includes('unavailable')) {
    return { percentage: 'unavailable', status: 'unavailable', plugged: 'unavailable', temperature: 'unavailable' };
  }
  try {
    const obj = JSON.parse(raw);
    return {
      percentage: obj.percentage ?? 'unknown',
      status: obj.status ?? 'unknown',
      plugged: obj.plugged ?? 'unknown',
      temperature: obj.temperature ?? 'unknown',
    };
  } catch {
    return { percentage: 'unknown', status: 'unknown', plugged: 'unknown', temperature: 'unknown' };
  }
}

export function appendPiLedger(action, details, root = process.cwd()) {
  try {
    const dir = path.join(root, 'con_hf', 'ledger');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'actions.jsonl'),
      `${JSON.stringify({
        id: `ACT-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        ts: new Date().toISOString(),
        type: 'action',
        kind: 'mod_pi_observability',
        action,
        detail: details,
      })}\n`,
      'utf8',
    );
  } catch {
    // Ledger failure must not break observability.
  }
}

/**
 * 「JSON 非法」与「闸门已短路」的区分符。
 *
 * 两者都得让调用方停止往下走，但只有前者还欠客户端一个 400：
 * 混成一个 null 的话，非法 JSON 的请求会一个响应都不写、永远挂着（改造前是 400）。
 */
const INVALID_JSON_BODY = Symbol('invalid json body');

/**
 * 读取并解析 JSON 请求体（T3-7：走统一的上限闸门）。
 *
 * 返回三档：解析出的对象、null（闸门已短路：413 或客户端断开）、
 * INVALID_JSON_BODY（正文在限额内但不是合法 JSON）。
 * null 这一档响应已经由闸门写完，调用方必须直接 return true：
 * 再补一个响应会抛 ERR_HTTP_HEADERS_SENT 打死进程。
 */
async function readJsonBody(req, res, json) {
  const body = await collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT });
  if (body === null) return null; // 闸门已短路（413 或断连），响应写完了
  try {
    return JSON.parse(body || '{}');
  } catch {
    return INVALID_JSON_BODY;
  }
}

function extractNormalizedTask(data) {
  return normalizeA2ATask(extractTaskFromRpcData(data));
}

function extractSwitchedModel(text) {
  const provider = String(text || '').match(/^PIN_PROVIDER=(.*)$/m)?.[1]?.trim();
  const model = String(text || '').match(/^PIN_MODEL=(.*)$/m)?.[1]?.trim();
  if (!provider || !model) {
    return null;
  }
  return { provider, model };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 * @param {{json: Function, runSshRaw: Function, ledgerRoot?: string}} deps
 * @returns {Promise<boolean>} true when the route was handled
 */
export async function handlePiAgentRoutes(req, res, url, deps) {
  const { json, runSshRaw } = deps;
  const ledgerRoot = deps.ledgerRoot || REPO_ROOT;
  const ledger = (action, details) => appendPiLedger(action, details, ledgerRoot);
  const telemetry = deps.fetchTelemetry || fetchTelemetry;
  const telemetryViaPath = deps.fetchTelemetryViaPath || fetchTelemetryViaPath;
  const agentCard = deps.fetchAgentCard || fetchAgentCard;
  const dispatchA2A = deps.postA2ARequest || postA2ARequest;
  const getTask = deps.getA2ATask || getA2ATask;
  const cancelTask = deps.cancelA2ATask || cancelA2ATask;

  if (url.pathname === '/api/pi-agent/ping' && req.method === 'GET') {
    try {
      const card = await agentCard();
      const diag = classifyAgentCard(card);
      if (card.status === 200) {
        json(res, 200, {
          ok: true,
          online: true,
          a2a_status: diag.status,
          agent_card: {
            name: card.data?.name,
            version: card.data?.version,
          },
        });
      } else {
        json(res, 502, {
          ok: false,
          online: false,
          a2a_status: diag.status,
          a2a_reason: diag.reason,
          error: diag.status === 'tunnel_down'
            ? 'ERR_AGENT_CARD_TUNNEL_DOWN'
            : `ERR_AGENT_CARD_${diag.status.toUpperCase()}`,
        });
      }
    } catch (cause) {
      json(res, 502, {
        ok: false,
        online: false,
        error: redact(cause instanceof Error ? cause.message : String(cause)),
      });
    }
    return true;
  }

  if (url.pathname === '/api/pi-agent/overview') {
    try {
      const cardPromise = agentCard();
      const tokenRes = runSshRaw(PI_SSH_TARGET, buildPeerTokenCommand(), { timeoutMs: 15000 });
      const telePromise = telemetry(tokenRes.text.trim());
      const raw = runSshRaw(PI_SSH_TARGET, buildOverviewCommand(), { timeoutMs: 15000 });
      const card = await cardPromise;
      const tele = await telePromise;
      const overview = parseOverview(raw.text);
      const a2aDiag = classifyAgentCard(card);
      overview.a2a_card = card.status === 200
        ? { name: card.data?.name, version: card.data?.version, url: card.data?.url }
        : null;
      overview.a2a_status = a2aDiag.status;
      overview.a2a_reason = a2aDiag.status === 'ok' ? null : a2aDiag.reason;
      const telemetryStatus = tele.status === 200
        ? 'ok'
        : tele.status === 401
          ? 'sidecar_unauthorized'
          : tele.status === 0
            ? 'sidecar_down'
            : `sidecar_http_${tele.status}`;
      overview.telemetry = tele.status === 200
        ? {
            usage: tele.data?.usage ?? null,
            usage_by_model: tele.data?.usage_by_model ?? [],
            recent_calls: (tele.data?.recent_calls ?? []).slice(0, 15),
          }
        : null;
      overview.telemetry_status = telemetryStatus;
      overview.telemetry_reason = tele.status === 200
        ? null
        : '遥测侧车 9911 不在线：调用台账与 Token 统计暂缺，可点「重建侧车」恢复（daemon 每轮也会自愈）。';
      overview.battery = parseBattery(overview.battery_raw);
      delete overview.battery_raw;
      json(res, 200, { ok: true, ...overview });
    } catch (cause) {
      json(res, 200, { ok: false, online: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
    return true;
  }

  if (url.pathname === '/api/pi-agent/telemetry/restart' && req.method === 'POST') {
    try {
      const before = parseTelemetryProbe(
        runSshRaw(PI_SSH_TARGET, buildTelemetryProbeCommand(), { timeoutMs: 15000 }).text
      );
      const rebuild = runSshRaw(PI_SSH_TARGET, buildTelemetryRestartCommand(), { timeoutMs: 40000 });
      const text = String(rebuild.text || '');
      const outcome = /TELEMETRY_UP/.test(text)
        ? 'up'
        : /TELEMETRY_SIDECAR_MISSING/.test(text)
          ? 'sidecar_missing'
          : /TELEMETRY_NO_SESSION/.test(text)
            ? 'no_session'
            : 'down';
      const after = parseTelemetryProbe(
        runSshRaw(PI_SSH_TARGET, buildTelemetryProbeCommand(), { timeoutMs: 15000 }).text
      );
      let tele = { status: 0, data: null };
      if (after.alive) {
        const token = runSshRaw(PI_SSH_TARGET, buildPeerTokenCommand(), { timeoutMs: 15000 }).text.trim();
        tele = await telemetry(token);
      }
      const ok = after.alive && tele.status === 200;
      ledger('pi_agent_telemetry_restart', {
        before: before.code,
        after: after.code,
        outcome,
        ok,
      });
      json(res, ok ? 200 : 502, {
        ok,
        outcome,
        before_code: before.code,
        after_code: after.code,
        telemetry_status: tele.status === 200 ? 'ok' : 'sidecar_down',
        error: ok
          ? null
          : redact(outcome === 'sidecar_missing'
            ? '手机上缺少 ~/bin/pi_telemetry_sidecar.py，无法重建侧车'
            : outcome === 'no_session'
              ? '手机上没有 pi-a2a tmux 会话，需先启动 A2A 主服务'
              : '已重建 telemetry 窗口，但 9911 仍未响应'),
      });
    } catch (cause) {
      json(res, 502, { ok: false, error: redact(cause instanceof Error ? cause.message : String(cause)) });
    }
    return true;
  }

  if (url.pathname === '/api/pi-agent/calls') {
    try {
      const tokenRes = runSshRaw(PI_SSH_TARGET, buildPeerTokenCommand(), { timeoutMs: 15000 });
      const tele = await telemetry(tokenRes.text.trim(), 8000);
      let calls;
      let totals;
      if (tele.status === 200 && Array.isArray(tele.data?.recent_calls)) {
        calls = tele.data.recent_calls;
        totals = tele.data.totals || tele.data.usage;
      } else {
        const limit = Math.min(Math.max(Number(new URL(req.url, 'http://x').searchParams.get('limit')) || 20, 1), 50);
        const list = runSshRaw(PI_SSH_TARGET, buildCallsCommand(limit), { timeoutMs: 15000 });
        const sessions = parseSessionList(list.text).slice(0, limit);
        calls = sessions.map((session) => {
          const detail = runSshRaw(PI_SSH_TARGET, buildCallDetailCommand(session.file), { timeoutMs: 15000 });
          return { ...session, ...parseTranscript(detail.text) };
        });
        const acc = calls.reduce((a, c) => ({
          input_tokens: a.input_tokens + c.input_tokens,
          output_tokens: a.output_tokens + c.output_tokens,
          cost_usd: a.cost_usd + c.cost_usd,
        }), { input_tokens: 0, output_tokens: 0, cost_usd: 0 });
        totals = { ...acc, cost_usd: Number(acc.cost_usd.toFixed(4)), total_calls: calls.length };
      }
      json(res, 200, { ok: true, calls, totals });
    } catch (cause) {
      json(res, 200, { ok: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
    return true;
  }

  if (url.pathname === '/api/pi-agent/logs') {
    try {
      const params = new URL(req.url, 'http://x').searchParams;
      const tail = params.get('tail') || '120';
      const taskFile = params.get('task_file') || '';
      try {
        const tokenRes = runSshRaw(PI_SSH_TARGET, buildPeerTokenCommand(), { timeoutMs: 15000 });
        const qs = taskFile ? `task_file=${encodeURIComponent(taskFile)}&` : '';
        const tele = await telemetryViaPath(tokenRes.text.trim(), `/api/telemetry/logs?${qs}tail=${tail}`);
        if (tele.status === 200 && Array.isArray(tele.data?.lines)) {
          if (!taskFile) {
            json(res, 200, {
              ok: true,
              source: tele.data.source || 'pi_a2a_daemon.log',
              lines: tele.data.lines,
              timeline: [],
            });
            return true;
          }
          const raw = tele.data.lines.join('\n');
          const taskIdMatch = taskFile.match(/_task-(.+)\.jsonl$/);
          const timeline = parseTranscriptTimeline(raw, taskIdMatch ? taskIdMatch[1] : '');
          const lines = timeline.map((e) => `[${e.ts}] [${e.level}] ${e.text}`);
          json(res, 200, { ok: true, source: taskFile, lines, timeline });
          return true;
        }
      } catch {
        // Sidecar offline: fall through to SSH.
      }
      const command = taskFile ? buildCallDetailCommand(taskFile) : buildDaemonLogCommand(tail);
      const raw = runSshRaw(PI_SSH_TARGET, command, { timeoutMs: 15000 });
      const taskIdMatch = taskFile ? taskFile.match(/_task-(.+)\.jsonl$/) : null;
      if (taskFile) {
        const timeline = parseTranscriptTimeline(raw.text, taskIdMatch ? taskIdMatch[1] : '');
        const lines = timeline.map((e) => `[${e.ts}] [${e.level}] ${e.text}`);
        json(res, 200, { ok: true, source: taskFile, lines, timeline });
        return true;
      }
      json(res, 200, {
        ok: true,
        source: 'pi_a2a_daemon.log',
        lines: redact(raw.text).split('\n').filter(Boolean),
        timeline: [],
      });
    } catch (cause) {
      json(res, 200, { ok: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
    return true;
  }

  if (url.pathname === '/api/pi-agent/model' && req.method === 'GET') {
    try {
      const raw = runSshRaw(PI_SSH_TARGET, buildCurrentModelCommand(), { timeoutMs: 15000 });
      json(res, 200, { ok: true, current: parseCurrentModel(raw.text), allowed: ALLOWED_MODELS });
    } catch (cause) {
      json(res, 200, { ok: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
    return true;
  }

  if (url.pathname === '/api/pi-agent/model' && req.method === 'POST') {
    const requested = await readJsonBody(req, res, json);
    if (requested === null) return true; // 闸门已回 413（或断连），这里绝不双写第二个响应
    try {
      const command = buildSwitchModelCommand(requested?.provider, requested?.model);
      const raw = runSshRaw(PI_SSH_TARGET, command, { timeoutMs: 30000 });
      if (raw.text.includes('ERR_PROVIDER_KEY_MISSING')) {
        json(res, 409, { ok: false, error: 'ERR_PROVIDER_KEY_MISSING' });
        return true;
      }
      if (!raw.text.includes('SWITCH_OK')) {
        const actual = extractSwitchedModel(raw.text);
        const mismatch = raw.text.includes('ERR_LAUNCH_MODEL_MISMATCH');
        if (mismatch && actual) {
          ledger('pi_agent_model_switch_mismatch', {
            requested_provider: requested.provider,
            requested_model: requested.model,
            actual_provider: actual.provider,
            actual_model: actual.model,
          });
          json(res, 509, {
            ok: false,
            error: 'ERR_LAUNCH_MODEL_MISMATCH',
            actual,
          });
          return true;
        }
        json(res, 502, { ok: false, error: `切换失败: ${redact(raw.text).slice(0, 200)}` });
        return true;
      }
      const actual = extractSwitchedModel(raw.text);
      if (!actual) {
        json(res, 502, { ok: false, error: 'ERR_SWITCH_STATE_MISSING' });
        return true;
      }
      ledger('pi_agent_model_switch', {
        actual_provider: actual.provider,
        actual_model: actual.model,
      });
      json(res, 200, { ok: true, current: actual });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const status = message.includes('ERR_MODEL_NOT_ALLOWED')
        ? 400
        : message.includes('ERR_PROVIDER_KEY_MISSING')
          ? 409
          : 500;
      json(res, status, { ok: false, error: message });
    }
    return true;
  }

  if (url.pathname === '/api/pi-agent/task' && req.method === 'GET') {
    const taskId = new URL(req.url, 'http://x').searchParams.get('id')?.trim() || '';
    if (!taskId || taskId.length > 256) {
      json(res, 400, { ok: false, error: 'task id 字段必填且长度不超过 256' });
      return true;
    }
    try {
      const tokenRes = runSshRaw(PI_SSH_TARGET, buildPeerTokenCommand(), { timeoutMs: 15000 });
      const token = tokenRes.text.trim();
      if (!token || token.length < 48) {
        json(res, 502, { ok: false, error: '无法从手机读取 peer token（SSH 链路或文件缺失）' });
        return true;
      }
      const out = await getTask(taskId, token);
      const task = extractNormalizedTask(out.data);
      ledger('pi_agent_a2a_task_poll', { task_id: taskId, status: out.status });
      json(res, 200, {
        ok: out.status === 200 && Boolean(task),
        http_status: out.status,
        task,
      });
    } catch (cause) {
      json(res, 502, { ok: false, error: redact(cause instanceof Error ? cause.message : String(cause)) });
    }
    return true;
  }

  if (url.pathname === '/api/pi-agent/task/cancel' && req.method === 'POST') {
    const requested = await readJsonBody(req, res, json);
    if (requested === null) return true; // 闸门已回 413（或断连），这里绝不双写第二个响应
    const taskId = String(requested?.id || '').trim();
    if (!taskId || taskId.length > 256) {
      json(res, 400, { ok: false, error: 'id 字段必填且长度不超过 256' });
      return true;
    }
    try {
      const tokenRes = runSshRaw(PI_SSH_TARGET, buildPeerTokenCommand(), { timeoutMs: 15000 });
      const token = tokenRes.text.trim();
      if (!token || token.length < 48) {
        json(res, 502, { ok: false, error: '无法从手机读取 peer token（SSH 链路或文件缺失）' });
        return true;
      }
      const out = await cancelTask(taskId, token);
      const task = extractNormalizedTask(out.data);
      ledger('pi_agent_a2a_task_cancel', { task_id: taskId, status: out.status });
      json(res, 200, {
        ok: out.status === 200 && Boolean(task),
        http_status: out.status,
        task,
      });
    } catch (cause) {
      json(res, 502, { ok: false, error: redact(cause instanceof Error ? cause.message : String(cause)) });
    }
    return true;
  }

  if (url.pathname === '/api/pi-agent/dispatch' && req.method === 'POST') {
    const requested = await readJsonBody(req, res, json);
    if (requested === null) return true; // 闸门已回 413（或断连），这里绝不双写第二个响应
    const promptText = String(requested?.message || '').trim();
    if (!promptText) {
      json(res, 400, { ok: false, error: 'message 字段必填' });
      return true;
    }
    if (promptText.length > 4000) {
      json(res, 400, { ok: false, error: 'message 超过 4000 字符上限' });
      return true;
    }
    const tokenRes = runSshRaw(PI_SSH_TARGET, buildPeerTokenCommand(), { timeoutMs: 15000 });
    const token = tokenRes.text.trim();
    if (!token || token.length < 48) {
      json(res, 502, { ok: false, error: '无法从手机读取 peer token（SSH 链路或文件缺失）' });
      return true;
    }
    try {
      const out = await dispatchA2A(promptText, token, DISPATCH_TIMEOUT_MS, {
        returnImmediately: requested?.returnImmediately !== false,
      });
      const modelRaw = runSshRaw(PI_SSH_TARGET, buildCurrentModelCommand(), { timeoutMs: 15000 });
      const currentModel = parseCurrentModel(modelRaw.text);
      ledger('pi_agent_a2a_dispatch', {
        prompt: promptText.slice(0, 200),
        status: out.status,
        actual_provider: currentModel.provider,
        actual_model: currentModel.model,
      });
      const task = extractNormalizedTask(out.data);
      json(res, 200, {
        ok: out.status === 200,
        http_status: out.status,
        task,
        poll_url: task?.id
          ? `/api/pi-agent/task?id=${encodeURIComponent(task.id)}`
          : null,
      });
    } catch (cause) {
      json(res, 502, { ok: false, error: redact(cause instanceof Error ? cause.message : String(cause)) });
    }
    return true;
  }

  // ============================================================
  // v2.0 遥测心跳捎带 (Heartbeat Piggybacking)
  // ============================================================
  if (url.pathname === '/api/v1/a2a/heartbeat' && req.method === 'POST') {
    const payload = await readJsonBody(req, res, json);
    if (payload === null) return true; // 闸门已回 413（或断连），这里绝不双写第二个响应
    if (!payload || payload === INVALID_JSON_BODY) {
      json(res, 400, { ok: false, error: '非法 JSON 请求体' });
      return true;
    }
    const nodeId = payload.node_id || 'k40-ubuntu-node01';
    const tempC = payload.battery_temp_c ?? 35.0;
    const thermalState = payload.thermal_state || 'NORMAL';
    const unsyncedTriads = Array.isArray(payload.completed_triads) ? payload.completed_triads : [];

    ledger('pi_agent_telemetry_heartbeat', {
      node_id: nodeId,
      battery_temp_c: tempC,
      mem_available_mb: payload.mem_available_mb,
      thermal_state: thermalState,
      throttle_count: payload.throttle_count,
      active_jobs_count: payload.active_jobs_count,
    });

    const ackedSteps = [];
    for (const triad of unsyncedTriads) {
      if (triad?.step_id) {
        ackedSteps.push(triad.step_id);
        ledger('pi_agent_triad_synced', {
          node_id: nodeId,
          task_id: triad.task_id,
          manifest_id: triad.manifest_id,
          step_id: triad.step_id,
          exit_code: triad.exit_code,
        });
      }
    }

    json(res, 200, {
      ok: true,
      server_time: new Date().toISOString(),
      acked_step_ids: ackedSteps,
    });
    return true;
  }

  return false;
}
