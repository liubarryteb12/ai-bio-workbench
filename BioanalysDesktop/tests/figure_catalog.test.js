import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTemplateCatalog, validateTemplateCatalog } from '../server/figure_template_catalog.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const READY_BASELINE = JSON.parse(
  fs.readFileSync(path.join(REPO, 'tools', 'dev', 'figure_ready_allowlist.json'), 'utf8'),
).ready_baseline;

test('候选图库真源覆盖 92 个模板且每条都带介绍', () => {
  const catalog = loadTemplateCatalog();
  const validation = validateTemplateCatalog();
  const blocked = catalog.filter((item) => item.status === 'blocked_r453').length;
  assert.equal(catalog.length, 92);
  assert.deepEqual(validation.errors, []);
  assert.equal(catalog.filter((item) => item.status === 'ready').length, READY_BASELINE);
  assert.equal(catalog.filter((item) => item.status === 'pending').length,
    catalog.length - READY_BASELINE - blocked);
  assert.equal(blocked, 1);
  assert.ok(catalog.every((item) => item.introduction && item.purpose));
});

test('候选图库接口返回全量 92 条，状态统计与真源一致', async (t) => {
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
  process.env.BAD_PORT = String(port);
  const { server } = await import('../server/index.js');
  const base = `http://127.0.0.1:${port}`;
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const response = await fetch(`${base}/api/figures/catalog?limit=1000`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.catalog_ok, true);
  assert.equal(body.entries.length, 92);
  assert.equal(body.stats.ready, READY_BASELINE);
  assert.equal(body.stats.blocked_r453, 1);
  assert.equal(body.stats.pending, body.entries.length - READY_BASELINE - body.stats.blocked_r453);
  assert.ok(body.entries.every((item) => item.introduction && item.purpose));

  const preview = await fetch(`${base}/api/figures/catalog/preview?id=fig_l2_pca`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type') || '', /^image\/png/);
});

test('文档目录写出 92 个图型标题', () => {
  const text = fs.readFileSync(path.join(REPO, 'docs', 'FIGURE_TEMPLATE_CATALOG.md'), 'utf8');
  assert.equal((text.match(/^### /gm) || []).length, 92);
  assert.match(text, /真源：`tools\/bio\/figure_template_profiles\.json`/);
});
