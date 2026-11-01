/**
 * 08 号书第 7 项的可重复验收：从 spawn 到端口可连的冷启动必须 < 500ms。
 *
 * 这里不测 HTTP 业务，只测 listen 前是否还压着同步目录扫描或外部探针。
 * 取 3 次中位数，降低 Windows 杀毒扫描偶发抖动对单次样本的影响。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../server/index.js', import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForPort(port, child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + timeoutMs;
    const attempt = () => {
      if (child.exitCode !== null) {
        reject(new Error(`server exited before listen: ${child.exitCode}`));
        return;
      }
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (performance.now() >= deadline) {
          reject(new Error('server did not listen within 5000ms'));
          return;
        }
        setTimeout(attempt, 2);
      });
    };
    attempt();
  });
}

async function measureBoot() {
  const port = await freePort();
  const started = performance.now();
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      BAD_PORT: String(port),
      BIO_ALLOW_DEV_NOAUTH: '1',
      NO_PROXY: 'localhost,127.0.0.1',
    },
    stdio: 'ignore',
  });
  try {
    await waitForPort(port, child);
    return performance.now() - started;
  } finally {
    child.kill();
  }
}

test('server cold start：3 次中位数 < 500ms', async () => {
  const samples = [];
  for (let index = 0; index < 3; index += 1) {
    samples.push(Math.round(await measureBoot()));
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const median = sorted[1];
  assert.ok(median < 500, `冷启动中位数 ${median}ms 超过 500ms；samples=${samples.join(',')}`);
});
