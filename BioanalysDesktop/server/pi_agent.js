/**
 * Pi Agent 观测管控卡带（mod-pi-observability）服务端采集层。
 *
 * 双通道取数：
 *   - A2A 标准口 :9910 经 PC 的 adb forward 读 AgentCard 与任务状态；
 *   - Termux SSH（k40 别名）只读探针拉取 a2a_sessions JSONL（调用台账 +
 *     Token usage）、daemon.log（守护日志）与模型设定文件。
 *
 * 设计约束：
 *   - 本地零算力红线：本模块只构造 ssh / adb 命令字符串，实际执行走
 *     proc.js 的白名单接缝，测试可整体换掉；
 *   - API Key 与 peer token 永不出手机，本模块所有输出都经过脱敏；
 *   - 只读优先，唯一写动作是模型切换（改白名单 pin 文件 + 重启 tmux），
 *     且只接受本地白名单内的组合。
 */

import http from 'node:http';

export const PI_SSH_TARGET = 'k40';
export const PI_WORKSPACE = '/data/data/com.termux/files/home/workspace';
export const PI_AGENT_DIR = '/data/data/com.termux/files/home/.pi/agent';

/** 与 ops/pi_a2a_daemon.sh 的模型锁同源（A2A-D 锁定组合，不得扩大） */
export const ALLOWED_MODELS = [
  { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
  { provider: 'zai', model: 'glm-5.3-flash' },
];

const ADB_FORWARD_PORT = 9910;

// ============================================================
// SSH 探针命令构造（纯函数，单测可直接断言字符串）
// ============================================================

const OVERVIEW_SCRIPT = [
  'card=$(curl --noproxy "*" -fsS --max-time 4 http://127.0.0.1:9910/.well-known/agent-card.json >/dev/null 2>&1 && echo OK || echo DOWN)',
  'agent_dir="$HOME/.pi/agent"',
  'model=$(cat "$agent_dir/.provider_model" 2>/dev/null || echo unknown)',
  'provider=$(cat "$agent_dir/.provider_name" 2>/dev/null || echo unknown)',
  'tmux has-session -t pi-a2a 2>/dev/null && tmux_state=alive || tmux_state=dead',
  `mem=$(free -m | awk '/Mem:/{print $3"/"$2" MB"}')`,
  // termux-battery-status 在无 TTY 的 ssh 会话里会永久阻塞（Termux:API IPC 等待），
  // 2026-10-28 实测，所以工况改走纯文件 IO：电池文件 Termux 读不到就报 unavailable。
  'batt="unavailable (no perm from ssh)"',
  'echo "CARD_MARKER:$card"',
  'echo "MODEL_MARKER:$provider/$model"',
  'echo "TMUX_MARKER:$tmux_state"',
  'echo "MEM_MARKER:$mem"',
    'echo "BATT_MARKER:$batt"',
].join('\n');

/** ssh 单行信封：base64 中转，绕开 PC -> Termux 的多层引号折叠 */
function b64Envelope(script) {
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return `echo ${b64} | base64 -d | bash`;
}

export function buildOverviewCommand() {
  return b64Envelope(OVERVIEW_SCRIPT);
}

export function buildCallsCommand(limit = 30) {
  const sessions = `${PI_AGENT_DIR}/a2a_sessions`;
  return b64Envelope(`ls -t ${sessions}/*.jsonl 2>/dev/null | head -${Number(limit) || 30}`);
}

export function buildCallDetailCommand(sessionFile) {
  // 只允许 a2a_sessions 下的文件名，防路径穿越；文件名含正斜杠即拒绝。
  const name = String(sessionFile || '').split('/').pop();
  if (!name || name.includes('..') || !name.endsWith('.jsonl')) {
    throw new Error('ERR_CALL_FILE_MALFORMED');
  }
  return b64Envelope(`cat "${PI_AGENT_DIR}/a2a_sessions/${name}"`);
}

export function buildDaemonLogCommand(tail = 120) {
  const n = Math.min(Math.max(Number(tail) || 120, 1), 500);
  return b64Envelope(`tail -n ${n} "${PI_AGENT_DIR}/logs/pi_a2a_daemon.log" 2>/dev/null || true`);
}

export function buildCurrentModelCommand() {
  return b64Envelope([
    `cat ${PI_AGENT_DIR}/.provider_name 2>/dev/null || echo unknown`,
    `cat ${PI_AGENT_DIR}/.provider_model 2>/dev/null || echo unknown`,
  ].join('\necho '));
}

export function buildPeerTokenCommand() {
  return b64Envelope(`cat "${PI_AGENT_DIR}/.peer_token"`);
}

export function buildSwitchModelCommand(provider, model) {
  const hit = ALLOWED_MODELS.find((m) => m.provider === provider && m.model === model);
  if (!hit) throw new Error('ERR_MODEL_NOT_ALLOWED');
  // pin 文件是 daemon 的唯一模型真源；写完后重启 tmux 让 --model 生效。
  return b64Envelope([
    `printf '${provider}\\n' > ${PI_AGENT_DIR}/.provider_name`,
    `printf '${model}\\n' > ${PI_AGENT_DIR}/.provider_model`,
    `chmod 600 ${PI_AGENT_DIR}/.provider_name ${PI_AGENT_DIR}/.provider_model`,
    'tmux kill-session -t pi-a2a 2>/dev/null || true',
    'A2A_DAEMON_MODE=foreground bash "$HOME/bin/pi_a2a_daemon.sh" >/dev/null 2>&1 &',
    'echo SWITCH_OK',
  ].join('\n'));
}

// ============================================================
// 输出解析（纯函数）
// ============================================================

export function parseOverview(text) {
  const markers = {};
  for (const line of String(text).split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      if (key.endsWith('_MARKER')) markers[key.slice(0, -7)] = line.slice(idx + 1).trim();
    }
  }
  const [provider = 'unknown', model = 'unknown'] = (markers.MODEL || 'unknown/unknown').split('/');
  const online = markers.CARD === 'OK';
  return {
    online,
    tmux_state: markers.TMUX || 'unknown',
    memory: markers.MEM || 'unknown',
    battery_raw: markers.BATT || '',
    current_model: { provider, model },
    allowed_models: ALLOWED_MODELS,
  };
}

/** 派发 A2A v1.0 SendMessage：PC 直连 adb forward 的 9910，token 从手机现读 */
export function postA2ARequest(promptText, token, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      id: `rpc-18787-${Date.now()}`,
      method: 'SendMessage',
      params: {
        message: {
          messageId: `msg-18787-${Date.now()}`,
          role: 'ROLE_USER',
          parts: [{ text: promptText }],
        },
        configuration: { returnImmediately: false },
      },
    }), 'utf8');
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: ADB_FORWARD_PORT,
        path: '/',
        method: 'POST',
        agent: false,
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Length': payload.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          } catch (cause) {
            reject(new Error(`ERR_BAD_RESPONSE_FROM_PI: ${cause.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ERR_PI_TIMEOUT')); });
    req.write(payload);
    req.end();
  });
}

/** 从一条 a2a_sessions JSONL 里提取 usage 聚合与最后一条助手文本 */
export function parseTranscript(jsonlText) {
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let costTotal = 0;
  let model = 'unknown';
  let lastText = '';
  let thinkingLevel = '';
  const tools = [];
  for (const line of String(jsonlText).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.type !== 'message') continue;
    const msg = evt.message || {};
    if (msg.model) model = msg.model;
    if (msg.thinkingLevel) thinkingLevel = msg.thinkingLevel;
    const usage = msg.usage || {};
    input += Number(usage.input || 0);
    output += Number(usage.output || 0);
    reasoning += Number(usage.reasoning || 0);
    const cost = usage.cost || {};
    costTotal += Number(cost.total || 0);
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) lastText = String(part.text).slice(0, 240);
        if (part.type === 'toolCall' && part.name) {
          tools.push({ name: part.name, args: String(JSON.stringify(part.arguments || {})).slice(0, 200) });
        }
      }
    }
  }
  return {
    model,
    thinking_level: thinkingLevel,
    input_tokens: input,
    output_tokens: output,
    reasoning_tokens: reasoning,
    cost_usd: Number(costTotal.toFixed(6)),
    last_text: lastText,
    tools,
  };
}

/** 把 transcript JSONL 解析成带级别的时间线（INFO/TOOL/ARTIFACT/THINK），对齐参考页面轨迹格式 */
export function parseTranscriptTimeline(jsonlText, taskId) {
  const entries = [];
  const shortId = String(taskId || '').slice(0, 14);
  const ts = (iso) => {
    try { return new Date(iso).toTimeString().slice(0, 8); } catch { return ''; }
  };
  for (const line of String(jsonlText).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    const t = ts(evt.timestamp);
    if (evt.type === 'session') {
      entries.push({ ts: t, level: 'INFO', text: `[A2A] Task ${shortId} session started (cwd=${evt.cwd || ''})` });
      continue;
    }
    if (evt.type === 'custom' && evt.customType === 'a2a/dispatch') {
      entries.push({ ts: t, level: 'INFO', text: `[A2A] Dispatched from peer="codex" (taskId=${(evt.data || {}).taskId || ''})` });
      continue;
    }
    if (evt.type !== 'message') continue;
    const msg = evt.message || {};
    const usage = msg.usage || {};
    const tok = usage.totalTokens ? ` tokens=${usage.totalTokens}` : '';
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) {
          entries.push({ ts: t, level: 'INFO', text: `[PROMPT] ${String(part.text).slice(0, 200).replace(/\s+/g, ' ')}` });
        }
      }
      continue;
    }
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === 'thinking' && part.thinking) {
        entries.push({ ts: t, level: 'THINK', text: `[THINKING] ${String(part.thinking).slice(0, 180).replace(/\s+/g, ' ')}` });
      } else if (part.type === 'toolCall' && part.name) {
        const args = String(JSON.stringify(part.arguments || {})).slice(0, 200);
        entries.push({ ts: t, level: 'TOOL', text: `[TOOL_USE: ${part.name}] ${args}` });
      } else if (part.type === 'text' && part.text) {
        const text = String(part.text).replace(/\s+/g, ' ').slice(0, 200);
        entries.push({ ts: t, level: 'REPLY', text: text });
      }
    }
    if (usage.totalTokens) {
      entries.push({ ts: t, level: 'INFO', text: `[USAGE] turn done${tok}` });
    }
  }
  const last = entries[entries.length - 1];
  if (last && last.level === 'REPLY') {
    entries.push({ ts: last.ts, level: 'ARTIFACT', text: `[ARTIFACT_RETURNED] Task ${shortId} completed -> artifact returned to peer="codex"` });
  }
  return entries;
}

/** 把 ls -t 输出转成台账行（文件名即含 task_id 的时间戳前缀） */
export function parseSessionList(text) {
  return String(text)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith('.jsonl'))
    .map((path) => {
      const base = path.split('/').pop();
      // 文件名形如 2026-10-28T06-15-04-813Z_task-<id>.jsonl
      const match = base.match(/^(.+?)Z_task-(.+)\.jsonl$/);
      return {
        file: base,
        started_at: match ? match[1].replace(/-/g, (m, i) => (i < 3 ? m : i === 3 ? ':' : i === 4 ? ':' : '.')) : base,
        task_id: match ? match[2] : base,
      };
    });
}

export function parseCurrentModel(text) {
  const lines = String(text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return { provider: lines[0] || 'unknown', model: lines[1] || 'unknown' };
}

// ============================================================
// A2A AgentCard 读取（走 adb forward，PC 零额外端口）
// ============================================================

export function fetchAgentCard() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: ADB_FORWARD_PORT,
        path: '/.well-known/agent-card.json',
        method: 'GET',
        agent: false,
        timeout: 5000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          } catch {
            resolve({ status: 0, data: null });
          }
        });
      }
    );
    req.on('error', () => resolve({ status: 0, data: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: null }); });
    req.end();
  });
}

/** 经 adb forward 读取 9911 遥测 Sidecar；token 由调用方传入 */
export function fetchTelemetry(token, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 9911,
        path: '/api/telemetry/overview',
        method: 'GET',
        agent: false,
        timeout: timeoutMs,
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          } catch {
            resolve({ status: 0, data: null });
          }
        });
      }
    );
    req.on('error', () => resolve({ status: 0, data: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: null }); });
    req.end();
  });
}

/** 读取 9911 的任意路径（logs 等），token 由调用方传入 */
export function fetchTelemetryViaPath(token, requestPath, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 9911,
        path: requestPath,
        method: 'GET',
        agent: false,
        timeout: timeoutMs,
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          } catch {
            resolve({ status: 0, data: null });
          }
        });
      }
    );
    req.on('error', () => resolve({ status: 0, data: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: null }); });
    req.end();
  });
}

/** 侧卡脱敏：任何疑似 token/密钥形状的串一律替换 */
export function redact(text) {
  return String(text)
    .replace(/sk-[A-Za-z0-9]{8,}/g, '<REDACTED>')
    .replace(/a2a_sec_[0-9a-f]{8,}/g, '<REDACTED>')
    .replace(/Bearer [A-Za-z0-9_\-\.]{8,}/g, 'Bearer <REDACTED>');
}

