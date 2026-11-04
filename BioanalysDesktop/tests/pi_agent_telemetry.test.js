import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  TELEMETRY_URL,
  buildTelemetryProbeCommand,
  buildTelemetryRestartCommand,
  parseTelemetryProbe,
} from '../server/pi_agent.js';
import { handlePiAgentRoutes } from '../server/pi_agent_routes.js';

function makeRequest(method, url, body = '') {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  process.nextTick(() => {
    if (body) req.emit('data', body);
    req.emit('end');
  });
  return req;
}

function capture() {
  const responses = [];
  return {
    responses,
    json(res, status, payload) {
      responses.push({ status, payload });
    },
  };
}

function decodeEnvelope(command) {
  const match = String(command).match(/^echo ([A-Za-z0-9+/=]+) \| base64 -d \| bash$/);
  assert.ok(match, `unexpected ssh envelope: ${command}`);
  return Buffer.from(match[1], 'base64').toString('utf8');
}

const OVERVIEW_RAW = [
  'CARD_MARKER: OK',
  'MODEL_MARKER: zai/glm-5.3-flash',
  'MEM_MARKER: 4483/11507',
  'TMUX_MARKER: pi-a2a:1 windows (attached)',
  'BATT_MARKER: {"percentage": 82, "status": "Discharging"}',
].join('\n');

/** 按命令形态分派：探活 / 重建 / 取 token / 概览。 */
function sshStub({ probeCodes = ['000'], rebuildText = 'TELEMETRY_UP code=200', overviewRaw = OVERVIEW_RAW } = {}) {
  const codes = [...probeCodes];
  const calls = [];
  const runSshRaw = (target, command, options) => {
    calls.push(command);
    if (command.includes('TELEMETRY_CODE=')) {
      const code = codes.length > 1 ? codes.shift() : codes[0];
      return { text: `TELEMETRY_CODE=${code}`, code: 0 };
    }
    if (command.startsWith('echo ')) {
      const script = decodeEnvelope(command);
      if (script.includes('tmux has-session')) return { text: rebuildText, code: 0 };
      if (script.includes('.peer_token')) return { text: 'peer-token-value', code: 0 };
      if (script.includes('_MARKER')) return { text: overviewRaw, code: 0 };
    }
    return { text: '', code: 0 };
  };
  return { runSshRaw, calls };
}

test('侧车探活命令指向 9911 概览端点并解析三位状态码', () => {
  const command = buildTelemetryProbeCommand();
  assert.ok(command.includes(TELEMETRY_URL));
  assert.ok(command.includes("printf 'TELEMETRY_CODE=%s"));
  assert.deepEqual(parseTelemetryProbe('TELEMETRY_CODE=200'), { code: '200', alive: true });
  assert.deepEqual(parseTelemetryProbe('TELEMETRY_CODE=401'), { code: '401', alive: true });
  assert.deepEqual(parseTelemetryProbe('TELEMETRY_CODE=000'), { code: '000', alive: false });
  assert.deepEqual(parseTelemetryProbe(''), { code: '000', alive: false });
});

test('侧车重建脚本自愈：杀旧窗口、带重启循环、探活上限后报 DOWN', () => {
  const script = decodeEnvelope(buildTelemetryRestartCommand());
  assert.match(script, /tmux has-session -t "\$session"/);
  assert.match(script, /TELEMETRY_NO_SESSION[\s\S]*exit 3/);
  assert.match(script, /TELEMETRY_SIDECAR_MISSING[\s\S]*exit 4/);
  assert.match(script, /tmux kill-window -t "\$session:telemetry"/);
  assert.match(script, /while true; do python3 '\$HOME\/bin\/pi_telemetry_sidecar\.py' \|\| true; sleep 2; done/);
  assert.match(script, /case "\$code" in 200\|401\) printf "TELEMETRY_UP/);
  assert.match(script, /TELEMETRY_DOWN[\s\S]*exit 5/);
});

test('overview 在侧车离线时给出结构化状态而不是哑巴 null', async () => {
  const sink = capture();
  const { runSshRaw } = sshStub();
  const handled = await handlePiAgentRoutes(
    makeRequest('GET', '/api/pi-agent/overview'),
    {},
    new URL('http://x/api/pi-agent/overview'),
    {
      json: sink.json,
      runSshRaw,
      fetchAgentCard: async () => ({ status: 200, data: { name: 'pi-termux-executor' } }),
      fetchTelemetry: async () => ({ status: 0, data: null }),
    }
  );
  assert.equal(handled, true);
  const payload = sink.responses[0].payload;
  assert.equal(payload.telemetry, null);
  assert.equal(payload.telemetry_status, 'sidecar_down');
  assert.match(payload.telemetry_reason, /9911/);
});

test('overview 在侧车在线时状态为 ok 且 reason 为空', async () => {
  const sink = capture();
  const { runSshRaw } = sshStub();
  const handled = await handlePiAgentRoutes(
    makeRequest('GET', '/api/pi-agent/overview'),
    {},
    new URL('http://x/api/pi-agent/overview'),
    {
      json: sink.json,
      runSshRaw,
      fetchAgentCard: async () => ({ status: 200, data: { name: 'pi-termux-executor' } }),
      fetchTelemetry: async () => ({
        status: 200,
        data: { usage: { calls: 3 }, usage_by_model: [], recent_calls: [] },
      }),
    }
  );
  assert.equal(handled, true);
  const payload = sink.responses[0].payload;
  assert.equal(payload.telemetry_status, 'ok');
  assert.equal(payload.telemetry_reason, null);
  assert.equal(payload.telemetry.usage.calls, 3);
});

test('overview 侧车凭据失效时状态为 sidecar_unauthorized', async () => {
  const sink = capture();
  const { runSshRaw } = sshStub();
  await handlePiAgentRoutes(
    makeRequest('GET', '/api/pi-agent/overview'),
    {},
    new URL('http://x/api/pi-agent/overview'),
    {
      json: sink.json,
      runSshRaw,
      fetchAgentCard: async () => ({ status: 200, data: { name: 'pi-termux-executor' } }),
      fetchTelemetry: async () => ({ status: 401, data: null }),
    }
  );
  assert.equal(sink.responses[0].payload.telemetry_status, 'sidecar_unauthorized');
});

test('重建路由在侧车拉起后返回 200 并写审计台账', async () => {
  const ledgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-tele-'));
  const sink = capture();
  const { runSshRaw } = sshStub({ probeCodes: ['000', '200'] });
  const handled = await handlePiAgentRoutes(
    makeRequest('POST', '/api/pi-agent/telemetry/restart'),
    {},
    new URL('http://x/api/pi-agent/telemetry/restart'),
    {
      json: sink.json,
      runSshRaw,
      ledgerRoot,
      fetchTelemetry: async () => ({ status: 200, data: { usage: {} } }),
    }
  );
  assert.equal(handled, true);
  const { status, payload } = sink.responses[0];
  assert.equal(status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.outcome, 'up');
  assert.equal(payload.before_code, '000');
  assert.equal(payload.after_code, '200');
  assert.equal(payload.telemetry_status, 'ok');

  const ledger = fs.readFileSync(path.join(ledgerRoot, 'con_hf', 'ledger', 'actions.jsonl'), 'utf8');
  assert.match(ledger, /pi_agent_telemetry_restart/);
  fs.rmSync(ledgerRoot, { recursive: true, force: true });
});

test('重建路由在手机缺侧车脚本时给出 sidecar_missing 而不是静默成功', async () => {
  const sink = capture();
  const { runSshRaw } = sshStub({ probeCodes: ['000'], rebuildText: 'TELEMETRY_SIDECAR_MISSING' });
  await handlePiAgentRoutes(
    makeRequest('POST', '/api/pi-agent/telemetry/restart'),
    {},
    new URL('http://x/api/pi-agent/telemetry/restart'),
    { json: sink.json, runSshRaw, fetchTelemetry: async () => ({ status: 0, data: null }) }
  );
  const { status, payload } = sink.responses[0];
  assert.equal(status, 502);
  assert.equal(payload.ok, false);
  assert.equal(payload.outcome, 'sidecar_missing');
  assert.match(payload.error, /pi_telemetry_sidecar\.py/);
});

test('重建路由在无 tmux 会话时报 no_session', async () => {
  const sink = capture();
  const { runSshRaw } = sshStub({ probeCodes: ['000'], rebuildText: 'TELEMETRY_NO_SESSION' });
  await handlePiAgentRoutes(
    makeRequest('POST', '/api/pi-agent/telemetry/restart'),
    {},
    new URL('http://x/api/pi-agent/telemetry/restart'),
    { json: sink.json, runSshRaw, fetchTelemetry: async () => ({ status: 0, data: null }) }
  );
  assert.equal(sink.responses[0].payload.outcome, 'no_session');
});

test('重建后仍无响应时返回 502 sidecar_down', async () => {
  const sink = capture();
  const { runSshRaw } = sshStub({ probeCodes: ['000'], rebuildText: 'TELEMETRY_DOWN' });
  await handlePiAgentRoutes(
    makeRequest('POST', '/api/pi-agent/telemetry/restart'),
    {},
    new URL('http://x/api/pi-agent/telemetry/restart'),
    { json: sink.json, runSshRaw, fetchTelemetry: async () => ({ status: 0, data: null }) }
  );
  const { status, payload } = sink.responses[0];
  assert.equal(status, 502);
  assert.equal(payload.telemetry_status, 'sidecar_down');
  assert.match(payload.error, /9911/);
});

test('重建路由只接受 POST', async () => {
  const sink = capture();
  const handled = await handlePiAgentRoutes(
    makeRequest('GET', '/api/pi-agent/telemetry/restart'),
    {},
    new URL('http://x/api/pi-agent/telemetry/restart'),
    { json: sink.json, runSshRaw: () => { throw new Error('must not run'); } }
  );
  assert.equal(handled, false);
  assert.equal(sink.responses.length, 0);
});
