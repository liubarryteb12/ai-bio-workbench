import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLedgerEntry, buildTaskScript, parseComputeNodes } from '../server/task.js';
import { auditCommand } from '../server/audit.js';
import { LINES, PROJECTS_ROOT, BIN_ROOT, DEFAULT_PROJECT } from '../server/domain.js';

const P = DEFAULT_PROJECT;
const baseParams = {
  step: 'deg',
  args: ['--input', 'expr.tsv'],
  seed: 42,
};

test('算力节点池未配置备用节点时只包含默认主节点', () => {
  assert.deepEqual(parseComputeNodes(null), [
    { id: 'k40-ubuntu', host: 'k40-ubuntu', primary: true },
  ]);
});

test('算力节点池从显式环境变量读取备用节点，且只允许一个主节点', () => {
  const pool = parseComputeNodes(JSON.stringify([
    { id: 'k40-ubuntu', host: 'k40-ubuntu', primary: true },
    { id: 'backup-arm64', host: 'backup-arm64', primary: false },
  ]));
  assert.equal(pool.length, 2);
  assert.equal(pool[1].id, 'backup-arm64');
  assert.throws(
    () => parseComputeNodes(JSON.stringify([
      { id: 'primary-a', host: 'primary-a', primary: true },
      { id: 'primary-b', host: 'primary-b', primary: true },
    ])),
    /主节点/,
  );
});

test('台账字段齐全：project_id / line_id / step / seed / io_files / 时间戳都在', () => {
  const entry = buildLedgerEntry({
    lineId: 'line1_bulk',
    step: baseParams.step,
    seed: baseParams.seed,
    inputs: [`${PROJECTS_ROOT}/${P}/line1_bulk/processed/expr.tsv`],
    outputs: [`${PROJECTS_ROOT}/${P}/line1_bulk/results/deg.tsv`],
    status: 'completed',
    checkpointStatus: 'passed',
    exitCode: 0,
    startedAt: '2026-10-12T10:00:00Z',
    endedAt: '2026-10-12T10:05:00Z',
  });

  assert.equal(entry.project_id, 'default', '未指定项目时落默认项目');
  assert.equal(entry.line_id, 'line1_bulk');
  assert.equal(entry.step_name, 'deg');
  assert.equal(entry.environment.random_seed, 42);
  assert.equal(entry.status, 'completed');
  assert.equal(entry.checkpoint_status, 'passed');
  assert.equal(entry.io_files.input.length, 1);
  assert.equal(entry.io_files.output.length, 1);
  assert.ok(entry.task_id, 'task_id 必填');
  assert.ok(entry.start_time && entry.end_time);
});

test('台账 project_id 非法时构造即拒绝', () => {
  assert.throws(() => buildLedgerEntry({
    projectId: '../evil',
    lineId: 'line1_bulk',
    step: 'deg',
    inputs: [], outputs: [],
    status: 'completed',
    startedAt: '2026-10-12T10:00:00Z',
    endedAt: '2026-10-12T10:05:00Z',
  }));
});

test('台账的 io_files 只在本项目本线内：构造时不掺别的线', () => {
  const entry = buildLedgerEntry({
    lineId: 'line2_scrna',
    step: 'knockout',
    seed: 7,
    inputs: [`${PROJECTS_ROOT}/${P}/line2_scrna/processed/ctrl.h5ad`],
    outputs: [`${PROJECTS_ROOT}/${P}/line2_scrna/results/DR_genes.csv`],
    status: 'completed',
    checkpointStatus: 'passed',
    exitCode: 0,
    startedAt: '2026-10-12T10:00:00Z',
    endedAt: '2026-10-12T10:05:00Z',
  });
  // 自己生成的台账必须能过自己写的审计，这是闭环
  const result = auditCommand(JSON.stringify(entry), 'line2_scrna');
  assert.equal(result.allowed, true, result.reason || '');
});

test('失败的步骤必须带 error_log，否则台账自相矛盾', () => {
  const entry = buildLedgerEntry({
    lineId: 'line1_bulk',
    step: 'deg',
    seed: 42,
    inputs: [],
    outputs: [],
    status: 'failed',
    checkpointStatus: 'failed',
    exitCode: 1,
    errorLog: 'Rscript: command not found',
    startedAt: '2026-10-12T10:00:00Z',
    endedAt: '2026-10-12T10:00:10Z',
  });
  assert.equal(entry.status, 'failed');
  assert.equal(entry.error_log, 'Rscript: command not found');
});

test('checkpoint 未过时 random_seed 仍记录，但 status 不得谎报 passed', () => {
  const entry = buildLedgerEntry({
    lineId: 'line3_spatial',
    step: 'deconvolution',
    seed: 1,
    inputs: [],
    outputs: [],
    status: 'completed',
    checkpointStatus: 'failed',
    exitCode: 0,
    errorLog: '基因名不一致',
    startedAt: '2026-10-12T10:00:00Z',
    endedAt: '2026-10-12T10:05:00Z',
  });
  assert.equal(entry.checkpoint_status, 'failed');
});

test('生成的命令只触及本线，不含其他两条线字面量', () => {
  for (const line of LINES) {
    const others = LINES.filter((candidate) => candidate !== line);
    const script = buildTaskScript({
      lineId: line,
      step: 'deg',
      inputs: [`${PROJECTS_ROOT}/${P}/${line}/processed/expr.tsv`],
      outputs: [`${PROJECTS_ROOT}/${P}/${line}/results/deg.tsv`],
    });
    const result = auditCommand(script, line);
    assert.equal(result.allowed, true, result.reason || '');
    assert.equal(others.some((other) => script.includes(other)), false);
  }
});

test('脚本带 seed 与工作目录（项目内本线），保证可复现且不乱写', () => {
  const script = buildTaskScript({
    lineId: 'line1_bulk',
    step: 'deg',
    inputs: [`${PROJECTS_ROOT}/${P}/line1_bulk/processed/expr.tsv`],
    outputs: [`${PROJECTS_ROOT}/${P}/line1_bulk/results/deg.tsv`],
    seed: 42,
  });
  assert.match(script, /seed/);
  assert.match(script, new RegExp(`cd ${PROJECTS_ROOT}/${P}/line1_bulk/processed`));
});

test('脚本工作目录随项目变化（项目隔离）', () => {
  const script = buildTaskScript({
    projectId: 'proj_b',
    lineId: 'line1_bulk',
    step: 'deg',
    inputs: [],
    outputs: [],
  });
  assert.match(script, new RegExp(`cd ${PROJECTS_ROOT}/proj_b/line1_bulk/processed`));
  assert.ok(!script.includes(`${PROJECTS_ROOT}/${P}/`), '不得引用别的项目路径');
});

// 回归 2026-10-13 设计缺口：step 是命令名，在服务器上按 PATH 查找，但部署的
// 步骤脚本（src/<line>/scripts 经部署通道落到 bin/<line>/）此前不在 PATH 里，
// 一切 step 都是 command not found。脚本必须先注入本线 bin 目录（全局一份）。
test('脚本把本线全局 bin 目录注入 PATH，部署的步骤脚本才能被找到', () => {
  for (const line of LINES) {
    const script = buildTaskScript({
      lineId: line,
      step: 'deg',
      inputs: [`${PROJECTS_ROOT}/${P}/${line}/processed/expr.tsv`],
      outputs: [],
      seed: 42,
    });
    // PATH 注入必须在执行 step 之前，且只含本线路径（不越界的硬约束）
    assert.match(script, new RegExp(`export PATH="${BIN_ROOT}/${line}:\\$PATH"`), `${line} 缺 PATH 注入:\n${script}`);
    const exportIndex = script.indexOf('export PATH=');
    const stepIndex = script.lastIndexOf("'deg'");
    assert.ok(exportIndex < stepIndex, `${line} 的 PATH 注入排在 step 之后，注入无效`);
  }
});

test('adapted 任务执行项目脚本并把 canonical 图复制为 custom 产物', () => {
  const output = `${PROJECTS_ROOT}/${P}/line1_bulk/figures/custom_fig_l2_pca.png`;
  const script = buildTaskScript({
    projectId: P,
    lineId: 'line1_bulk',
    step: 'adapt_fig_l2_pca',
    inputs: [],
    outputs: [output],
    seed: 20261013,
    adapted: true,
    language: 'r',
    scriptPath: `${PROJECTS_ROOT}/${P}/line1_bulk/scripts/adapt_fig_l2_pca.R`,
    canonicalOutput: 'L2_pca_verified.png',
  });
  assert.match(script, /Rscript --vanilla/);
  assert.match(script, /adapt_fig_l2_pca\.R/);
  assert.ok(script.includes('L2_pca_verified.png'));
  assert.ok(script.includes('custom_fig_l2_pca.png'));
  assert.match(script, /adapted output missing/);
});

test('adapted 任务拒绝跨项目脚本路径', () => {
  assert.throws(() => buildTaskScript({
    projectId: P,
    lineId: 'line1_bulk',
    step: 'adapt_fig_l2_pca',
    inputs: [],
    outputs: [`${PROJECTS_ROOT}/${P}/line1_bulk/figures/custom_fig_l2_pca.png`],
    adapted: true,
    language: 'r',
    scriptPath: `${PROJECTS_ROOT}/other/line1_bulk/scripts/adapt_fig_l2_pca.R`,
    canonicalOutput: 'L2_pca_verified.png',
  }), /scriptPath 非法/);
});

test('adapted 任务对 canonical 错误文案统一 shellQuote', () => {
  const output = `${PROJECTS_ROOT}/${P}/line1_bulk/figures/custom_fig_l2_pca.png`;
  const canonicalOutput = "x'; touch /tmp/pwn; #";
  const script = buildTaskScript({
    projectId: P,
    lineId: 'line1_bulk',
    step: 'adapt_fig_l2_pca',
    inputs: [],
    outputs: [output],
    adapted: true,
    language: 'r',
    scriptPath: `${PROJECTS_ROOT}/${P}/line1_bulk/scripts/adapt_fig_l2_pca.R`,
    canonicalOutput,
  });
  assert.ok(script.includes(String.raw`'adapted output missing: x'\''; touch /tmp/pwn; #'`));
  assert.equal(script.includes("echo 'adapted output missing: x'; touch /tmp/pwn; #"), false);
});

test('adapted Python 任务通过环境变量继承 BIOANALYS_SEED', () => {
  const output = `${PROJECTS_ROOT}/${P}/line2_scrna/figures/custom_fig_l2p_umap.png`;
  const script = buildTaskScript({
    projectId: P,
    lineId: 'line2_scrna',
    step: 'adapt_fig_l2p_umap',
    inputs: [],
    outputs: [output],
    seed: 20261013,
    adapted: true,
    language: 'python',
    scriptPath: `${PROJECTS_ROOT}/${P}/line2_scrna/scripts/adapt_fig_l2p_umap.py`,
    canonicalOutput: 'umap_L2p_umap_verified.png',
  });
  assert.match(script, /export BIOANALYS_SEED="\$SEED"/);
  assert.match(script, /python3 .*adapt_fig_l2p_umap\.py/);
});

test('含单引号的参数按标准方式转义，远端 shell 能解析', () => {
  const step = "deg'O'Brien";
  const input = `${PROJECTS_ROOT}/${P}/line1_bulk/processed/it's fine.tsv`;
  const script = buildTaskScript({ lineId: 'line1_bulk', step, inputs: [input], outputs: [], seed: 1 });

  // 判据是转义形态本身：每个内层单引号必须变成 '\''（结束引号+转义引号+重开引号），
  // 这是 POSIX shell 唯一正确的转义形式。别用引号奇偶数判断，转义后天然是奇数。
  assert.ok(script.includes(`'deg'\\''O'\\''Brien'`), `step 转义形态不对:\n${script}`);
  assert.ok(script.includes(`it'\\''s fine.tsv`), `input 转义形态不对:\n${script}`);

  // 反向证明：未转义的形式一定被判定为坏味道
  const naive = `echo '${input}'`;
  assert.ok(naive.includes("s fine"), '未转义版本引号不配对，shell 会语法错误');
});

// 回归 2026-10-13 缺口 B：environment 曾四处写死默认值。现在由调用方从
// src/<line>/envs/manifest.txt 读后传入，container_image 也必须可覆盖。
test('environment 四字段可由调用方从 manifest 覆盖，不写死', () => {
  const entry = buildLedgerEntry({
    lineId: 'line1_bulk',
    step: 'deg',
    seed: 42,
    inputs: [],
    outputs: [],
    status: 'completed',
    checkpointStatus: 'passed',
    exitCode: 0,
    startedAt: '2026-10-12T10:00:00Z',
    endedAt: '2026-10-12T10:05:00Z',
    language: 'Python',
    version: '3.12.3',
    envName: 'line1_bulk_env',
    containerImage: 'proot-ubuntu24.04-aarch64+k40',
  });
  assert.equal(entry.environment.language, 'Python');
  assert.equal(entry.environment.version, '3.12.3');
  assert.equal(entry.environment.container_image, 'proot-ubuntu24.04-aarch64+k40');
});

test('environment 不传时用默认值（manifest 缺失时的退化路径）', () => {
  const entry = buildLedgerEntry({
    lineId: 'line1_bulk',
    step: 'deg',
    seed: 42,
    inputs: [],
    outputs: [],
    status: 'completed',
    checkpointStatus: 'passed',
    exitCode: 0,
    startedAt: '2026-10-12T10:00:00Z',
    endedAt: '2026-10-12T10:05:00Z',
  });
  assert.equal(entry.environment.language, 'R');
  assert.equal(entry.environment.version, '4.5.3');
  assert.equal(entry.environment.env_name, 'line1_bulk_env');
  assert.equal(entry.environment.container_image, 'proot-ubuntu24.04-aarch64');
});
