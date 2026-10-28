import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadFigureCatalog,
  resolveCatalogFigure,
  searchFigureCatalog,
  validateFigureCatalog,
} from '../server/figure_catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('catalog searches and resolves the Manhattan single-figure pilot', () => {
  const catalog = loadFigureCatalog();
  assert.equal(catalog.schema_version, 1);
  assert.equal(catalog.entries.length, 772);

  const results = searchFigureCatalog({ query: 'manhattan', language: 'Python' });
  assert.equal(results.length, 1);
  assert.equal(results[0].catalog_id, 'pgg_0619');
  assert.equal(results[0].status, 'k40_verified');

  const resolved = resolveCatalogFigure('pgg_0619');
  assert.equal(resolved.ok, true, resolved.errors.join('\n'));
  assert.ok(fs.existsSync(resolved.code_abs));
  assert.ok(fs.existsSync(resolved.preview_abs));
  assert.equal(resolved.code_sha256, sha256(resolved.code_abs));
  assert.equal(resolved.preview_sha256, sha256(resolved.preview_abs));
  assert.equal(resolved.suggested_template_id, 'fig_l2p_manhattanplot');

  const validation = validateFigureCatalog();
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(validation.stats.entries, 772);
  assert.equal(validation.stats.materialized, 0);
  assert.equal(validation.stats.k40_verified, 16);
  assert.equal(validation.stats.blocked_dependency, 17);
  assert.equal(validation.stats.blocked_network, 8);
  assert.equal(validation.stats.blocked_code, 4);
  assert.equal(validation.stats.code_ready, 0);
  assert.equal(validation.stats.split_materialized, 23);
  assert.equal(validation.stats.split_code_ready, 59);
  assert.equal(validation.stats.generic_candidate, 438);
  assert.equal(
    searchFigureCatalog({ status: 'generic_candidate', limit: 1000 }).length,
    438,
  );
});

test('catalog API exposes search and single-image preview', async (t) => {
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

  const list = await fetch(`${base}/api/figures/catalog?q=manhattan&language=Python`);
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.equal(body.ok, true, body.catalog_errors.join('\n'));
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].catalog_id, 'pgg_0619');

  const preview = await fetch(`${base}/api/figures/catalog/preview?id=pgg_0619`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type') || '', /^image\/png/);
});
