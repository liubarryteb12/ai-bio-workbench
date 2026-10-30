import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  figureCatalogPaths,
  loadFigureCatalog,
  reloadFigureCatalog,
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
  if (!fs.existsSync(figureCatalogPaths.catalog)) {
    console.warn(`SKIP fixture: missing ${figureCatalogPaths.catalog}`);
    return;
  }
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
  if (!fs.existsSync(figureCatalogPaths.catalog)) {
    console.warn(`SKIP fixture: missing ${figureCatalogPaths.catalog}`);
    return;
  }
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
  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }
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

test('missing catalog fails closed with an observable empty state', async (t) => {
  const missing = !fs.existsSync(figureCatalogPaths.catalog);
  if (!missing) {
    console.warn('SKIP missing-state fixture: catalog is currently available');
    return;
  }

  const loaded = reloadFigureCatalog();
  assert.equal(loaded.schema_version, 1);
  assert.deepEqual(loaded.entries, []);

  const validation = validateFigureCatalog();
  assert.equal(validation.ok, false);
  assert.equal(validation.available, false);
  assert.equal(validation.reason, 'catalog_read_failed');
  assert.match(validation.errors.join('\n'), /catalog 不可用/);
  assert.equal(validation.stats.entries, 0);

  assert.deepEqual(searchFigureCatalog({ query: 'anything' }), []);

  const resolved = resolveCatalogFigure('pgg_0619');
  assert.equal(resolved.ok, false);
  assert.equal(resolved.available, false);
  assert.equal(resolved.reason, 'catalog_read_failed');
  assert.deepEqual(resolved.errors, ['catalog 不可用（catalog_read_failed）']);
  assert.equal(resolved.entry, null);

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
  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }
  const base = `http://127.0.0.1:${port}`;
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const list = await fetch(`${base}/api/figures/catalog?q=manhattan`);
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.equal(listBody.ok, false);
  assert.equal(listBody.catalog_ok, false);
  assert.equal(listBody.available, false);
  assert.equal(listBody.reason, 'catalog_read_failed');
  assert.deepEqual(listBody.entries, []);
  assert.match(listBody.catalog_errors.join('\n'), /catalog 不可用/);

  const preview = await fetch(`${base}/api/figures/catalog/preview?id=pgg_0619`);
  assert.equal(preview.status, 404);
  const previewBody = await preview.json();
  assert.equal(previewBody.available, false);
  assert.equal(previewBody.reason, 'catalog_read_failed');
});
