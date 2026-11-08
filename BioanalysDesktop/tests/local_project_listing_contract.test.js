import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  listLocalProjectsWithMeta,
  resolveProjectParam,
} from '../server/query_views.js';
import { listProjects } from '../server/services/project.service.js';
import { handleFiguresRoutes } from '../server/routes/figures.routes.js';
import { handleProjectRoutes } from '../server/routes/projects.routes.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIGURES_ROUTES = path.join(REPO_ROOT, 'BioanalysDesktop', 'server', 'routes', 'figures.routes.js');

test('listLocalProjectsWithMeta 能发现本地 PRJ_DCM_BENCH_20261105', () => {
  const projects = listLocalProjectsWithMeta({ repoRoot: REPO_ROOT });
  const hit = projects.find((item) => item.projectId === 'PRJ_DCM_BENCH_20261105');
  assert.ok(hit, '应能列出本地基准项目');
  assert.equal(hit.meta?.project_id, 'PRJ_DCM_BENCH_20261105');
});

test('listLocalProjectsWithMeta 跳过非法目录名，缺 project.json 时 meta=null，且不递归', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-project-list-'));
  try {
    const root = path.join(tmp, 'workspace/projects');
    fs.mkdirSync(path.join(root, 'PRJ_SAFE'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'PRJ_SAFE', 'project.json'),
      JSON.stringify({ project_id: 'PRJ_SAFE', name: 'Safe project' }),
      'utf8'
    );
    fs.mkdirSync(path.join(root, 'PRJ_NO_META'), { recursive: true });
    fs.mkdirSync(path.join(root, '.hidden'), { recursive: true });
    fs.mkdirSync(path.join(root, 'bad name'), { recursive: true });
    fs.mkdirSync(path.join(root, 'x'.repeat(65)), { recursive: true });
    fs.mkdirSync(path.join(root, 'PRJ_SAFE', 'nested', 'PRJ_NESTED'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'PRJ_SAFE', 'nested', 'PRJ_NESTED', 'project.json'),
      JSON.stringify({ project_id: 'PRJ_NESTED' }),
      'utf8'
    );

    const projects = listLocalProjectsWithMeta({ repoRoot: tmp });
    const ids = projects.map((item) => item.projectId);
    const byId = Object.fromEntries(projects.map((item) => [item.projectId, item]));

    assert.deepEqual(ids, ['PRJ_NO_META', 'PRJ_SAFE']);
    assert.equal(byId.PRJ_SAFE.meta.name, 'Safe project');
    assert.equal(byId.PRJ_NO_META.meta, null);
    assert.equal(ids.includes('.hidden'), false);
    assert.equal(ids.includes('bad name'), false);
    assert.equal(ids.includes('x'.repeat(65)), false);
    assert.equal(ids.includes('PRJ_NESTED'), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('listProjects 远端失败时回 200 并返回本地项目', () => {
  const localProjects = [{ projectId: 'PRJ_LOCAL_ONLY', meta: { name: 'Local' } }];
  const result = listProjects({
    listProjectsWithMeta: () => { throw new Error('offline'); },
    listLocalProjectsWithMeta: () => localProjects,
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.source, 'local');
  assert.deepEqual(result.payload.projects, localProjects);
  assert.match(result.payload.warning, /offline/);
});

test('listProjects 成功时合并本地项目，并按 projectId 保留远端 meta', () => {
  const result = listProjects({
    listProjectsWithMeta: () => [
      { projectId: 'PRJ_SHARED', meta: { origin: 'remote' } },
    ],
    listLocalProjectsWithMeta: () => [
      { projectId: 'PRJ_SHARED', meta: { origin: 'local' } },
      { projectId: 'PRJ_LOCAL_ONLY', meta: null },
    ],
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.source, 'remote');
  assert.deepEqual(result.payload.projects, [
    { projectId: 'PRJ_SHARED', meta: { origin: 'remote' } },
    { projectId: 'PRJ_LOCAL_ONLY', meta: null },
  ]);
});

test('/api/projects/list 在远端失败时通过路由注入返回本地项目', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-list-fallback-'));
  try {
    const dir = path.join(tmp, 'workspace/projects', 'PRJ_LOCAL_ONLY');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'project.json'),
      JSON.stringify({ project_id: 'PRJ_LOCAL_ONLY', name: 'Local only' }),
      'utf8'
    );

    const seen = { json: [] };
    const handled = await handleProjectRoutes(
      { method: 'GET' },
      {},
      new URL('http://x/api/projects/list'),
      {
        PORTAL_INBOX: '',
        deployDataFiles: () => {},
        isSafeManifestName: () => true,
        json: (res, status, payload) => { seen.json.push({ status, payload }); },
        lineFromPipeline: () => null,
        listInboxManifests: () => [],
        listProjectsWithMeta: () => { throw new Error('offline'); },
        readPackageManifest: () => null,
        runRemote: () => '',
        runRemoteRaw: () => '',
        uploadPreparedFigureScripts: () => {},
        REPO_ROOT: tmp,
      }
    );
    const last = seen.json[seen.json.length - 1];
    assert.equal(handled, true);
    assert.equal(last.status, 200);
    assert.equal(last.payload.source, 'local');
    assert.deepEqual(last.payload.projects.map((item) => item.projectId), ['PRJ_LOCAL_ONLY']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('/api/figures/source_manifest 静态契约固定项目与线校验及本地路径', () => {
  const src = fs.readFileSync(FIGURES_ROUTES, 'utf8');
  const start = src.indexOf("url.pathname === '/api/figures/source_manifest'");
  assert.ok(start >= 0, '缺少 source_manifest 路由');
  const end = src.indexOf('// M4：按 mod 分组的产物预览。', start);
  assert.ok(end > start, '找不到 source_manifest 路由块的结束位置');
  const block = src.slice(start, end);

  assert.match(block, /resolveProjectParam\(url\)/);
  assert.match(block, /LINES\.includes\(lineId\)/);
  assert.match(block, /'workspace\/projects'/);
  assert.match(block, /FIGURE_SOURCE_MANIFEST\.tsv/);
  assert.match(block, /README_FIGURE_SOURCES\.md/);
  assert.doesNotMatch(block, /searchParams\.get\(['"](?:path|file|dir)['"]\)/);
});

function makeRouteDeps(repoRoot) {
  const seen = { json: [] };
  return {
    seen,
    deps: {
      json: (res, status, payload) => { seen.json.push({ status, payload }); },
      runRemote: () => '',
      runRemoteRaw: () => '',
      resolveProjectParam,
      REPO_ROOT: repoRoot,
      listFiguresForLine: () => ({ blocked: false, source: 'local', figures: [] }),
      listRemoteProcessed: () => [],
      remoteTaskInput: () => '',
    },
  };
}

async function callSourceManifest(repoRoot, query) {
  const { deps, seen } = makeRouteDeps(repoRoot);
  const handled = await handleFiguresRoutes(
    { method: 'GET' },
    {},
    new URL(`http://x/api/figures/source_manifest${query}`),
    deps
  );
  return { handled, last: seen.json[seen.json.length - 1] };
}

test('/api/figures/source_manifest 读取本地 manifest 与 README', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figure-source-manifest-'));
  try {
    const dir = path.join(tmp, 'workspace/projects', 'PRJ_SOURCE', 'figures', 'line3_spatial');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'FIGURE_SOURCE_MANIFEST.tsv'), 'figure\tsource\nl3_a\tprocessed/a.h5ad\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'README_FIGURE_SOURCES.md'), '# Sources\nLocal provenance\n', 'utf8');

    const result = await callSourceManifest(tmp, '?project=PRJ_SOURCE&line=line3_spatial');
    assert.equal(result.handled, true);
    assert.equal(result.last.status, 200);
    assert.equal(result.last.payload.ok, true);
    assert.match(result.last.payload.manifest, /l3_a/);
    assert.match(result.last.payload.readme, /Local provenance/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('/api/figures/source_manifest 拒绝非法项目与线，缺失文件回 ok=false', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figure-source-missing-'));
  try {
    const badProject = await callSourceManifest(tmp, '?project=..%2Fetc&line=line3_spatial');
    assert.equal(badProject.last.status, 400);

    const badLine = await callSourceManifest(tmp, '?project=PRJ_SOURCE&line=line9');
    assert.equal(badLine.last.status, 400);

    const missing = await callSourceManifest(tmp, '?project=PRJ_SOURCE&line=line3_spatial');
    assert.equal(missing.last.status, 200);
    assert.equal(missing.last.payload.ok, false);
    assert.equal(missing.last.payload.manifest, null);
    assert.equal(missing.last.payload.readme, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
