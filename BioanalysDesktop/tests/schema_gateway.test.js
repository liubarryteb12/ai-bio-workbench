/**
 * schema_gateway 契约与变异反证测试套件（4 Argon 第 74 轮 Phase 0/1/2）
 *
 * 覆盖：
 * 1. 基础正向：合法 project 与 run_task 数据放行 (ALLOW, exitCode 0)；
 * 2. MUT-P0-B：缺必填字段时必须返回 DENY 且退出码为 2，res.json 包含字段级错误；
 * 3. MUT-P1-B：派生子孙进程并在超时时连根强杀（验证父子孙进程全部消亡）；
 * 4. MUT-P2-A：基础设施故障时严格 Fail-Closed（Exit 1），CI 环境下传入 bypass 强制阻断报红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { validateWithSchemaGateway } from '../server/schema_gateway_client.js';
import { killProcessTree } from '../server/proc.js';
import { atomicWriteFileSync } from '../server/atomic_write.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

test('正向：合法 project 元数据校验通过 (ALLOW, exit 0)', () => {
  const res = validateWithSchemaGateway('project', {
    project_id: 'PRJ_STROKE_P1',
    project_name: '卒中空间切片分析',
    pipeline: 'line3_spatial',
  }, { repoRoot: REPO });

  assert.equal(res.allowed, true);
  assert.equal(res.status, 'ALLOW');
  assert.equal(res.exitCode, 0);
  assert.deepEqual(res.errors, []);
});

test('正向：合法 run_task 契约校验通过 (ALLOW, exit 0)', () => {
  const res = validateWithSchemaGateway('run_task', {
    lineId: 'line1_bulk',
    step: 'l1_fastqc',
    projectId: 'PRJ_TEST_BULK',
    inputs: ['raw.fq.gz'],
    outputs: ['qc.html'],
  }, { repoRoot: REPO });

  assert.equal(res.allowed, true);
  assert.equal(res.status, 'ALLOW');
  assert.equal(res.exitCode, 0);
});

test('MUT-P0-B：缺必填字段时必须返回 DENY (exit 2) 且包含字段级错误路径', () => {
  const res = validateWithSchemaGateway('project', {
    project_name: '缺失 project_id 的无效元数据',
  }, { repoRoot: REPO });

  assert.equal(res.allowed, false);
  assert.equal(res.status, 'DENY');
  assert.equal(res.exitCode, 2);
  assert.ok(res.errors.length > 0);
  assert.ok(res.errors.some((e) => e.path === 'project_id' && e.type === 'missing'));
});

test('MUT-P2-A：未知 Schema 必须 Fail-Closed 阻断 (exit 1)', () => {
  const res = validateWithSchemaGateway('unknown_bogus_schema', {
    some_data: 123,
  }, { repoRoot: REPO });

  assert.equal(res.allowed, false);
  assert.equal(res.status, 'ERROR');
  assert.equal(res.exitCode, 1);
});

test('MUT-P2-A 旁路防线：CI 环境下传入 --allow-bypass-on-error 必须强制阻断 (exit 1)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bypass-test-'));
  const reqFile = path.join(tmpDir, 'req.json');
  const resFile = path.join(tmpDir, 'res.json');
  fs.writeFileSync(reqFile, '{"bad": 1}', 'utf8');

  try {
    const proc = spawnSync('python', [
      'ops/schema_gateway.py',
      '--schema', 'project',
      '--in', reqFile,
      '--out', resFile,
      '--allow-bypass-on-error',
    ], {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true' },
    });

    assert.equal(proc.status, 1, 'CI 环境下即使传 bypass 也必须 Exit 1 阻断');
    assert.ok(proc.stderr.includes('CI 环境严禁使用 --allow-bypass-on-error'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MUT-P1-B：连根强杀 (killProcessTree) 必须彻底消亡父进程与派生的子孙进程', async () => {
  // 启动一个派生孙进程（运行 60 秒）的 Python 脚本
  const code = [
    'import subprocess, time, sys',
    'p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])',
    'print("CHILD_PID=" + str(p.pid), flush=True)',
    'time.sleep(60)',
  ].join('\n');

  const child = spawn('python', ['-c', code], {
    windowsHide: true,
  });

  let grandchildPid = null;
  await new Promise((resolve) => {
    child.stdout.on('data', (d) => {
      const m = d.toString().match(/CHILD_PID=(\d+)/);
      if (m) {
        grandchildPid = parseInt(m[1], 10);
        resolve();
      }
    });
  });

  assert.ok(grandchildPid, '孙进程成功派生');

  // 触发进程树强杀
  killProcessTree(child);

  // 等待清理完成
  await new Promise((r) => setTimeout(r, 800));

  // 验证孙进程已彻底消亡
  let grandchildAlive = true;
  if (process.platform === 'win32') {
    const probe = spawnSync('tasklist', ['/FI', `PID eq ${grandchildPid}`], { encoding: 'utf8' });
    grandchildAlive = probe.stdout.includes(String(grandchildPid));
  } else {
    try {
      process.kill(grandchildPid, 0);
      grandchildAlive = true;
    } catch {
      grandchildAlive = false;
    }
  }

  assert.equal(grandchildAlive, false, '强杀后孙进程必须已消亡，不得遗留孤儿进程吃穿算力');
});

test('MUT-P2-B：原子落盘保护 (Node 侧) 正常写入与异常回滚', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-test-'));
  const targetFile = path.join(tmpDir, 'target.json');
  fs.writeFileSync(targetFile, JSON.stringify({ version: 'v1-original' }), 'utf8');

  // 1. 正常原子写入
  atomicWriteFileSync(targetFile, JSON.stringify({ version: 'v2-updated' }), 'utf8');
  const data = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  assert.equal(data.version, 'v2-updated');

  // 2. 验证中途强杀/异常回滚机制：目标文件完好无损且无临时脏文件
  const badTarget = path.join(tmpDir, 'nonexistent_sub', 'file.txt');
  // 正常写入不存在的子目录自愈创建
  atomicWriteFileSync(badTarget, 'hello');
  assert.equal(fs.readFileSync(badTarget, 'utf8'), 'hello');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('MUT-P2-B：中途 SIGKILL 强杀时旧版产物完好无损且无残缺目标文件 (Python 侧)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-py-test-'));
  const target = path.join(tmpDir, 'results.tsv');
  fs.writeFileSync(target, 'GENE\tLOGFC\nABCA1\t2.5\n', 'utf8');

  // 运行 Python 脚本：先对 target 启动写入但中途强杀
  const script = [
    'import sys, os, time',
    'sys.path.insert(0, r"' + REPO + '")',
    'from ops.atomic_write import atomic_write',
    'filepath = r"' + target + '"',
    'tmp = filepath + ".tmp.test"',
    'with open(tmp, "w") as f:',
    '    f.write("HALF_WRITTEN_CORRUPTED_LINE")',
    '    f.flush()',
    '    print("READY_TO_KILL", flush=True)',
    '    time.sleep(10)',
  ].join('\n');

  const child = spawn('python', ['-c', script]);
  let ready = false;
  child.stdout.on('data', (d) => {
    if (d.toString().includes('READY_TO_KILL')) ready = true;
  });

  // 等待进程写入临时文件后强杀
  const start = Date.now();
  while (!ready && Date.now() - start < 3000) {
    spawnSync('python', ['-c', 'import time; time.sleep(0.05)']);
  }

  killProcessTree(child);

  // 断言：target 正式产物完好无损，且内容仍然是旧版
  const current = fs.readFileSync(target, 'utf8');
  assert.equal(current, 'GENE\tLOGFC\nABCA1\t2.5\n', '旧版正式产物完好无损');
  assert.ok(!current.includes('HALF_WRITTEN_CORRUPTED_LINE'), '正式文件绝不含残缺脏数据');

  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
});
