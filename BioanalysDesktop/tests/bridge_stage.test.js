/**
 * 阶段感知桥接断言测试（aims v2.5 §一.2 / todo 2.2 / 3.1 裁定「方案 B 为主 + A 为辅」）
 *
 * 解决的三个真实问题：
 *   1. verify_bridge_checkpoint.py 的第 4 项（Embedding 保留）原先无条件硬断言，
 *      导致线2 步骤 3 的 scrna_norm.h5ad（尚未降维）永远过不了 —— 实测真机
 *      [BRIDGE FAIL] obsm 无 X_pca / X_umap / spatial。
 *   2. 一旦允许"降级"，就可能被用来把真失败洗成通过，所以降级必须显式
 *      （--stage pre-dimred 由调用方声明）且留痕（[BRIDGE WARN] + 台账可见）。
 *   3. 线2 下游统一以 00_sc_harmony.h5ad 为输入源（方案 B），只有它不存在时
 *      才回落 scrna_norm.h5ad 并随之降级（方案 A 兜底）。
 *
 * 本文件用真实 anndata 造 fixture 跑真引擎，不靠 grep 冒充验证。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_TMP } from './support/test_tmp.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const ENGINE = path.join(REPO_ROOT, 'ops', 'verify_bridge_checkpoint.py');
const GUARD = path.join(REPO_ROOT, 'src', 'bridge_guard.sh');
const GSVA = path.join(REPO_ROOT, 'src', 'line2_scrna', 'scripts', 'gsva_pathways');

function findBash() {
  const candidates = [process.env.BRIDGE_GUARD_BASH, 'D:\\Git\\bin\\bash.exe', 'D:\\Git\\usr\\bin\\bash.exe', 'bash']
    .filter((v) => typeof v === 'string' && v.length > 0);
  for (const cand of candidates) {
    const res = spawnSync(cand, ['-n', GUARD], { encoding: 'utf8' });
    if (!res.error && res.status === 0) return cand;
  }
  return null;
}
const BASH = findBash();

function findPython() {
  for (const cand of [process.env.BRIDGE_TEST_PYTHON, 'python', 'python3']) {
    if (!cand) continue;
    const res = spawnSync(cand, ['-c', 'import anndata, numpy'], { encoding: 'utf8' });
    if (!res.error && res.status === 0) return cand;
  }
  return null;
}
const PY = findPython();

/** 造一个 h5ad fixture：barcode 样 obs_names + 基因符号 var_names + 可选 obsm。 */
function makeFixture({ withEmbedding }) {
  const dir = fs.mkdtempSync(path.join(TEST_TMP, 'bridge-stage-'));
  const file = path.join(dir, withEmbedding ? 'with_emb.h5ad' : 'no_emb.h5ad');
  const py = [
    'import sys',
    'import numpy as np',
    'import anndata as ad',
    'from scipy import sparse',
    'n_obs, n_var = 8, 12',
    'X = sparse.csr_matrix(np.array([[1.0 if (i + j) % 3 == 0 else 0.0 for j in range(n_var)] for i in range(n_obs)]))',
    'a = ad.AnnData(X)',
    "a.var_names = ['GENE%d' % (i + 1) for i in range(n_var)]",
    "a.obs_names = ['AAAC%04d-1' % i for i in range(n_obs)]",
    'a.obsm.clear()',
    'if sys.argv[2] == "1":',
    '    a.obsm["X_pca"] = np.zeros((n_obs, 3))',
    '    a.obsm["X_umap"] = np.zeros((n_obs, 2))',
    'a.write_h5ad(sys.argv[1])',
  ].join('\n');
  const res = spawnSync(PY, ['-c', py, file, withEmbedding ? '1' : '0'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr || 'fixture 生成失败');
  return { dir, file };
}

function runEngine(args) {
  const res = spawnSync(PY, [ENGINE, ...args], { encoding: 'utf8' });
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** 用 BRIDGE_SSH_CMD 垫片捕获守卫实际下发的远端命令，完全隔离真实 ssh。 */
function runGuardCapture(args) {
  const dir = fs.mkdtempSync(path.join(TEST_TMP, 'bs-shim-'));
  const capture = path.join(dir, 'cmd.txt');
  const sshPath = path.join(dir, 'ssh');
  fs.writeFileSync(sshPath, '#!/bin/sh\nprintf "%s\\n" "$@" > "' + capture.replace(/\\/g, '/') + '"\necho "[BRIDGE OK] shim"\nexit 0\n', { mode: 0o755 });
  // BRIDGE_ENGINE_LOCAL 显式置空：本用例验证的是 ssh 分支，不能被宿主上真实存在的
  // /mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py（本机优先）抢走。
  const childEnv = { ...process.env, BRIDGE_SSH_CMD: sshPath.replace(/\\/g, '/'), BRIDGE_ENGINE_LOCAL: '' };
  const res = spawnSync(BASH, [GUARD, ...args], { encoding: 'utf8', env: childEnv });
  const captured = fs.existsSync(capture) ? fs.readFileSync(capture, 'utf8') : '';
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', captured };
}

const NEED_PY = PY === null ? 'HOST_MISSING_ANNDATA: 宿主无 python 与 anndata' : false;
const NEED_BASH = BASH === null ? 'HOST_MISSING_BASH: 宿主无 bash 解释器' : false;

test('引擎 --help 暴露 --stage 且两个取值齐全', { skip: NEED_PY }, () => {
  const res = runEngine(['--help']);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /--stage/);
  assert.match(res.stdout, /post-dimred/);
  assert.match(res.stdout, /pre-dimred/);
});

test('默认 stage=post-dimred：无 obsm 的矩阵硬失败（不许静默放行）', { skip: NEED_PY }, () => {
  const { dir, file } = makeFixture({ withEmbedding: false });
  try {
    const res = runEngine(['--input', file, '--from', 'Python', '--to', 'R']);
    assert.notEqual(res.code, 0, '缺 obsm 时默认必须失败');
    assert.match(res.stdout + res.stderr, /BRIDGE FAIL/);
    assert.match(res.stdout + res.stderr, /obsm/);
    assert.match(res.stdout, /stage=post-dimred/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('显式 --stage pre-dimred：同一矩阵降级为 BRIDGE WARN 并放行', { skip: NEED_PY }, () => {
  const { dir, file } = makeFixture({ withEmbedding: false });
  try {
    const res = runEngine(['--input', file, '--from', 'Python', '--to', 'R', '--stage', 'pre-dimred']);
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /BRIDGE WARN/);
    assert.doesNotMatch(res.stdout + res.stderr, /BRIDGE FAIL/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('带 obsm 的矩阵在默认 stage 下仍然全过（降级不削弱正常路径）', { skip: NEED_PY }, () => {
  const { dir, file } = makeFixture({ withEmbedding: true });
  try {
    const res = runEngine(['--input', file, '--from', 'Python', '--to', 'R']);
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /BRIDGE PASS/);
    assert.match(res.stdout, /embeddings: X_pca, X_umap/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('非法 --stage 被 argparse 拒绝（exit 2，不许猜）', { skip: NEED_PY }, () => {
  const res = runEngine(['--input', 'x.h5ad', '--stage', 'whenever']);
  assert.equal(res.code, 2);
});

test('守卫默认向引擎透传 --stage post-dimred', { skip: NEED_BASH }, () => {
  const res = runGuardCapture(['--input', 'x.h5ad', '--from', 'Python', '--to', 'R']);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.captured, /--stage post-dimred/);
});

test('守卫把 --stage pre-dimred 原样透传（降级由调用方声明）', { skip: NEED_BASH }, () => {
  const res = runGuardCapture(['--input', 'x.h5ad', '--from', 'Python', '--to', 'R', '--stage', 'pre-dimred']);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.captured, /--stage pre-dimred/);
});

test('守卫遇到未知 stage 打印 BRIDGE FAIL 并 exit 2', { skip: NEED_BASH }, () => {
  const res = runGuardCapture(['--input', 'x.h5ad', '--from', 'Python', '--to', 'R', '--stage', 'whenever']);
  assert.equal(res.code, 2, res.stderr);
  assert.match(res.stdout + res.stderr, /BRIDGE FAIL/);
  assert.match(res.stdout + res.stderr, /未知 --stage/);
});

test('gsva_pathways 按三候选顺序取整合矩阵，回落时显式降级为 pre-dimred', () => {
  const src = fs.readFileSync(GSVA, 'utf8');
  // 候选顺序：规范名 -> PIPELINE_STEP_META 元数据名 -> 母版实际产物名（P13 修命名衔接）
  const loop = src.match(/for _cand in ([^\n;]+); do/);
  assert.ok(loop, '未找到整合矩阵候选循环');
  assert.deepEqual(
    [...loop[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    ['00_sc_harmony.h5ad', 'scrna_harmony.h5ad', 'scrna_integrated.h5ad'],
    '候选顺序必须是 规范名 -> 元数据名 -> 实际产物名',
  );
  assert.match(src, /BRIDGE_STAGE="post-dimred"/, '默认阶段必须是 post-dimred');
  assert.match(src, /NORM="scrna_norm\.h5ad"\s*\n\s*BRIDGE_STAGE="pre-dimred"/, '回落 scrna_norm 时必须同步降级');
  assert.match(src, /--stage "\$BRIDGE_STAGE"/, '守卫调用必须透传阶段');
  assert.match(src, /BIO_GSVA_NORM="\$NORM" python3/, 'python 侧必须从环境变量拿实际输入');
  assert.match(src, /os\.environ\.get\("BIO_GSVA_NORM"/, 'python 侧读环境变量');
  assert.match(src, /layers\["counts"\]/, '伪 bulk 必须从非负 counts 层聚合，不能直接消费 scaled X');
  assert.match(src, /\("donor",\s*"sample",\s*"sample_title"\)/, '伪 bulk 样本键优先使用低基数 donor，避免单细胞标题制造数千伪样本');
  assert.match(src, /celltype[\s\S]*sample/, '伪 bulk 分组必须同时包含 celltype 与样本');
  assert.match(src, /np\.log1p\(/, 'counts 求和后必须显式做 log1p 归一化');
  // 严禁再把 scrna_norm.h5ad 写成 python heredoc 里的硬编码输入
  assert.doesNotMatch(src, /^NORM = "scrna_norm\.h5ad"$/m, 'python heredoc 里不许再硬编码输入源');
});

test('gsva_pathways 的输入源解析在各种目录状态下行为正确（候选优先级 + 回落）', { skip: NEED_BASH }, () => {
  const src = fs.readFileSync(GSVA, 'utf8');
  const start = src.indexOf('NORM=""');
  const endMarker = 'echo "bridge_stage=$BRIDGE_STAGE"';
  const end = src.indexOf(endMarker);
  assert.ok(start > 0 && end > start, '未能从母版里定位输入源解析块');
  const block = src.slice(start, end + endMarker.length);

  const cases = [
    { name: '三个候选都在，选规范名', files: ['00_sc_harmony.h5ad', 'scrna_harmony.h5ad', 'scrna_integrated.h5ad'], expectCode: 0, expectNorm: '00_sc_harmony.h5ad', expectStage: 'post-dimred' },
    { name: '缺规范名，选元数据名', files: ['scrna_harmony.h5ad', 'scrna_integrated.h5ad'], expectCode: 0, expectNorm: 'scrna_harmony.h5ad', expectStage: 'post-dimred' },
    { name: '只有实际产物名', files: ['scrna_integrated.h5ad'], expectCode: 0, expectNorm: 'scrna_integrated.h5ad', expectStage: 'post-dimred' },
    { name: '只有 scrna_norm（回落）', files: ['scrna_norm.h5ad'], expectCode: 0, expectNorm: 'scrna_norm.h5ad', expectStage: 'pre-dimred' },
    { name: '全都没有', files: [], expectCode: 1 },
  ];
  for (const c of cases) {
    const dir = fs.mkdtempSync(path.join(TEST_TMP, 'gsva-input-'));
    try {
      for (const f of c.files) fs.writeFileSync(path.join(dir, f), '');
      const res = spawnSync(BASH, ['-c', block + '\nprintf "NORM=%s STAGE=%s\\n" "$NORM" "$BRIDGE_STAGE"'], {
        cwd: dir, encoding: 'utf8',
      });
      assert.equal(res.status, c.expectCode, c.name + ' 退出码不符: ' + (res.stdout + res.stderr));
      if (c.expectCode === 0) {
        assert.match(res.stdout, new RegExp('NORM=' + c.expectNorm.replace('.', '\\.')));
        assert.match(res.stdout, new RegExp('STAGE=' + c.expectStage));
      } else {
        assert.match(res.stdout + res.stderr, /缺少输入矩阵/);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('引擎源码里降级分支排在硬失败之前（WARN 不被 FAIL 抢先）', () => {
  const src = fs.readFileSync(ENGINE, 'utf8');
  const warnIdx = src.indexOf('warn("obsm 无 X_pca');
  const failIdx = src.indexOf('fail("obsm 无 X_pca');
  assert.ok(warnIdx > 0 && failIdx > warnIdx, 'pre-dimred 的 WARN 分支必须在前');
  assert.match(src, /def warn\(msg\):/);
  assert.match(src, /BRIDGE_STAGE/, 'RDS 分支也要能收到阶段');
});

// ---------- 引擎自身的失败口径（真机 /tmp/bad.h5ad 事故，契约 3c） ----------

test('引擎：损坏的 h5ad 必须给出 [BRIDGE FAIL] 结论而不是裸 traceback', { skip: PY === null ? 'HOST_MISSING_ANNDATA: 宿主无 python 与 anndata' : false }, () => {
  const dir = fs.mkdtempSync(path.join(TEST_TMP, 'bridge-bad-'));
  const bad = path.join(dir, 'bad.h5ad');
  fs.writeFileSync(bad, 'not-an-h5ad', 'utf8');
  try {
    const res = runEngine(['--input', bad, '--from', 'Python', '--to', 'R', '--stage', 'pre-dimred']);
    assert.notEqual(res.code, 0, '损坏输入不许判通过');
    const all = res.stdout + res.stderr;
    assert.match(all, /\[BRIDGE FAIL\]/, '缺结论标记，守卫只能看到裸退出码');
    assert.match(all, /引擎无法校验输入/);
    assert.doesNotMatch(all, /^Traceback/m, 'traceback 不许直接冒给调用方');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('引擎：输入文件不存在时给出 [BRIDGE FAIL] 并点名路径', { skip: PY === null ? 'HOST_MISSING_ANNDATA: 宿主无 python 与 anndata' : false }, () => {
  const res = runEngine(['--input', '/no/such/dir/x.h5ad', '--from', 'Python', '--to', 'R']);
  assert.notEqual(res.code, 0);
  assert.match(res.stdout + res.stderr, /\[BRIDGE FAIL\] 输入文件不存在/);
});
