import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
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

function waitForPort(port, child, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      if (child.exitCode !== null) {
        reject(new Error(`server exited before listen: ${child.exitCode}`));
        return;
      }
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) reject(new Error('server did not listen'));
        else setTimeout(attempt, 30);
      });
    };
    attempt();
  });
}

test('TICKET-D0-01：stdin 断开后后端自杀，不留下孤儿进程', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'death_pipe_'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      BAD_PORT: String(port),
      BIO_DATA_HOME: dir,
      BIO_DEATH_PIPE: '1',
      BAD_AUTH_USER: 'desktop',
      BAD_AUTH_PASS: 'test-pass',
      BIO_AUTH_RUNTIME_FILE: path.join(dir, 'auth.json'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  t.after(() => { try { child.kill(); } catch { /* 已退出 */ } });

  await waitForPort(port, child);
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  child.stdin.end();
  const code = await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error('death pipe timeout')), 5000)),
  ]);
  assert.equal(code, 0);
});
