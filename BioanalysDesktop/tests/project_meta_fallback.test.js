/**
 * T3-5 / T3-6 红测：GET /api/projects/meta 与前端空态契约（第三十六轮）
 *
 * 背景取证：buildReadProjectMetaCommand 拼的是远端
 * /mnt/ssd/bio_data/projects/<id>/project.json（BioanalysDesktop/server/project.js:819），
 * 而本地 REPO_ROOT/workspace/projects/default/project.json 实测存在（202 字节、schema_version 1）。
 * 远端读不到时接口直接 404，本地那份从不参与，前端 ResultPreviewStudio 因此静默空态。
 *
 * 本红测证明两件事：
 *   A. 路由在「远端读回空串」时，必须回落到本地 workspace/projects/<id>/project.json；
 *      回 200 且只回出图相关字段（sanitizeProjectId / base64 中转 / 白名单契约不变）。
 *   B. 前端 ResultStudioView.tsx 的 loadProjectMeta 必须判 res.ok，
 *      meta 读失败时要给用户可见的空态/错误提示（不能只 setProjectMeta(null)）。
 *
 * 先红后绿：本文件先落盘，跑出红，再改实现。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleProjectRoutes } from '../server/routes/projects.routes.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VIEW_FILE = path.join(REPO_ROOT, 'BioanalysDesktop', 'src', 'views', 'ResultStudioView.tsx');

function makeDeps(overrides = {}) {
  const seen = { json: [], remote: [] };
  const deps = {
    PORTAL_INBOX: '',
    deployDataFiles: () => {},
    isSafeManifestName: () => true,
    json: (res, status, payload) => { seen.json.push({ status, payload }); },
    lineFromPipeline: () => null,
    listInboxManifests: () => [],
    listProjectsWithMeta: () => [],
    readPackageManifest: () => null,
    runRemote: (cmd) => {
      seen.remote.push(cmd);
      return overrides.runRemote ? overrides.runRemote(cmd) : '';
    },
    runRemoteRaw: () => '',
    uploadPreparedFigureScripts: () => {},
    REPO_ROOT: overrides.REPO_ROOT ?? REPO_ROOT,
  };
  return { deps, seen };
}

async function callMeta(url, deps) {
  const handled = await handleProjectRoutes({}, {}, new URL(url), deps);
  return handled;
}

// ---------------------------------------------------------------------------
// A. 路由回落契约
// ---------------------------------------------------------------------------

test('T3-5 红：远端读回空串时回落到本地 workspace/projects/default/project.json 并回 200', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-fallback-red-'));
  try {
    const localDir = path.join(tmp, 'workspace/projects', 'default');
    fs.mkdirSync(localDir, { recursive: true });
    const localMeta = {
      schema_version: 1,
      project_id: 'default',
      name: 'default',
      created_at: '2026-10-25T09:44:35.0187367+00:00',
      lines: ['line1_bulk', 'line2_scrna', 'line3_spatial'],
      plot_layout_config: { template: 'T_PLOT_A' },
      analysis_cutoffs: { min_cells: 200 },
      biological_priors: { focus_genes: ['EGFR'], target_ko_gene: 'TP53' },
      pipeline_dag: [{ id: 's1' }, { id: 's2' }],
      // 这些字段绝不能透给只读视图
      notes: 'SECRET_SHOULD_NOT_LEAK',
    };
    fs.writeFileSync(path.join(localDir, 'project.json'), JSON.stringify(localMeta));

    const { deps, seen } = makeDeps({ REPO_ROOT: tmp, runRemote: () => '' });
    const handled = await callMeta('http://x/api/projects/meta?project=default', deps);

    assert.equal(handled, true, 'meta 路由应命中');
    const last = seen.json[seen.json.length - 1];
    assert.equal(last.status, 200, '远端读不到但本地有 project.json，应回落本地回 200（现状是 404）');
    assert.equal(last.payload.projectId, 'default');
    assert.deepEqual(last.payload.plotLayoutConfig, { template: 'T_PLOT_A' });
    assert.deepEqual(last.payload.analysisCutoffs, { min_cells: 200 });
    assert.deepEqual(last.payload.focusGenes, ['EGFR']);
    assert.equal(last.payload.targetKoGene, 'TP53');
    assert.equal(last.payload.stepCount, 2);
    assert.equal('notes' in last.payload, false, '只回出图相关字段，整份 meta 不能透出');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('T3-5 红：远端与本地都缺 project.json 仍回 404（回落不是凭空造项目）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-missing-red-'));
  try {
    const { deps, seen } = makeDeps({ REPO_ROOT: tmp, runRemote: () => '' });
    await callMeta('http://x/api/projects/meta?project=default', deps);
    const last = seen.json[seen.json.length - 1];
    assert.equal(last.status, 404, '两处都读不到时保持 404 语义');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('T3-5 红：远端有 meta 时仍以远端为准（base64 中转契约不变）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-remote-red-'));
  try {
    const localDir = path.join(tmp, 'workspace/projects', 'default');
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, 'project.json'), JSON.stringify({ project_id: 'default', plot_layout_config: { from: 'local' } }));
    const remoteMeta = { project_id: 'default', plot_layout_config: { from: 'remote' }, pipeline_dag: [] };
    const { deps, seen } = makeDeps({
      REPO_ROOT: tmp,
      runRemote: () => Buffer.from(JSON.stringify(remoteMeta), 'utf8').toString('base64'),
    });
    await callMeta('http://x/api/projects/meta?project=default', deps);
    const last = seen.json[seen.json.length - 1];
    assert.equal(last.status, 200);
    assert.deepEqual(last.payload.plotLayoutConfig, { from: 'remote' }, '远端优先于本地回落');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('T3-5 红：回落仍受 sanitizeProjectId 约束，非法 project 回 400', async () => {
  const { deps, seen } = makeDeps({});
  await callMeta('http://x/api/projects/meta?project=..%2Fetc', deps);
  const last = seen.json[seen.json.length - 1];
  assert.equal(last.status, 400, '消毒契约不变');
});

// ---------------------------------------------------------------------------
// B. 前端空态/提示契约（静态源码断言，仿 compute_mode_banner.test.js）
// ---------------------------------------------------------------------------

test('T3-6 红：loadProjectMeta 必须判 res.ok 且 meta 失败时给用户可见提示', () => {
  const src = fs.readFileSync(VIEW_FILE, 'utf8');
  assert.match(src, /loadProjectMeta[\s\S]{0,600}?res\.ok/, 'loadProjectMeta 必须判 res.ok（现状不判，404 静默）');
  // 行为级判据：只断言函数里出现 res.ok 字样会被变异绕过
  // （实测把判定改成 if (false) 后注释里仍有 res.ok，红测假绿 exit 0）。
  const start = src.indexOf('const loadProjectMeta');
  assert.ok(start >= 0, '找不到 loadProjectMeta 定义');
  const body = src.slice(start, start + 1400);
  const guard = body.match(/if \(!res\.ok\) \{([\s\S]*?)\n      \}/);
  assert.ok(guard, 'loadProjectMeta 必须有 if (!res.ok) 分支，不能只在注释里写 res.ok');
  assert.match(guard[1], /setMetaError\(/, '非 2xx 分支必须真的设置用户可见错误');
  assert.match(guard[1], /return;/, '非 2xx 分支必须提前返回');
  assert.match(src, /metaError|metaHint|项目出图配置.*(读取失败|无法读取|失败)/, 'meta 读取失败要有用户可见文案');
});

test('T3-8 红：loadAll 失败与 figuresByLine 为空时给用户可见错误/空态提示', () => {
  const src = fs.readFileSync(VIEW_FILE, 'utf8');
  assert.match(src, /loadError|figuresError|loadAllError/, 'loadAll 整体失败要有错误态 state');
  assert.match(src, /图件.*(读取失败|加载失败)|加载图件失败/, '图件加载失败要有用户可见文案');
  assert.match(src, /res\.ok/, '图件列表请求必须判 res.ok');
});
