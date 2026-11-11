import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  buildFailoverAction,
  appendAction,
  evaluateNode,
  selectComputeNode,
  routeTask,
} from '../server/task.js';
import { runTask } from '../server/run.js';
import { ADB_EXEC_SCRIPT } from '../server/proc.js';

const nodes = [
  { id: 'k40-ubuntu', host: 'k40-ubuntu', primary: true },
  { id: 'backup-arm64', host: 'backup-arm64', primary: false },
];

test('主节点温度 >= 95C 时选择备用节点', () => {
  const health = {
    'k40-ubuntu': { reachable: true, tempC: 96 },
    'backup-arm64': { reachable: true, tempC: 48 },
  };
  const result = selectComputeNode(nodes, health, () => 1000);
  assert.equal(result.id, 'backup-arm64');
  assert.ok(result.elapsedMs < 10000);
});

test('主节点离线时选择备用节点', () => {
  const health = {
    'k40-ubuntu': { reachable: false, tempC: 48 },
    'backup-arm64': { reachable: true, tempC: 47 },
  };
  const result = selectComputeNode(nodes, health, () => 2000);
  assert.equal(result.id, 'backup-arm64');
  assert.ok(result.elapsedMs < 10000);
});

test('节点故障写 action 台账', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-failover-'));
  const file = path.join(dir, 'actions.jsonl');
  const action = buildFailoverAction({
    fromNodeId: 'k40-ubuntu',
    toNodeId: 'backup-arm64',
    reason: 'temperature_threshold',
    taskId: 'task-1',
    now: 3000,
  });
  assert.equal(action.from_node_id, 'k40-ubuntu');
  assert.equal(action.to_node_id, 'backup-arm64');
  assert.equal(action.reason, 'temperature_threshold');
  assert.equal(action.within_10s, true);
  appendAction(file, action);
  const text = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(text);
  assert.equal(parsed.to_node_id, 'backup-arm64');
});

test('routeTask 主节点故障时执行备用节点并写动作台账', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-route-'));
  const file = path.join(dir, 'actions.jsonl');
  const calls = [];
  const result = await routeTask({}, {
    nodes,
    healthByNodeId: {
      'k40-ubuntu': { reachable: false, tempC: 48 },
      'backup-arm64': { reachable: true, tempC: 47 },
    },
    executor: async (task, node) => {
      calls.push(node.id);
      return { ok: true };
    },
    now: () => 5000,
    actionPath: file,
  });
  assert.equal(result.nodeId, 'backup-arm64');
  assert.deepEqual(calls, ['backup-arm64']);
  const action = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(action.from_node_id, 'k40-ubuntu');
  assert.equal(action.to_node_id, 'backup-arm64');
  assert.equal(action.reason, 'offline');
  assert.equal(action.within_10s, true);
});

test('runTask 单通道下固定使用主节点，不再做多节点健康探活', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-run-failover-'));
  const actionFile = path.join(dir, 'actions.jsonl');
  const previousNodes = process.env.BIO_COMPUTE_NODES;
  const previousActions = process.env.BIO_ACTIONS_LEDGER;
  const previousAdapter = process.env.BIO_COMPUTE_ADAPTER;
  process.env.BIO_COMPUTE_NODES = JSON.stringify(nodes);
  process.env.BIO_ACTIONS_LEDGER = actionFile;
  // SSH 已封存，P-29 冲突源收口后生产路径固定单设备；
  // 多节点 failover 只在注入 healthByNodeId 的纯函数路径保留。
  process.env.BIO_COMPUTE_ADAPTER = 'adb';
  t.after(() => {
    if (previousNodes === undefined) delete process.env.BIO_COMPUTE_NODES;
    else process.env.BIO_COMPUTE_NODES = previousNodes;
    if (previousActions === undefined) delete process.env.BIO_ACTIONS_LEDGER;
    else process.env.BIO_ACTIONS_LEDGER = previousActions;
    if (previousAdapter === undefined) delete process.env.BIO_COMPUTE_ADAPTER;
    else process.env.BIO_COMPUTE_ADAPTER = previousAdapter;
  });

  t.mock.method(childProcess, 'spawnSync', () => {
    throw new Error('单通道不应再发起节点健康探针');
  });

  const spawned = [];
  t.mock.method(childProcess, 'spawn', (program, args) => {
    spawned.push({ program, args });
    const child = new EventEmitter();
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    child.kill = () => {};
    return child;
  });

  const handle = runTask({
    projectId: 'default',
    lineId: 'line1_bulk',
    step: 'qc_matrix',
    inputs: [],
    outputs: [],
    seed: 20261013,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.ok(handle.id, '生产 runTask 应返回任务句柄');
  assert.equal(spawned.length, 1, '任务执行只有一次');
  assert.equal(spawned[0].program, 'pwsh');
  assert.match(JSON.stringify(spawned), /adb_exec\.ps1/);
  assert.equal(fs.existsSync(actionFile), false, '单通道不应产生 failover 台账');
});

test('runTask 单通道下温度健康探针已封存', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-run-hot-'));
  const actionFile = path.join(dir, 'actions.jsonl');
  const previousNodes = process.env.BIO_COMPUTE_NODES;
  const previousActions = process.env.BIO_ACTIONS_LEDGER;
  const previousAdapter = process.env.BIO_COMPUTE_ADAPTER;
  process.env.BIO_COMPUTE_NODES = JSON.stringify(nodes);
  process.env.BIO_ACTIONS_LEDGER = actionFile;
  process.env.BIO_COMPUTE_ADAPTER = 'adb';
  t.after(() => {
    if (previousNodes === undefined) delete process.env.BIO_COMPUTE_NODES;
    else process.env.BIO_COMPUTE_NODES = previousNodes;
    if (previousActions === undefined) delete process.env.BIO_ACTIONS_LEDGER;
    else process.env.BIO_ACTIONS_LEDGER = previousActions;
    if (previousAdapter === undefined) delete process.env.BIO_COMPUTE_ADAPTER;
    else process.env.BIO_COMPUTE_ADAPTER = previousAdapter;
  });

  t.mock.method(childProcess, 'spawnSync', () => {
    throw new Error('单通道不应再发起节点健康探针');
  });

  const spawned = [];
  t.mock.method(childProcess, 'spawn', (program, args) => {
    spawned.push({ program, args });
    const child = new EventEmitter();
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    child.kill = () => {};
    return child;
  });

  runTask({
    projectId: 'default',
    lineId: 'line1_bulk',
    step: 'qc_matrix',
    inputs: [],
    outputs: [],
    seed: 20261013,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].program, 'pwsh');
  assert.equal(fs.existsSync(actionFile), false, '单通道不应产生 failover 台账');
});

test('未配置备用节点时保持 K40 主路径且不产生额外健康探针', async (t) => {
  const previousNodes = process.env.BIO_COMPUTE_NODES;
  delete process.env.BIO_COMPUTE_NODES;
  t.after(() => {
    if (previousNodes === undefined) delete process.env.BIO_COMPUTE_NODES;
    else process.env.BIO_COMPUTE_NODES = previousNodes;
  });

  let healthProbes = 0;
  t.mock.method(childProcess, 'spawnSync', () => {
    healthProbes += 1;
    throw new Error('未配置备用节点时不应探活');
  });
  const spawned = [];
  t.mock.method(childProcess, 'spawn', (program, args) => {
    spawned.push({ program, args });
    const child = new EventEmitter();
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    child.kill = () => {};
    return child;
  });

  runTask({
    projectId: 'default',
    lineId: 'line1_bulk',
    step: 'qc_matrix',
    inputs: [],
    outputs: [],
    seed: 20261013,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(healthProbes, 0);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].program, 'pwsh', '默认 ADB 主通道应经 adb_exec 包装');
  assert.ok(spawned[0].args.includes(ADB_EXEC_SCRIPT), '应使用 tools/ops/adb_exec.ps1');
  assert.equal(spawned[0].args.at(-2), '-Command');
});
