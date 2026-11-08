import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(REPO, relativePath), 'utf8');

test('旧规则台账列明保留、停用、对齐三类规则及运行影响', () => {
  const text = read('docs/LEGACY_RULES_CLEANUP_LEDGER.md');
  for (const phrase of [
    'G1 到 G5 组图契约',
    '默认 SSH，ADB 失败自动回落 SSH',
    '报告正文允许出现运行环境',
    '8GB 内存下可引入重型解卷积',
    '对当前运行的实际影响',
    'LEGACY_RULES_CLEANUP_OK',
  ]) assert.ok(text.includes(phrase), `台账缺少 ${phrase}`);
  assert.equal(text.includes('—'), false, '文档不用破折号');
});

test('SCOPE 的 Ready 基线与单图红线同步到 39', () => {
  const scope = read('SCOPE.md');
  assert.match(scope, /REJ-012 \| 突破 Ready 模板实证棘轮（当前基线 39）/);
  assert.match(scope, /组合图与 Draft 模板严禁进入 Ready/);
  assert.equal(scope.includes('基线 >= 40'), false);
});

test('架构总览不再声称默认 SSH，且图件基线同步', () => {
  const text = read('docs/ARCHITECTURE_OVERVIEW.md');
  assert.match(text, /默认经 ADB 下发，显式 ssh 开关时经 SSH/);
  assert.match(text, /92 条出图模板（39 条 Ready 单图）/);
  assert.equal(text.includes('30 条 ready 封板'), false);
  assert.equal(text.includes('runSsh(cmd)'), false);
});

test('前端计算面模式默认 ADB，兼容 SSH 特殊开关与 mock', () => {
  const app = read('BioanalysDesktop/src/App.tsx');
  assert.match(app, /useState<'adb' \| 'ssh' \| 'mock'>\('adb'\)/);
  assert.match(app, /payload.compute_mode === 'mock' \|\| payload.compute_mode === 'ssh'/);
});

test('生产母版不再生成已退役组合图', () => {
  const l1 = read('tools/bio/line1_bulk/scripts/bulk_figures');
  const l2 = read('tools/bio/line2_scrna/scripts/scrna_figures');
  const l3 = read('tools/bio/line3_spatial/scripts/spatial_figures');
  assert.equal(/save\([^\n]*l1_32_deg_overview/.test(l1), false);
  assert.equal(/save\([^\n]*l2_20_composition_panel/.test(l2), false);
  assert.equal(/save\([^\n]*16_domain_panel/.test(l3), false);
  assert.match(l2, /retired l2_20_composition_panel/);
  for (const source of [l1, l2, l3]) assert.equal(source.includes('组图契约 G1-G5'), false);
});

test('参考验证矩阵把组合图证据标成 retired，不影响 39 基线', () => {
  const plotMatrix = read('ops/verify_plot_matrix.py');
  const r453 = read('ops/verify_r453_figures.py');
  assert.match(plotMatrix, /retired|RETIRED/);
  assert.match(r453, /retired|RETIRED/);
});

test('图件说明不再把组图当正式产物', () => {
  const figures = read('BioanalysDesktop/server/figures.js');
  assert.equal(figures.includes('组合图从 16 起'), false);
  assert.equal(figures.includes('line1 组图（Step 5 组图契约'), false);
});

test('旧规则当前真源：39 Ready、默认 ADB、项目内容消融、工单闭环', () => {
  const allowlist = JSON.parse(read('ops/figure_ready_allowlist.json'));
  assert.equal(allowlist.ready_baseline, 39);
  assert.equal(allowlist.ids.length, 39);
  const proc = read('BioanalysDesktop/server/proc.js');
  assert.match(proc, /process.env.BIO_COMPUTE_ADAPTER \|\| 'adb'/);
  assert.match(proc, /function rewriteRemoteArgv/);
  assert.ok(fs.existsSync(path.join(REPO, 'docs/PROJECT_CONTENT_ABLATION_REPORT.md')));
  assert.ok(fs.existsSync(path.join(REPO, 'docs/WORK_ORDER_ORCHESTRATOR_REPORT.md')));
});

test('AGENTS.md 导航表接入新规则指针，旧通道措辞清除', () => {
  const agents = read('AGENTS.md');
  for (const phrase of [
    'docs/figure_spec.md',
    'docs/WORK_ORDER_ORCHESTRATOR.md',
    'docs/MODULE_ABLATION_MATRIX.md',
    'module_ablation_matrix_gate',
    'ADB 主通道，SSH 仅显式特殊开关',
    '计算与文件传输默认走 ADB',
    '生产图件只出单图',
  ]) {
    assert.ok(agents.includes(phrase), `AGENTS.md 缺少新规则指针: ${phrase}`);
  }
  assert.equal(agents.includes('sshd 备用'), false, 'AGENTS.md 仍残留旧通道措辞');
});

test('通道策略标题与特殊开关措辞更新，历史表格保留事实描述', () => {
  const policy = read('docs/remote_channel_policy.md');
  assert.match(policy, /^# 远程通道策略：ADB 主通道，SSH 仅显式特殊开关/);
  assert.equal(policy.includes('adb 为主，sshd 备用'), false);
  assert.match(policy, /SSH 显式特殊开关通道需按需重建/);
});

test('改动前规则备份存在且清单哈希与备份文件一致', () => {
  const backupDir = '_archive/rules_backup_20261108';
  const manifest = read(`${backupDir}/MANIFEST.sha256`);
  const entries = manifest.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [hash, name] = line.split(/\s{2,}/);
      return { hash, name };
    });
  assert.ok(entries.length >= 2, '备份清单至少含两个规则文件');
  for (const entry of entries) {
    const file = path.join(REPO, backupDir, entry.name);
    assert.ok(fs.existsSync(file), `备份缺失: ${entry.name}`);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(actual, entry.hash, `${entry.name} 备份哈希与清单不符`);
  }
});
