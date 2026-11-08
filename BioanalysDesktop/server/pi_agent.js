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
 *     且只接受本地白名单内的组合；
 *   - 5.2 纳管（2026-11-01）：tmux 起的是远端 $HOME/bin/pi_a2a_launch.sh，
 *     仓库镜像在 tools/ops/k40/pi_a2a_launch.sh（Termux 宿主落点，不进容器 ops 同步面）；
 *     切换前用 ERR_LAUNCHER_MISSING 校验在位，缺文件 exit 3 明确报错，不再踩空。
 */

import http from 'node:http';

export const PI_SSH_TARGET = 'k40';
export const PI_WORKSPACE = '/data/data/com.termux/files/home/workspace';
export const PI_AGENT_DIR = '/data/data/com.termux/files/home/.pi/agent';

/** Pi Agent 默认模型；白名单顺序同时决定 18787 页面的默认展示顺序。 */
export const DEFAULT_MODEL = {
  provider: 'zai',
  model: 'glm-5.3-flash',
};

/** 与 tools/ops/k40/pi_a2a_daemon.sh 的模型锁同源（A2A-D 锁定组合，不得扩大） */
export const ALLOWED_MODELS = [
  DEFAULT_MODEL,
  { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
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
  ].join('\n'));
}

export function buildPeerTokenCommand() {
  return b64Envelope(`cat "${PI_AGENT_DIR}/.peer_token"`);
}

/** 遥测侧车（:9911）地址；与 tools/ops/k40/pi_telemetry_sidecar.py 的 SIDE_PORT 同源。 */
export const TELEMETRY_URL = 'http://127.0.0.1:9911/api/telemetry/overview';

/** 侧车探活：在手机侧 curl 一次，200 或 401 都说明进程在听，000 说明没人监听。 */
export function buildTelemetryProbeCommand() {
  return `code="$(curl --noproxy '*' -s -o /dev/null -m 4 -w '%{http_code}' ${TELEMETRY_URL} 2>/dev/null || printf 000)"; printf 'TELEMETRY_CODE=%s\\n' "$code"`;
}

/** 解析探活输出，返回状态码与是否存活。 */
export function parseTelemetryProbe(text) {
  const hit = /TELEMETRY_CODE=(\d{3})/.exec(String(text || ''));
  const code = hit ? hit[1] : '000';
  return { code, alive: code === '200' || code === '401' };
}

/** 侧车重启：重建 telemetry 窗口并等它就绪，窗口内自带重启循环。 */
export function buildTelemetryRestartCommand() {
  return b64Envelope([
    'set -u',
    'session=pi-a2a',
    'tmux has-session -t "$session" 2>/dev/null || { printf "TELEMETRY_NO_SESSION\\n"; exit 3; }',
    'if [ ! -f "$HOME/bin/pi_telemetry_sidecar.py" ]; then printf "TELEMETRY_SIDECAR_MISSING\\n"; exit 4; fi',
    'tmux kill-window -t "$session:telemetry" 2>/dev/null || true',
    "tmux new-window -t \"$session\" -n telemetry -c \"$HOME/workspace\" \"while true; do python3 '$HOME/bin/pi_telemetry_sidecar.py' || true; sleep 2; done\"",
    'i=0',
    'while [ "$i" -lt 10 ]; do',
    '  code="$(curl --noproxy \'*\' -s -o /dev/null -m 3 -w \'%{http_code}\' http://127.0.0.1:9911/api/telemetry/overview 2>/dev/null || printf 000)"',
    '  case "$code" in 200|401) printf "TELEMETRY_UP code=%s\\n" "$code"; exit 0 ;; esac',
    '  i=$((i + 1))',
    '  sleep 1',
    'done',
    'printf "TELEMETRY_DOWN\\n"',
    'exit 5',
  ].join('\n'));
}

export function buildSwitchModelCommand(provider, model) {
  const hit = ALLOWED_MODELS.find((m) => m.provider === provider && m.model === model);
  if (!hit) throw new Error('ERR_MODEL_NOT_ALLOWED');
  const providerKeyPath = `${PI_AGENT_DIR}/.provider_keys/${provider}`;
  const legacyKeyPath = `${PI_AGENT_DIR}/.provider_key`;
  const settingsPath = `${PI_AGENT_DIR}/settings.json`;
  const keyResolution = provider === 'zai'
    ? `key_file="${providerKeyPath}"; [ -s "$key_file" ] || key_file="${legacyKeyPath}"`
    : `key_file="${providerKeyPath}"`;
  const updateSettings = [
    `python3 - "${settingsPath}" '${provider}' '${model}' <<'PY'`,
    'import json',
    'import os',
    'import sys',
    'path, provider, model = sys.argv[1:4]',
    'with open(path, encoding="utf-8") as handle:',
    '    config = json.load(handle)',
    'if not isinstance(config, dict):',
    '    raise SystemExit("ERR_SETTINGS_NOT_OBJECT")',
    'config["defaultProvider"] = provider',
    'config["defaultModel"] = model',
    'tmp_path = path + ".tmp"',
    'with open(tmp_path, "w", encoding="utf-8", newline="\\n") as handle:',
    '    json.dump(config, handle, indent=2, ensure_ascii=False)',
    '    handle.write("\\n")',
    '    handle.flush()',
    '    os.fsync(handle.fileno())',
    'os.chmod(tmp_path, 0o600)',
    'os.replace(tmp_path, path)',
    'PY',
  ].join('\n');
  // settings.json 是可审计配置真源，pin 文件供 daemon 快速读取；
  // 切换完成后直接从 pin 读取实际值并启动 Pi，避免 daemon 推导层与配置漂移。
  return b64Envelope([
    keyResolution,
    'if [ ! -s "$key_file" ]; then echo ERR_PROVIDER_KEY_MISSING; exit 2; fi',
    updateSettings,
    `printf '${provider}\\n' > ${PI_AGENT_DIR}/.provider_name`,
    `printf '${model}\\n' > ${PI_AGENT_DIR}/.provider_model`,
    `chmod 600 ${PI_AGENT_DIR}/.provider_name ${PI_AGENT_DIR}/.provider_model`,
    'tmux kill-session -t pi-a2a 2>/dev/null || true',
    "PIN_PROVIDER=\"$(tr -d ' \\t\\r\\n' < \"$HOME/.pi/agent/.provider_name\")\"",
    "PIN_MODEL=\"$(tr -d ' \\t\\r\\n' < \"$HOME/.pi/agent/.provider_model\")\"",
    'case "$PIN_PROVIDER/$PIN_MODEL" in',
    '  zai/glm-5.3-flash)',
    '    export PI_PROVIDER_ENV=ZAI_API_KEY',
    '    export ZAI_API_KEY="$(cat "$key_file")"',
    '    ;;',
    '  deepseek/deepseek-v4.1-flash)',
    '    export PI_PROVIDER_ENV=DEEPSEEK_API_KEY',
    '    export DEEPSEEK_API_KEY="$(cat "$key_file")"',
    '    ;;',
    '  *)',
    '    echo ERR_LAUNCH_MODEL_MISMATCH provider="$PIN_PROVIDER" model="$PIN_MODEL"',
    '    exit 1',
    '    ;;',
    'esac',
    "LAUNCHER_MODEL=\"$PIN_MODEL\"",
    'if [ ! -f "$HOME/bin/pi_a2a_launch.sh" ]; then echo ERR_LAUNCHER_MISSING path=$HOME/bin/pi_a2a_launch.sh; exit 3; fi',
    'tmux new-session -d -s pi-a2a -n a2a-server -c "$HOME/workspace/projects" \\',
    "  \"exec bash '$HOME/bin/pi_a2a_launch.sh' '$LAUNCHER_MODEL' high\"",
    'if ! curl --noproxy "*" -fsS --max-time 4 http://127.0.0.1:9910/.well-known/agent-card.json >/dev/null 2>&1; then',
    '  echo ERR_SERVER_NOT_READY',
    '  exit 1',
    'fi',
    'echo PIN_PROVIDER=$PIN_PROVIDER',
    'echo PIN_MODEL=$PIN_MODEL',
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

/** 构造 A2A JSON-RPC 请求，便于测试和审计请求体。 */
export function buildA2ARpcPayload(method, params) {
  return {
    jsonrpc: '2.0',
    id: `rpc-18787-${Date.now()}`,
    method,
    params,
  };
}

export function buildSendMessageParams(promptText, returnImmediately = false) {
  return {
    message: {
      messageId: `msg-18787-${Date.now()}`,
      role: 'ROLE_USER',
      parts: [{ text: promptText }],
    },
    configuration: { returnImmediately: returnImmediately === true },
  };
}

function postA2ARpc(method, params, token, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(buildA2ARpcPayload(method, params)), 'utf8');
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

/** 派发 A2A v1.0 SendMessage：PC 直连 adb forward 的 9910，token 从手机现读。 */
export function postA2ARequest(promptText, token, timeoutMs = 240000, options = {}) {
  const params = buildSendMessageParams(promptText, options.returnImmediately === true);
  return postA2ARpc('SendMessage', params, token, timeoutMs);
}

/** 读取已派发任务，不重新发送 SendMessage。 */
export function getA2ATask(taskId, token, timeoutMs = 30000) {
  return postA2ARpc('GetTask', { id: taskId }, token, timeoutMs);
}

/** 超时或人工中止时回收 Pi 侧任务。 */
export function cancelA2ATask(taskId, token, timeoutMs = 15000) {
  return postA2ARpc('CancelTask', { id: taskId }, token, timeoutMs);
}

/** 从 SendMessage/GetTask 的 JSON-RPC 数据中取任务对象。 */
export function extractTaskFromRpcData(data) {
  const envelope = data?.task ?? data?.result ?? null;
  return envelope?.task ?? envelope;
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

/**
 * 把 A2A 读取结果归成可行动的一档（第二十九轮 ⑦）。
 *
 * 旧实现把所有失败都压成 status:0，前端只能显示「不可达」，而「forward 没建」
 * 与「pi 没起」与「超时」的处置完全不同。这里保留 status 语义不变，另补 reason，
 * 让上层能给出「该补哪一条」的结论，而不是让人去猜。
 * @param {{status:number, reason?:string}} card
 * @returns {{status:string, reason:string}} status 是粗档，reason 是给运维看的一句话
 */
export function classifyAgentCard(card) {
  if (card?.status === 200) return { status: 'ok', reason: 'A2A 9910 可达' };
  const why = card?.reason || 'http';
  if (why === 'refused') {
    return {
      status: 'tunnel_down',
      reason: 'A2A 9910 无监听：adb forward tcp:9910 未建，或手机侧 pi-a2a 服务未在跑',
    };
  }
  if (why === 'timeout') {
    return { status: 'timeout', reason: 'A2A 9910 5 秒无响应：pi 进程在但被阻塞，看 daemon.log' };
  }
  if (why === 'reset') {
    return { status: 'reset', reason: 'A2A 9910 连接被重置：手机侧进程刚退出，等 daemon 60 秒自愈' };
  }
  if (why === 'invalid_json') {
    return { status: 'bad_card', reason: 'A2A 有响应但不是合法 AgentCard JSON：检查 pi_a2a_launch.sh 输出' };
  }
  if (typeof card?.status === 'number' && card.status > 0) {
    return { status: `http_${card.status}`, reason: `A2A 返回 HTTP ${card.status}：卡片端点异常` };
  }
  return { status: 'unknown', reason: 'A2A 读取失败且未归类：检查 9910 端口占用' };
}

export function fetchAgentCard() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
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
            done({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')), reason: null });
          } catch {
            done({ status: 0, data: null, reason: 'invalid_json' });
          }
        });
      }
    );
    req.on('error', (cause) => {
      const code = cause && cause.code ? String(cause.code) : '';
      const reason = code.includes('ECONNREFUSED') || code.includes('ENOENT')
        ? 'refused'
        : code.includes('ETIMEDOUT')
          ? 'timeout'
          : code.includes('ECONNRESET') || code.includes('EPIPE')
            ? 'reset'
            : 'error';
      done({ status: 0, data: null, reason });
    });
    req.on('timeout', () => { req.destroy(); done({ status: 0, data: null, reason: 'timeout' }); });
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

