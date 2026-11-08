/**
 * 引擎 → 包装器接线测试（D-21）
 *
 * 背景：tools/ops/run_throttled_task.sh 提供的三项保障（nice/ionice 降权、存储水位与跨线门禁、
 * 线程封顶）是 aims §六.3 的硬契约。但 2026-10-21 排查发现 server/run.js 调
 * buildTaskScript 时压根没传 throttled，引擎一直直跑 rawCmd，三项保障对「工作台下发
 * 的任务」全部失效；而 throttled 分支本身也是坏的（把整条命令串当 $5 脚本路径传，
 * 包装器执行 $SCRIPT_PATH 必然 ENOENT）。
 *
 * 本文件钉住三件事：
 *   1. run.js 必须传 throttled: true；
 *   2. throttled 分支必须用命令串模式（BIO_EXEC_CMD）+ 关掉包装器台账（避免双账）；
 *   3. 命令串经过 shellQuote 后必须能被真实 bash 还原成一模一样的 rawCmd（引号不能丢）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTaskScript } from '../server/task.js';
import { auditCommand } from '../server/audit.js';
import { binDir } from '../server/domain.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const TASK_JS = path.join(REPO, 'BioanalysDesktop', 'server', 'task.js');
const RUN_JS = path.join(REPO, 'BioanalysDesktop', 'server', 'run.js');

const BASE = {
  projectId: 'PRJ_E2E_SCRNA',
  lineId: 'line2_scrna',
  step: 'scenic_tf',
  inputs: ['processed/scrna_norm.h5ad', 'processed/hvg_genes.tsv'],
  outputs: ['processed/tf_activity.tsv'],
  seed: 20261021,
};

function findBash() {
  for (const cand of [process.env.BIO_BASH, 'D:\\Git\\bin\\bash.exe', 'bash']) {
    if (!cand) continue;
    const res = spawnSync(cand, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (!res.error && res.status === 0) return cand;
  }
  return null;
}
const BASH = findBash();

test('run.js 必须把 throttled 置为 true（否则降权/门禁/线程封顶对引擎任务全部失效）', () => {
  const text = fs.readFileSync(RUN_JS, 'utf8');
  assert.ok(/buildTaskScript\(\{\s*\.\.\.task,\s*throttled:\s*true,\s*detached,\s*wrapperTaskId,/.test(text),
    'run.js 必须以 throttled: true 调用 buildTaskScript');
  assert.equal(/buildTaskScript\(task\)/.test(text), false, '不得再出现不传 throttled 的调用');
});

test('throttled 分支用命令串模式：BIO_EXEC_CMD + BIO_WRAPPER_LEDGER=0', () => {
  const script = buildTaskScript({ ...BASE, throttled: true });
  assert.ok(script.includes('export BIO_EXEC_CMD='), '缺命令串注入');
  assert.ok(script.includes('export BIO_WRAPPER_LEDGER=0'), '必须关掉包装器台账（避免双账）');
  const cmdIdx = script.indexOf('export BIO_EXEC_CMD=');
  const wrapIdx = script.indexOf('run_throttled_task.sh');
  assert.ok(cmdIdx > 0 && wrapIdx > cmdIdx, 'BIO_EXEC_CMD 必须排在包装器调用之前');
});

test('$5 传的是母版绝对路径（给门禁做跨线扫描），不是整条命令串', () => {
  const script = buildTaskScript({ ...BASE, throttled: true });
  const wrapLine = script.split('\n').find((line) => line.includes('run_throttled_task.sh'));
  assert.ok(wrapLine, '找不到包装器调用行');
  assert.ok(wrapLine.includes(binDir('line2_scrna') + '/scenic_tf'), '$5 必须是 bin/<线>/<步骤名>');
  assert.equal(wrapLine.includes('--input'), false, '$5 里不得再出现命令串（那正是 ENOENT 的根因）');
  assert.ok(/\sself\s/.test(wrapLine), 'LANG_SPEC 位必须是 self（命令串模式不按解释器跑）');
});

test('命令串经 shellQuote 后能被真实 bash 还原成原样（引号不丢、空格不拆）', () => {
  assert.ok(BASH, '找不到 bash');
  const script = buildTaskScript({ ...BASE, throttled: true });
  const exportLine = script.split('\n').find((line) => line.startsWith('export BIO_EXEC_CMD='));
  assert.ok(exportLine, '找不到 BIO_EXEC_CMD 行');
  const res = spawnSync(BASH, ['-c', exportLine + '\nprintf %s "$BIO_EXEC_CMD"'], { encoding: 'utf8' });
  assert.equal(res.status, 0, 'bash 必须能解析该行：' + (res.stderr || ''));
  const expected = [
    "'scenic_tf'",
    "--input 'processed/scrna_norm.h5ad'",
    "--input 'processed/hvg_genes.tsv'",
    "--output 'processed/tf_activity.tsv'",
    '--seed 20261021',
  ].join(' ');
  assert.equal(res.stdout, expected, '命令串必须逐字符还原（否则母版收到的参数会被拆断）');
});

test('throttled 与非 throttled 共用同一条 rawCmd（不能两套命令）', () => {
  const plain = buildTaskScript({ ...BASE, throttled: false });
  const wrapped = buildTaskScript({ ...BASE, throttled: true });
  const plainCmd = plain.split('\n').filter((l) => !l.startsWith('#')).pop();
  assert.ok(plainCmd.includes("'scenic_tf' --input 'processed/scrna_norm.h5ad'"), '非包装模式命令串不对');
  // 包装模式里命令串被 shellQuote 包了一层（内部单引号变成 '\\'' ），字面比对必然不中，
  // 所以交给 bash 解回来再比 —— 这同时验证了「还原后与原命令逐字符一致」。
  assert.ok(BASH, '找不到 bash');
  const exportLine = wrapped.split('\n').find((line) => line.startsWith('export BIO_EXEC_CMD='));
  const res = spawnSync(BASH, ['-c', exportLine + '\nprintf %s "$BIO_EXEC_CMD"'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr || '');
  assert.equal(res.stdout, plainCmd, '两种模式必须是同一条命令串（不许维护两套）');
});

test('审计对包装后的脚本仍然放行（改走包装器不能被 audit 拒）', () => {
  const script = buildTaskScript({ ...BASE, throttled: true });
  const audit = auditCommand(script, BASE.lineId);
  assert.equal(audit.allowed, true, '审计拒绝：' + audit.reason);
});

test('静态：task.js 不再把 rawCmd 当 $5 传（D-21 根因不许回潮）', () => {
  const text = fs.readFileSync(TASK_JS, 'utf8');
  assert.ok(text.includes('export BIO_EXEC_CMD='), 'task.js 缺命令串注入');
  assert.ok(text.includes("detached ? '1' : '0'"), 'task.js 缺 detached/前台台账分流');
  const script = buildTaskScript({ ...BASE, throttled: true });
  assert.ok(script.includes('export BIO_WRAPPER_LEDGER=0'), '前台包装器必须关闭重复台账');
  assert.ok(text.includes('self $' + '{shellQuote(') && text.includes('binDir(lineId)'),
    '必须把母版绝对路径传给门禁');
  assert.equal(text.includes('self $' + '{rawCmd}'), false, '旧的 rawCmd 当 $5 写法必须彻底删掉');
});

test('K40 上包装器与母版落点确实存在（静态路径自洽）', () => {
  const script = buildTaskScript({ ...BASE, throttled: true });
  assert.ok(script.includes('bash /mnt/ssd/bio_data/ops/run_throttled_task.sh'), '包装器路径不对');
  assert.ok(script.includes(binDir('line2_scrna') + '/scenic_tf'), '母版落点路径不对');
});
