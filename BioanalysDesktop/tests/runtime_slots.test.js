import test from 'node:test';
import assert from 'node:assert/strict';

test('运行时从 manifest.ts 注册 Pi 观测 workbench 插槽', async () => {
  const { initializeRuntime } = await import('../server/runtime_slots.js');
  const snapshot = await initializeRuntime({ force: true });

  const pi = snapshot.modules.find((item) => item.modId === 'mod-pi-observability');
  assert.ok(pi, '运行时快照必须包含 mod-pi-observability');
  assert.equal(pi.state, 'ready');

  const selfcheck = snapshot.slots.find(
    (item) => item.slotId === 'workbench.selfcheck-cards'
  );
  const preview = snapshot.slots.find(
    (item) => item.slotId === 'workbench.studio-preview'
  );
  assert.ok(selfcheck, '运行时快照必须包含 workbench.selfcheck-cards');
  assert.ok(preview, '运行时快照必须包含 workbench.studio-preview');
  assert.deepEqual(
    selfcheck.contributions
      .filter((item) => item.modId === 'mod-pi-observability')
      .map((item) => item.title),
    ['Pi Agent status']
  );
  assert.deepEqual(
    preview.contributions
      .filter((item) => item.modId === 'mod-pi-observability')
      .map((item) => item.title),
    ['Pi Agent monitor']
  );
});
