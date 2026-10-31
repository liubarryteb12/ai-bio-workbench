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

test('runTask 生产路径在主节点离线时把新任务下发到显式备用节点并记账', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-run-failover-'));
  const actionFile = path.join(dir, 'actions.jsonl');
  const previousNodes = process.env.BIO_COMPUTE_NODES;
  const previousActions = process.env.BIO_ACTIONS_LEDGER;
  process.env.BIO_COMPUTE_NODES = JSON.stringify(nodes);
  process.env.BIO_ACTIONS_LEDGER = actionFile;
  t.after(() => {
    if (previousNodes === undefined) delete process.env.BIO_COMPUTE_NODES;
    else process.env.BIO_COMPUTE_NODES = previousNodes;
    if (previousActions === undefined) delete process.env.BIO_ACTIONS_LEDGER;
    else process.env.BIO_ACTIONS_LEDGER = previousActions;
  });

  t.mock.method(childProcess, 'spawnSync', (_program, args) => {
    const host = args.at(-2);
    if (host === 'k40-ubuntu') {
      return { status: 255, stdout: '', stderr: 'ssh: connect to host k40-ubuntu: Connection timed out' };
    }
    return { status: 0, stdout: 'TEMP|48000\nNODE_HEALTH_END\n', stderr: '' };
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
  assert.equal(spawned.length, 1, '健康检查不应被打成任务执行');
  assert.equal(spawned[0].program, 'ssh');
  assert.equal(spawned[0].args.at(-2), 'backup-arm64');
  const action = JSON.parse(fs.readFileSync(actionFile, 'utf8'));
  assert.equal(action.from_node_id, 'k40-ubuntu');
  assert.equal(action.to_node_id, 'backup-arm64');
  assert.equal(action.reason, 'offline');
});

test('runTask 生产路径在主节点达到 95C 时切换到备用节点', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-run-hot-'));
  const actionFile = path.join(dir, 'actions.jsonl');
  const previousNodes = process.env.BIO_COMPUTE_NODES;
  const previousActions = process.env.BIO_ACTIONS_LEDGER;
  process.env.BIO_COMPUTE_NODES = JSON.stringify(nodes);
  process.env.BIO_ACTIONS_LEDGER = actionFile;
  t.after(() => {
    if (previousNodes === undefined) delete process.env.BIO_COMPUTE_NODES;
    else process.env.BIO_COMPUTE_NODES = previousNodes;
    if (previousActions === undefined) delete process.env.BIO_ACTIONS_LEDGER;
    else process.env.BIO_ACTIONS_LEDGER = previousActions;
  });

  t.mock.method(childProcess, 'spawnSync', (_program, args) => {
    const host = args.at(-2);
    return host === 'k40-ubuntu'
      ? { status: 0, stdout: 'TEMP|96000\nNODE_HEALTH_END\n', stderr: '' }
      : { status: 0, stdout: 'TEMP|47000\nNODE_HEALTH_END\n', stderr: '' };
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
  assert.equal(spawned[0].args.at(-2), 'backup-arm64');
  const action = JSON.parse(fs.readFileSync(actionFile, 'utf8'));
  assert.equal(action.reason, 'temperature_threshold');
  assert.equal(action.within_10s, true);
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
  assert.equal(spawned[0].args.at(-2), 'k40-ubuntu');
});
