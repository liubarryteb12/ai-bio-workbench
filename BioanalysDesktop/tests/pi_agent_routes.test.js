import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appendPiLedger,
  handlePiAgentRoutes,
  parseBattery,
} from '../server/pi_agent_routes.js';

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

test('非 pi-agent 路径不接管', async () => {
  const captureSink = capture();
  const handled = await handlePiAgentRoutes(
    makeRequest('GET', '/api/health'),
    {},
    new URL('http://x/api/health'),
    { json: captureSink.json, runSshRaw: () => { throw new Error('must not run'); } }
  );
  assert.equal(handled, false);
  assert.equal(captureSink.responses.length, 0);
});

test('GET ping 返回 Agent Card 可达状态', async () => {
  const captureSink = capture();
  const handled = await handlePiAgentRoutes(
    makeRequest('GET', '/api/pi-agent/ping'),
    {},
    new URL('http://x/api/pi-agent/ping'),
    {
      json: captureSink.json,
      runSshRaw: () => { throw new Error('must not run'); },
      fetchAgentCard: async () => ({
        status: 200,
        data: { name: 'pi-termux-executor', version: '1.0.0' },
      }),
    }
  );
  assert.equal(handled, true);
  assert.equal(captureSink.responses[0].status, 200);
  assert.deepEqual(captureSink.responses[0].payload, {
    ok: true,
    online: true,
    agent_card: { name: 'pi-termux-executor', version: '1.0.0' },
  });
});

test('GET 模型返回真实 provider/model 与白名单', async () => {
  const captureSink = capture();
  const handled = await handlePiAgentRoutes(
    makeRequest('GET', '/api/pi-agent/model'),
    {},
    new URL('http://x/api/pi-agent/model'),
    {
      json: captureSink.json,
      runSshRaw: () => ({ code: 0, text: 'zai\nglm-5.3-flash' }),
    }
  );
  assert.equal(handled, true);
  assert.equal(captureSink.responses[0].status, 200);
  assert.deepEqual(captureSink.responses[0].payload.current, {
    provider: 'zai',
    model: 'glm-5.3-flash',
  });
  assert.equal(captureSink.responses[0].payload.allowed.length, 2);
});

test('POST 非白名单模型返回 400 且不执行 ssh', async () => {
  const captureSink = capture();
  let sshCalls = 0;
  const body = JSON.stringify({ provider: 'openai', model: 'gpt-4.1' });
  const handled = await handlePiAgentRoutes(
    makeRequest('POST', '/api/pi-agent/model', body),
    {},
    new URL('http://x/api/pi-agent/model'),
    {
      json: captureSink.json,
      runSshRaw: () => { sshCalls += 1; return { code: 0, text: 'SWITCH_OK' }; },
    }
  );
  assert.equal(handled, true);
  assert.equal(captureSink.responses[0].status, 400);
  assert.match(captureSink.responses[0].payload.error, /ERR_MODEL_NOT_ALLOWED/);
  assert.equal(sshCalls, 0);
});

test('POST 已授权模型缺少 provider Key 返回 409', async () => {
  const captureSink = capture();
  const body = JSON.stringify({ provider: 'deepseek', model: 'deepseek-v4.1-flash' });
  const handled = await handlePiAgentRoutes(
    makeRequest('POST', '/api/pi-agent/model', body),
    {},
    new URL('http://x/api/pi-agent/model'),
    {
      json: captureSink.json,
      runSshRaw: (_target, command) => {
        assert.match(command, /^echo [A-Za-z0-9+/=]+ \| base64 -d \| bash$/);
        const script = Buffer.from(command.match(/^echo ([A-Za-z0-9+/=]+)/)[1], 'base64').toString('utf8');
        assert.match(script, /\.provider_keys\/deepseek/);
        return { code: 2, text: 'ERR_PROVIDER_KEY_MISSING\n' };
      },
    }
  );
  assert.equal(handled, true);
  assert.equal(captureSink.responses[0].status, 409);
  assert.equal(captureSink.responses[0].payload.error, 'ERR_PROVIDER_KEY_MISSING');
});

test('POST 成功后按远程实际状态回显并写台账', async () => {
  const captureSink = capture();
  const ledgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-model-ledger-'));
  const body = JSON.stringify({ provider: 'zai', model: 'glm-5.3-flash' });
  const handled = await handlePiAgentRoutes(
    makeRequest('POST', '/api/pi-agent/model', body),
    {},
    new URL('http://x/api/pi-agent/model'),
    {
      json: captureSink.json,
      ledgerRoot,
      runSshRaw: (_target, command) => {
        const script = Buffer.from(command.match(/^echo ([A-Za-z0-9+/=]+)/)[1], 'base64')
          .toString('utf8');
        assert.match(script, /PIN_MODEL=/);
        return { code: 0, text: 'PIN_PROVIDER=zai\nPIN_MODEL=glm-5.3-flash\nSWITCH_OK\n' };
      },
    }
  );
  assert.equal(handled, true);
  assert.deepEqual(captureSink.responses[0].payload.current, {
    provider: 'zai',
    model: 'glm-5.3-flash',
  });
  const entry = JSON.parse(
    fs.readFileSync(path.join(ledgerRoot, 'con_hf', 'ledger', 'actions.jsonl'), 'utf8').trim()
  );
  assert.deepEqual(entry.detail, {
    actual_provider: 'zai',
    actual_model: 'glm-5.3-flash',
  });
});

test('POST 远程实际模型与请求不一致时返回 509 并写台账', async () => {
  const captureSink = capture();
  const ledgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-model-ledger-'));
  const body = JSON.stringify({ provider: 'zai', model: 'glm-5.3-flash' });
  const handled = await handlePiAgentRoutes(
    makeRequest('POST', '/api/pi-agent/model', body),
    {},
    new URL('http://x/api/pi-agent/model'),
    {
      json: captureSink.json,
      ledgerRoot,
      runSshRaw: () => ({
        code: 1,
        text: 'PIN_PROVIDER=deepseek\nPIN_MODEL=deepseek-v4.1-flash\nERR_LAUNCH_MODEL_MISMATCH\n',
      }),
    }
  );
  assert.equal(handled, true);
  assert.equal(captureSink.responses[0].status, 509);
  assert.deepEqual(captureSink.responses[0].payload, {
    ok: false,
    error: 'ERR_LAUNCH_MODEL_MISMATCH',
    actual: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
  });
  const entry = JSON.parse(
    fs.readFileSync(path.join(ledgerRoot, 'con_hf', 'ledger', 'actions.jsonl'), 'utf8').trim()
  );
  assert.deepEqual(entry.detail, {
    requested_provider: 'zai',
    requested_model: 'glm-5.3-flash',
    actual_provider: 'deepseek',
    actual_model: 'deepseek-v4.1-flash',
  });
});

test('dispatch 超过 4000 字符直接拒绝', async () => {
  const captureSink = capture();
  const body = JSON.stringify({ message: 'x'.repeat(4001) });
  await handlePiAgentRoutes(
    makeRequest('POST', '/api/pi-agent/dispatch', body),
    {},
    new URL('http://x/api/pi-agent/dispatch'),
    {
      json: captureSink.json,
      runSshRaw: () => { throw new Error('must not run'); },
    }
  );
  assert.equal(captureSink.responses[0].status, 400);
  assert.match(captureSink.responses[0].payload.error, /4000/);
});

test('dispatch 兼容 JSON-RPC result 包裹的任务对象', async () => {
  const captureSink = capture();
  const body = JSON.stringify({ message: 'ping' });
  let observedTimeoutMs = 0;
  let observedOptions = null;
  const ledgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dispatch-ledger-'));
  await handlePiAgentRoutes(
    makeRequest('POST', '/api/pi-agent/dispatch', body),
    {},
    new URL('http://x/api/pi-agent/dispatch'),
    {
      json: captureSink.json,
      ledgerRoot,
      runSshRaw: (_target, command) => {
        const script = Buffer.from(command.match(/^echo ([A-Za-z0-9+/=]+)/)[1], 'base64').toString('utf8');
        if (script.includes('.provider_model')) {
          return { code: 0, text: 'zai\nglm-5.3-flash' };
        }
        return { code: 0, text: 'token_'.padEnd(50, 'x') };
      },
      postA2ARequest: async (_prompt, _token, timeoutMs, options) => {
        observedTimeoutMs = timeoutMs;
        observedOptions = options;
        return {
          status: 200,
          data: {
            jsonrpc: '2.0',
            task: {
              task: { id: 'task-123', status: { state: 'TASK_STATE_COMPLETED' } },
            },
          },
        };
      },
    }
  );
  assert.equal(captureSink.responses[0].payload.ok, true);
  assert.equal(captureSink.responses[0].payload.task.id, 'task-123');
  assert.equal(captureSink.responses[0].payload.task.status.state, 'completed');
  assert.equal(captureSink.responses[0].payload.task.status.remote_state, 'TASK_STATE_COMPLETED');
  assert.ok(observedTimeoutMs >= 180000, `dispatch timeout too short: ${observedTimeoutMs}`);
  assert.deepEqual(observedOptions, { returnImmediately: true });
  assert.equal(
    captureSink.responses[0].payload.poll_url,
    '/api/pi-agent/task?id=task-123'
  );
  const entry = JSON.parse(
    fs.readFileSync(path.join(ledgerRoot, 'con_hf', 'ledger', 'actions.jsonl'), 'utf8').trim()
  );
  assert.deepEqual(entry.detail, {
    prompt: 'ping',
    status: 200,
    actual_provider: 'zai',
    actual_model: 'glm-5.3-flash',
  });
});

test('GET task 通过 GetTask 读取异步任务状态', async () => {
  const captureSink = capture();
  let observedId = '';
  // ledgerRoot 注入临时目录：task_poll 会写 actions 台账，测试不得污染 con_hf/ledger/ 正本
  const ledgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-task-ledger-'));
  await handlePiAgentRoutes(
    makeRequest('GET', '/api/pi-agent/task?id=task-456'),
    {},
    new URL('http://x/api/pi-agent/task?id=task-456'),
    {
      json: captureSink.json,
      ledgerRoot,
      runSshRaw: () => ({ code: 0, text: 'token_'.padEnd(50, 'x') }),
      getA2ATask: async (taskId) => {
        observedId = taskId;
        return {
          status: 200,
          data: { task: { id: taskId, status: { state: 'TASK_STATE_COMPLETED' } } },
        };
      },
    }
  );
  assert.equal(observedId, 'task-456');
  assert.equal(captureSink.responses[0].status, 200);
  assert.equal(captureSink.responses[0].payload.task.status.state, 'completed');
  assert.equal(captureSink.responses[0].payload.task.status.remote_state, 'TASK_STATE_COMPLETED');
});

test('POST task/cancel 通过 CancelTask 回收异步任务', async () => {
  const captureSink = capture();
  let observedId = '';
  const ledgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-cancel-ledger-'));
  await handlePiAgentRoutes(
    makeRequest('POST', '/api/pi-agent/task/cancel', JSON.stringify({ id: 'task-789' })),
    {},
    new URL('http://x/api/pi-agent/task/cancel'),
    {
      json: captureSink.json,
      ledgerRoot,
      runSshRaw: () => ({ code: 0, text: 'token_'.padEnd(50, 'x') }),
      cancelA2ATask: async (taskId) => {
        observedId = taskId;
        return {
          status: 200,
          data: { task: { id: taskId, status: { state: 'TASK_STATE_CANCELED' } } },
        };
      },
    }
  );
  assert.equal(observedId, 'task-789');
  assert.equal(captureSink.responses[0].status, 200);
  assert.equal(captureSink.responses[0].payload.task.status.state, 'canceled');
  assert.equal(captureSink.responses[0].payload.task.status.remote_state, 'TASK_STATE_CANCELED');
});

test('calls 从 telemetry.usage 取总数，兼容旧 totals 字段', async () => {
  const captureSink = capture();
  await handlePiAgentRoutes(
    makeRequest('GET', '/api/pi-agent/calls'),
    {},
    new URL('http://x/api/pi-agent/calls'),
    {
      json: captureSink.json,
      runSshRaw: () => ({ code: 0, text: 'token_'.padEnd(50, 'x') }),
      fetchTelemetry: async () => ({
        status: 200,
        data: {
          recent_calls: [{ task_id: 't1', model: 'glm-5.3-flash' }],
          usage: { total_calls: 19, input_tokens: 10, output_tokens: 5, cost_usd: 0 },
        },
      }),
    }
  );
  assert.equal(captureSink.responses[0].status, 200);
  assert.equal(captureSink.responses[0].payload.totals.total_calls, 19);
});

test('daemon logs 保留原始行，不按 transcript 解析成空数组', async () => {
  const captureSink = capture();
  await handlePiAgentRoutes(
    makeRequest('GET', '/api/pi-agent/logs?tail=5'),
    {},
    new URL('http://x/api/pi-agent/logs?tail=5'),
    {
      json: captureSink.json,
      runSshRaw: () => ({ code: 0, text: 'token_'.padEnd(50, 'x') }),
      fetchTelemetryViaPath: async () => ({
        status: 200,
        data: { source: 'pi_a2a_daemon.log', lines: ['line-1', 'line-2'] },
      }),
    }
  );
  assert.equal(captureSink.responses[0].status, 200);
  assert.deepEqual(captureSink.responses[0].payload.lines, ['line-1', 'line-2']);
  assert.deepEqual(captureSink.responses[0].payload.timeline, []);
});

test('appendPiLedger 追加 JSONL，解析失败电池字段降级', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ledger-'));
  appendPiLedger('probe', { ok: true }, root);
  const lines = fs.readFileSync(path.join(root, 'con_hf', 'ledger', 'actions.jsonl'), 'utf8')
    .trim()
    .split('\n');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.kind, 'mod_pi_observability');
  assert.equal(entry.action, 'probe');
  assert.deepEqual(parseBattery('unavailable (no perm)'), {
    percentage: 'unavailable',
    status: 'unavailable',
    plugged: 'unavailable',
    temperature: 'unavailable',
  });
});

test('POST /api/v1/a2a/heartbeat 接收遥测并返回 acked_step_ids', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-hb-'));
  const captureSink = capture();
  const heartbeatPayload = JSON.stringify({
    node_id: 'k40-ubuntu-node01',
    battery_temp_c: 39.2,
    mem_available_mb: 4120.5,
    thermal_state: 'NORMAL',
    throttle_count: 0,
    active_jobs_count: 1,
    completed_triads: [
      {
        task_id: 'TASK-HB-01',
        manifest_id: 'MAN-HB-01',
        step_id: 'step_01_qc_norm',
        exit_code: 0,
      },
    ],
  });

  const handled = await handlePiAgentRoutes(
    makeRequest('POST', '/api/v1/a2a/heartbeat', heartbeatPayload),
    {},
    new URL('http://x/api/v1/a2a/heartbeat'),
    {
      json: captureSink.json,
      runSshRaw: () => { throw new Error('must not run'); },
      ledgerRoot: root,
    }
  );

  assert.equal(handled, true);
  assert.equal(captureSink.responses.length, 1);
  assert.equal(captureSink.responses[0].status, 200);
  assert.equal(captureSink.responses[0].payload.ok, true);
  assert.deepEqual(captureSink.responses[0].payload.acked_step_ids, ['step_01_qc_norm']);
});
