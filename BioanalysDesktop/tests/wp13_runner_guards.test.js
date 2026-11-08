/**
 * WP-1.3 运行面守卫：热节流、P-26、P-27、P-29。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildTaskScript, isLongRunningStep as isServerLongStep } from '../server/task.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const WRAPPER = path.join(REPO, 'ops', 'run_throttled_task.sh');
const CHAIN_RUNNER = path.join(REPO, 'cn_debug', 'lib', 'chain_runner.mjs');

function executableLines(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

test('运行包装器在启动任务前执行 90C/78C 热冷却门禁', () => {
  const text = fs.readFileSync(WRAPPER, 'utf8');
  assert.match(text, /BIO_THERMAL_ROOT:-/);
  assert.match(text, /BIO_THERMAL_HOT_C:-90/);
  assert.match(text, /BIO_THERMAL_COOL_C:-78/);
  assert.match(text, /BIO_THERMAL_POLL_SECONDS:-30/);
  assert.match(text, /thermal_zone\*\/temp/);
  assert.match(text, /THERMAL_COOLDOWN/);
  assert.match(text, /sleep "\$THERMAL_POLL_SECONDS"/);
});

test('线程与内存防崩头由解释器启动钩子统一接线，母版不得回写 4 线程', () => {
  const sourceFiles = fs.readdirSync(path.join(REPO, 'tools', 'bio'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
  const overrides = [];
  for (const file of sourceFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/export (?:OMP|OPENBLAS|MKL|VECLIB_MAXIMUM|NUMEXPR)_NUM_THREADS=(\d+)/g)) {
      if (match[1] !== '3') overrides.push(`${path.relative(REPO, file)}: ${match[0]}`);
    }
  }
  assert.deepEqual(overrides, []);

  const pythonHook = fs.readFileSync(path.join(REPO, 'ops', 'layout_autoload', 'sitecustomize.py'), 'utf8');
  const rHook = fs.readFileSync(path.join(REPO, 'ops', 'layout_autoload', 'Rprofile'), 'utf8');
  assert.match(pythonHook, /enable_memory_guard\(7\.5\)/);
  assert.match(rHook, /setDTthreads\(3\)/);
  assert.match(rHook, /workers\s*=\s*2/);
  assert.match(rHook, /future\.globals\.maxSize\s*=\s*6\.0\s*\*\s*1024\^3/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(REPO, 'ops', 'bio_r_header.R'), 'utf8'),
    /set\.seed\(\s*\d+/,
  );
});

test('运行包装器不在容器内使用 find、ps 或 grep -r（P-29）', () => {
  const forbidden = /(^|[\s;&|])(find|ps)(?=\s|$)|\bgrep\s+-r\b/;
  const hits = executableLines(WRAPPER).filter((line) => forbidden.test(line));
  assert.deepEqual(hits, [], '容器内递归或进程扫描会喂饱 proot abort 环：\n' + hits.join('\n'));
});

test('生产提交层对全局 SSH 并发设 409 硬闸门', () => {
  // 提交层的 409 闸门随任务路由搬进 routes/tasks.routes.js。守卫扫「入口 + 归属模块」并集，
  // 三条断言正则一字不改。
  const text = [
    fs.readFileSync(path.join(REPO, 'BioanalysDesktop', 'server', 'index.js'), 'utf8'),
    fs.readFileSync(path.join(REPO, 'BioanalysDesktop', 'server', 'routes', 'tasks.routes.js'), 'utf8'),
  ].join('\n');
  assert.match(text, /runningTasks\.size > 0/);
  assert.match(text, /P-29 禁止并发 SSH/);
  assert.match(text, /json\(res, 409/);
});

test('P-26 保持 setsid nohup 脱离本机进程树', () => {
  const text = fs.readFileSync(CHAIN_RUNNER, 'utf8');
  assert.match(text, /setsid nohup bash/);
  assert.match(text, /< \/dev\/null/);
});

test('生产引擎对长步骤下发 setsid nohup 并启用包装器台账', () => {
  for (const step of ['l2_tf_scenic', 'scenic_tf', 'l2_ko_scrna', 'virtual_knockout']) {
    assert.equal(isServerLongStep(step), true, step);
  }
  const script = buildTaskScript({
    projectId: 'default',
    lineId: 'line2_scrna',
    step: 'scenic_tf',
    inputs: [],
    outputs: [],
    seed: 20261013,
    throttled: true,
    detached: true,
    wrapperTaskId: 'task_20261026_abcdef',
  });
  assert.match(script, /export BIO_WRAPPER_LEDGER=1/);
  assert.match(script, /setsid nohup bash \/mnt\/ssd\/bio_data\/ops\/run_throttled_task\.sh/);
  assert.match(script, /< \/dev\/null &/);
  assert.match(script, /echo 'task_20261026_abcdef'/);
  const runText = fs.readFileSync(path.join(REPO, 'BioanalysDesktop', 'server', 'run.js'), 'utf8');
  assert.match(runText, /DETACHED_POLL_INTERVAL_MS = Math\.max\(\s*60000/);
  assert.match(runText, /probeDetachedTask/);
  assert.match(runText, /wrapperLedgerPath = `\/tmp\/\$\{wrapperTaskId\}_ledger\.json`/);
});

test('P-27 长步骤固定 40 分钟档，其他步骤保留分钟档', async () => {
  const lib = await import(pathToFileURL(CHAIN_RUNNER).href);
  assert.equal(typeof lib.ledgerWaitMsForStep, 'function');
  assert.equal(lib.isLongRunningStep('l2_tf_scenic'), true);
  assert.equal(lib.isLongRunningStep('qc_cells'), false);
  for (const step of ['l2_tf_scenic', 'scenic_tf', 'l2_ko_scrna', 'virtual_knockout']) {
    assert.equal(lib.ledgerWaitMsForStep(step), 40 * 60 * 1000, step);
  }
  assert.equal(lib.ledgerWaitMsForStep('qc_cells', 5 * 60 * 1000), 5 * 60 * 1000);
  assert.equal(lib.ledgerWaitMsForStep('qc_cells'), 30 * 60 * 1000);
  assert.match(
    fs.readFileSync(CHAIN_RUNNER, 'utf8'),
    /ledgerWaitMsForStep\(spec\.step, spec\.ledgerWaitMs \|\| 120000\)/,
  );
  assert.match(
    fs.readFileSync(CHAIN_RUNNER, 'utf8'),
    /ledgerWaitMsForStep\(spec\.step, spec\.ledgerWaitMs\)/,
  );
});
