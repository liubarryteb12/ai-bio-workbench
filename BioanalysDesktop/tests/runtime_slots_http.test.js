import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;
let server;

before(async () => {
  process.env.BAD_PORT = String(PORT);
  delete process.env.BAD_AUTH_USER;
  delete process.env.BAD_AUTH_PASS;
  ({ server } = await import('../server/index.js'));

  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const response = await fetch(`${BASE}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      // 启动期继续等待
    }
    if (Date.now() > deadline) {
      throw new Error('runtime slots test server did not become ready');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

after(() => {
  server?.close();
});

test('/api/runtime/slots 返回 Pi 观测运行时插槽', async () => {
  const response = await fetch(`${BASE}/api/runtime/slots`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  const body = await response.json();

  const pi = body.modules.find((item) => item.modId === 'mod-pi-observability');
  assert.equal(pi?.state, 'ready');

  const selfcheck = body.slots.find(
    (item) => item.slotId === 'workbench.selfcheck-cards'
  );
  const preview = body.slots.find(
    (item) => item.slotId === 'workbench.studio-preview'
  );
  assert.deepEqual(
    selfcheck?.contributions
      .filter((item) => item.modId === 'mod-pi-observability')
      .map((item) => item.title),
    ['Pi Agent status']
  );
  assert.deepEqual(
    preview?.contributions
      .filter((item) => item.modId === 'mod-pi-observability')
      .map((item) => item.title),
    ['Pi Agent monitor']
  );
});
