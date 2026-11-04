import test from 'node:test';
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import childProcess from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP_TEST_ROOT = path.join(REPO, 'BioanalysDesktop', '.tmp', 'wp33-figure-adapt-tests');
fs.mkdirSync(TMP_TEST_ROOT, { recursive: true });
const TEST_ROOT = fs.mkdtempSync(path.join(TMP_TEST_ROOT, 'case-'));

test.after(() => {
  fs.rmSync(TMP_TEST_ROOT, { recursive: true, force: true });
});

const { deriveAdaptedFigure, localAdaptPath } = await import('../server/task.js');
const { buildAdaptUploadPairs, readAdaptManifest } = await import('../server/report.js');
const { resolveFigure } = await import('../server/figure_graph.js');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function makeLocalRoot(name) {
  return fs.mkdtempSync(path.join(TEST_ROOT, name));
}

test('derived adapt copy keeps the master byte-for-byte unchanged', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(REPO, 'src', 'figure_templates.json'), 'utf8'));
  const template = registry.templates.find((item) => item.id === 'fig_l2_volcano');
  const master = path.join(REPO, template.source);
  const before = sha256(master);

  const localRoot = makeLocalRoot('zero-drift-');
  const result = deriveAdaptedFigure({
    root: localRoot,
    projectId: 'project_alpha',
    lineId: 'line1_bulk',
    templateId: template.id,
    template,
    adaptVars: {
      input_data: 'data/line1_bulk/results/de_results.csv',
      group_col: 'condition',
      label_genes: ['TNF'],
      log2fc_cutoff: 1,
      padj_cutoff: 0.05,
    },
  });

  assert.equal(result.ok, true, result.errors?.join('; ') || '');
  assert.equal(sha256(master), before, 'master changed while deriving');
  assert.equal(fs.readFileSync(master, 'utf8').includes(result.adapt_header), false);
  assert.equal(result.local_path, localAdaptPath(localRoot, 'project_alpha', template.id));
  assert.ok(fs.existsSync(result.local_path));
  assert.ok(result.local_path.split(path.sep).join('/').includes('figures/adapt'));
});

test('derived adapt copy carries a verifiable master header and adapt values', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(REPO, 'src', 'figure_templates.json'), 'utf8'));
  const template = registry.templates.find((item) => item.id === 'fig_l2_volcano');
  const master = path.join(REPO, template.source);
  const localRoot = makeLocalRoot('header-');
  const result = deriveAdaptedFigure({
    root: localRoot,
    projectId: 'project_alpha',
    lineId: 'line1_bulk',
    templateId: template.id,
    template,
    adaptVars: {
      input_data: 'data/line1_bulk/results/de_results.csv',
      group_col: 'condition',
      label_genes: ['TNF'],
      log2fc_cutoff: 1,
      padj_cutoff: 0.05,
    },
  });

  const text = fs.readFileSync(result.local_path, 'utf8');
  assert.equal(text.includes('\r\n'), false, 'derived copy must use LF');
  assert.match(text, /^# Master-Source: reference\/05\..*\| Master-SHA256: [0-9a-f]{64}$/m);
  const header = text.match(/^# Master-Source: (.*) \| Master-SHA256: ([0-9a-f]{64})$/m);
  assert.equal(header[1], template.source);
  assert.equal(header[2], template.source_sha256);
  assert.match(text, new RegExp(`# Adapt-Variable input_data: ${template.adapt_vars.input_data.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\\$&`)}`));
  assert.match(text, /input_data = 'data\/line1_bulk\/results\/de_results\.csv'/);
  assert.match(text, /group_col = 'condition'/);
  assert.match(text, /label_genes = c\(['"]TNF['"]\)/);
  assert.match(text, /# Real-Data-Adapter: v1/);
  assert.match(text, /ADAPT_REAL_INPUT_OK volcano rows=/);
});

test('figure resolution rejects cross-line templates and adapt values', () => {
  const lineMismatch = resolveFigure(
    'fig_l2p_volcano',
    'line1_bulk',
    'project_alpha',
    {
      input_data: 'data/line1_bulk/results/de_results.csv',
      group_col: 'condition',
      label_genes: [],
      log2fc_cutoff: 1,
      padj_cutoff: 0.05,
    },
    ['l1_figures_bulk'],
  );
  assert.equal(lineMismatch.ok, false);
  assert.match(lineMismatch.errors.join('; '), /跨线/);

  const foreignValue = resolveFigure(
    'fig_l2p_volcano',
    'line2_scrna',
    'project_alpha',
    {
      input_data: 'data/line1_bulk/results/de_results.csv',
      group_col: 'condition',
      label_genes: [],
      log2fc_cutoff: 1,
      padj_cutoff: 0.05,
    },
    ['l2_figures_scrna'],
  );
  assert.equal(foreignValue.ok, false);
  assert.match(foreignValue.errors.join('; '), /跨线取值/);
});

test('adapt manifest maps project-local copies to per-line delivery paths', () => {
  const localRoot = makeLocalRoot('manifest-');
  const projectId = 'project_alpha';
  const templateId = 'fig_l2_volcano';
  const result = deriveAdaptedFigure({
    root: localRoot,
    projectId,
    lineId: 'line1_bulk',
    templateId,
    template: {
      id: templateId,
      language: 'r',
      source: 'reference/05.可参考出图代码/_meta/R453_compat/L2_core_code.R',
      source_sha256: sha256(path.join(REPO, 'reference/05.可参考出图代码/_meta/R453_compat/L2_core_code.R')),
      canonical_output: 'L2_volcano_verified.png',
      deps_status: 'ready',
      verified: true,
      lines: ['line1_bulk'],
      adapt_vars: { input_data: '', group_col: '', label_genes: '' },
    },
    adaptVars: {
      input_data: 'data/line1_bulk/results/de_results.csv',
      group_col: 'condition',
      label_genes: [],
      log2fc_cutoff: 1,
      padj_cutoff: 0.05,
    },
  });

  const manifest = readAdaptManifest(localRoot, projectId);
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].local_path, result.local_path);
  assert.equal(manifest[0].master_sha256, result.master_sha256);
  assert.equal(manifest[0].line_id, 'line1_bulk');

  const pairs = buildAdaptUploadPairs(localRoot, projectId);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].local, result.local_path);
  assert.equal(
    pairs[0].remote,
    '/mnt/ssd/bio_data/projects/project_alpha/line1_bulk/scripts/adapt_fig_l2_volcano.R',
  );
  assert.ok(!path.relative(path.join(localRoot, 'local_projects', projectId), pairs[0].local).startsWith('..'));
});

test('adapt manifest rejects corrupted paths and foreign lines', () => {
  const localRoot = makeLocalRoot('corrupt-');
  const projectId = 'project_alpha';
  fs.mkdirSync(path.join(localRoot, 'local_projects', projectId, 'figures', 'adapt'), { recursive: true });
  fs.writeFileSync(
    path.join(localRoot, 'local_projects', projectId, 'figures', 'adapt', 'manifest.json'),
    JSON.stringify([
      { local_path: 'local_projects/project_alpha/figures/adapt/fig.R', line_id: 'line1_bulk' },
      { local_path: 'local_projects/project_beta/figures/adapt/fig.R', line_id: 'line1_bulk' },
      { local_path: 'local_projects/project_alpha/figures/adapt/fig.R', line_id: 'line2_scrna' },
    ]),
    'utf8',
  );

  assert.throws(() => buildAdaptUploadPairs(localRoot, projectId), /line1_bulk/);
  assert.equal(readAdaptManifest(localRoot, projectId).length, 3);
});

test('derived adapt copy rejects a master outside reference/05.', () => {
  const localRoot = makeLocalRoot('foreign-master-');
  const result = deriveAdaptedFigure({
    root: localRoot,
    projectId: 'project_alpha',
    lineId: 'line1_bulk',
    templateId: 'fig_l2_volcano',
    template: {
      id: 'fig_l2_volcano',
      language: 'r',
      source: 'BioanalysDesktop/server/task.js',
      source_sha256: sha256(path.join(REPO, 'BioanalysDesktop', 'server', 'task.js')),
      deps_status: 'ready',
      verified: true,
      lines: ['line1_bulk'],
      adapt_vars: { input_data: '', group_col: '', label_genes: '' },
    },
    adaptVars: {
      input_data: 'data/line1_bulk/results/de_results.csv',
      group_col: 'condition',
      label_genes: [],
      log2fc_cutoff: 1,
      padj_cutoff: 0.05,
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /reference\/05/);
});

test('18787 工作台模板、预览与真实派生接线协同通过', async (t) => {
  function freePort() {
    return new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.on('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
      });
    });
  }

  function fakeChild({ stdoutText = '', exitCode = 0 } = {}) {
    const child = {
      stdout: { on: (event, handler) => { if (event === 'data') handler(stdoutText); } },
      stderr: { on: (event, handler) => { if (event === 'data') handler(''); } },
      on: (event, handler) => { if (event === 'exit') setImmediate(() => handler(exitCode)); },
    };
    return child;
  }

  const localRoot = makeLocalRoot('http-');
  process.env.BIO_LOCAL_PROJECTS = localRoot;
  const port = await freePort();
  process.env.BAD_PORT = String(port);
  mock.method(childProcess, 'spawnSync', (program, argv) => {
    if (program === 'ssh' && argv.join(' ').includes('test -d')) {
      return { status: 0, stdout: 'OK', stderr: '' };
    }
    if (program === 'ssh' && argv.join(' ').includes('mkdir -p')) {
      return { status: 0, stdout: 'MKDIR_OK', stderr: '' };
    }
    if (program === 'scp') return { status: 0, stdout: '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(childProcess, 'spawn', (program) => {
    if (program === 'ssh') return fakeChild({ stdoutText: 'OK', exitCode: 0 });
    return fakeChild({ exitCode: 0 });
  });

  const { server } = await import('../server/index.js');
  const base = `http://127.0.0.1:${port}`;

  t.after(() => {
    mock.restoreAll();
    server.closeAllConnections();
    server.close();
  });

  const templateRes = await fetch(`${base}/api/figures/templates`);
  assert.equal(templateRes.status, 200);
  const templateBody = await templateRes.json();
  assert.equal(templateBody.ok, true);
  assert.ok(templateBody.templates.some((item) => item.deps_status === 'ready'));

  const previewRes = await fetch(`${base}/api/figures/templates/preview?id=fig_l2_volcano`);
  assert.equal(previewRes.status, 200);
  assert.match(previewRes.headers.get('content-type') || '', /^image\//);

  const missingSeedRes = await fetch(`${base}/api/figures/adapt/derive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: 'project_http',
      lineId: 'line1_bulk',
      templateId: 'fig_l2_volcano',
      adaptVars: {
        input_data: 'data/line1_bulk/results/de_results.csv',
        group_col: 'condition',
        label_genes: ['TNF'],
        log2fc_cutoff: 1,
        padj_cutoff: 0.05,
      },
    }),
  });
  assert.equal(missingSeedRes.status, 400);
  assert.match((await missingSeedRes.json()).error || '', /seed/i);

  const deriveRes = await fetch(`${base}/api/figures/adapt/derive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: 'project_http',
      lineId: 'line1_bulk',
      templateId: 'fig_l2_volcano',
      adaptVars: {
        input_data: 'data/line1_bulk/results/de_results.csv',
        group_col: 'condition',
        label_genes: ['TNF'],
        log2fc_cutoff: 1,
        padj_cutoff: 0.05,
      },
      seed: 42,
    }),
  });
  const deriveBody = await deriveRes.json();
  assert.equal(deriveRes.status, 200, JSON.stringify(deriveBody));
  assert.equal(deriveBody.ok, true, JSON.stringify(deriveBody));
  assert.equal(deriveBody.task.step, 'adapt_fig_l2_volcano');
  assert.equal(deriveBody.task.inputs[0], '/mnt/ssd/bio_data/projects/project_http/line1_bulk/results/de_results.csv');
  assert.equal(deriveBody.task.seed, 42);
  assert.equal(deriveBody.task.dependsOnStep, 'l1_de_limma');
  assert.ok(fs.existsSync(deriveBody.local_path));
  assert.equal(deriveBody.master_sha256, 'a8ae5c81ea4e66546c40cd3d4f22609bb96dfe37febd0f21fd2b684daff04ad0');

  const blockedSubmit = await fetch(`${base}/api/tasks/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deriveBody.task),
  });
  assert.equal(blockedSubmit.status, 409);
  assert.match((await blockedSubmit.json()).error || '', /前置分析步骤/);
});
