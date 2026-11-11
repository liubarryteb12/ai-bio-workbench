#!/usr/bin/env node
/**
 * 第 27 道门禁：队列单消费者与终态闸门。
 *
 * 判据三条：
 *   1. 队列契约测试全绿（幂等入队、终态 409、重启恢复、单消费者、失败收敛）；
 *   2. 行为验证：同一作业并发执行，执行体只能被调用一次；
 *   3. 变异自证：拆掉终态判定、状态判定与 inflight 标记后，第 2 条必须变红。

 * 只拆 inflight 是不够的（状态判定会兜住），所以变异要三处同拆，
 * 这正是「双重防线」与「空断言」的分界线。
 *
 * 铁律：变异只在同目录临时副本上做，跑完立即删。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const APP = path.join(REPO, 'BioanalysDesktop');
const SERVICE = path.join(APP, 'server', 'services', 'work_order.service.js');

function fail(message) {
  console.error('[RED] ' + message);
  process.exitCode = 1;
}

function runContractTest() {
  const result = spawnSync(process.execPath, ['--test', 'tests/work_order_queue_contract.test.js'], {
    cwd: APP,
    encoding: 'utf8',
    timeout: 120000,
  });
  const tail = String(result.stdout || '').trim().split('\n').slice(-3).join(' | ');
  if (result.status !== 0) {
    fail('队列契约测试未通过：' + tail);
    return false;
  }
  console.log('[ OK ] 队列契约测试 5 条全绿');
  return true;
}

function buildRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-gate-'));
  const dir = path.join(root, 'workspace', 'projects', 'PRJ_GATE', 'work_orders');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'WO-GATE-001.json'), JSON.stringify({ schema_version: 'work_order/v2' }));
  fs.writeFileSync(path.join(dir, 'WO-GATE-001.meta.json'), JSON.stringify({
    status: 'queued',
    work_order_id: 'WO-GATE-001',
    project_id: 'PRJ_GATE',
    line_id: 'line1_bulk',
    approved: true,
  }));
  return root;
}

/** 并发执行同一作业，返回执行体被调用的次数与第二个调用的结局。 */
async function probeSingleConsumer(serviceFile) {
  const mod = await import(pathToFileURL(serviceFile).href + '?t=' + Date.now());
  const root = buildRoot();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let runs = 0;
  const runWorkOrderFn = async () => {
    runs += 1;
    await Promise.race([gate, new Promise((resolve) => setTimeout(resolve, 50))]);
    return { ok: true };
  };
  try {
    const first = mod.executeWorkOrderById('WO-GATE-001', root, { runWorkOrderFn }).catch((cause) => cause);
    const second = await mod.executeWorkOrderById('WO-GATE-001', root, { runWorkOrderFn }).catch((cause) => cause);
    release();
    await first;
    return { runs, secondCode: second && second.code };
  } finally {
    release();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function judge(outcome) {
  const green = outcome.runs === 1 && outcome.secondCode === 'ERR_WORK_ORDER_STATE';
  return { green, detail: '执行体调用 ' + outcome.runs + ' 次，第二调用 code=' + outcome.secondCode };
}

async function checkWithMutation() {
  const baseline = judge(await probeSingleConsumer(SERVICE));
  if (!baseline.green) {
    fail('基线不绿：同一作业被并发执行 ' + baseline.detail);
    return false;
  }
  console.log('[ OK ] 基线：' + baseline.detail);

  const source = fs.readFileSync(SERVICE, 'utf8');
  const blocks = [
    '  if (TERMINAL_STATUSES.has(String(meta.status))) {\n'
      + '    fail(\'ERR_WORK_ORDER_STATE\', `作业已处于终态，不能重复执行: ${meta.status}`, 409);\n  }',
    '  if (String(meta.status) !== \'queued\') {\n'
      + '    fail(\'ERR_WORK_ORDER_STATE\', `作业当前状态不可执行: ${meta.status}`, 409);\n  }',
    '  if (inflight.has(orderFile)) {\n'
      + '    fail(\'ERR_WORK_ORDER_STATE\', \'作业正在执行，拒绝重复触发\', 409);\n  }',
  ];
  const missing = blocks.filter((block) => !source.includes(block));
  if (missing.length) {
    fail('变异锚点漂移：有 ' + missing.length + ' 处闸门不在预期位置，门禁已失去观测能力');
    return false;
  }

  let mutated = source;
  for (const block of blocks) mutated = mutated.replace(block, '  // MUTATION');
  const copy = path.join(path.dirname(SERVICE), `.mut-queue-${process.pid}.mjs`);
  try {
    fs.writeFileSync(copy, mutated, 'utf8');
    const outcome = judge(await probeSingleConsumer(copy));
    if (outcome.green) {
      fail('变异存活：三处闸门全拆后仍只执行一次，单消费者判定是空的');
      return false;
    }
    console.log('[ OK ] 变异：三处闸门全拆后判据变红（' + outcome.detail + '）');
    return true;
  } finally {
    try { fs.rmSync(copy, { force: true }); } catch { /* 临时副本删不掉不影响结论 */ }
  }
}

async function main() {
  const testsOk = runContractTest();
  const mutationOk = await checkWithMutation();
  if (testsOk && mutationOk && process.exitCode !== 1) {
    console.log('WORK_ORDER_QUEUE_GATE_OK');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main();
}
