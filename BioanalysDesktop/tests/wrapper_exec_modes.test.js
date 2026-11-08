/**
 * 包装器执行体形态测试（D-21：引擎必须走包装器，包装器必须能执行命令串）
 *
 * 背景（2026-10-21 发现）：tools/ops/run_throttled_task.sh 的 $5 一直是**母版绝对路径**，
 * 而 server/task.js 的 throttled 分支把整条命令串（'scenic_tf --input ... --output ...'）
 * 当 $5 传进来 —— 包装器随后执行 "$SCRIPT_PATH"，那是一个含空格的"文件名"，必然 ENOENT。
 * 结果：throttled 分支长期不可用，引擎（run.js）一直用 throttled=false 绕过包装器直跑，
 * 于是 nice/ionice 降权、存储水位门禁、bio_limits 线程封顶这三项 aims §六.3 契约对
 * 「工作台下发的任务」全部失效，只剩手工直跑才享受。
 *
 * 本文件既钉住包装器的新形态（命令串模式 + 台账开关），也用真实 bash 跑通两种形态。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { TEST_TMP } from './support/test_tmp.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const WRAPPER = path.join(REPO, 'tools', 'ops', 'run_throttled_task.sh');

function findBash() {
  const candidates = [process.env.BIO_BASH, 'D:\\Git\\bin\\bash.exe', 'D:\\Git\\usr\\bin\\bash.exe', 'bash']
    .filter((v) => typeof v === 'string' && v.length > 0);
  for (const cand of candidates) {
    const res = spawnSync(cand, ['-n', WRAPPER], { encoding: 'utf8' });
    if (!res.error && res.status === 0) return cand;
  }
  return null;
}
const BASH = findBash();

/**
 * 把包装器母本拷到临时根下并改写三条绝对路径，使其可在本机跑：
 *   1. 数据根 /mnt/ssd/bio_data -> 临时根
 *   2. 门禁调用 -> 空操作（门禁依赖容器里的 df -T，本机无意义，另有真机验证）
 *   3. bio_limits.sh -> 不存在的路径（source 失败被兜住）
 */
function makeHarness() {
  const root = fs.mkdtempSync(path.join(TEST_TMP, 'wrapper-modes-')).replace(/\\/g, '/');
  fs.mkdirSync(path.join(root, 'ops'), { recursive: true });
  fs.mkdirSync(path.join(root, 'system_logs'), { recursive: true });
  const src = fs.readFileSync(WRAPPER, 'utf8');
  const patched = src
    .replaceAll('/mnt/ssd/bio_data', root)
    .replace(/^bash .*check_storage_and_isolation\.sh.*$/m, ': # gate skipped in local test')
    .replaceAll('/etc/profile.d/bio_limits.sh', root + '/no_such_bio_limits.sh')
    // Git bash 没有 nice/ionice（Linux 才有）；削峰参数本身由静态断言钉住，本机跑通只看执行体
    .replaceAll('nice -n 10 ionice -c 2 -n 4 ', '');
  assert.ok(patched.includes(root), 'path substitution must apply');
  assert.ok(patched.includes('# gate skipped in local test'), 'gate line substitution must apply');
  assert.equal(patched.includes('nice -n 10 ionice -c 2 -n 4 '), false, 'throttle prefix must be stripped for local run');
  const script = path.join(root, 'wrapper.sh');
  fs.writeFileSync(script, patched, 'utf8');
  return { root, script, logs: path.join(root, 'system_logs') };
}

function runWrapper(harness, args, env = {}) {
  const res = spawnSync(BASH, [harness.script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60000,
  });
  return { code: res.status, stdout: (res.stdout || '') + (res.stderr || '') };
}

const marker = (h, id) => path.join(h.logs, '_running', id + '.json');
const ledger = (h, id) => path.join(h.logs, id + '_ledger.json');
const logFile = (h, id) => path.join(h.logs, id + '.log');

test('命令串模式：BIO_EXEC_CMD 经 bash -c 执行，日志落 LOG_FILE，台账正常，标记删除', () => {
  assert.ok(BASH, 'bash not found');
  const h = makeHarness();
  const out = path.join(h.root, 'out.txt');
  const r = runWrapper(
    h,
    ['t_cmd_1', 'line2_scrna', 'probe', 'self', '/mnt/ssd/bio_data/bin/line2_scrna/probe'],
    { BIO_EXEC_CMD: 'echo STD_OUT; printf "HELLO" > "' + out + '"' }
  );
  assert.equal(r.code, 0, 'command-string mode must exit 0: ' + r.stdout);
  assert.equal(fs.readFileSync(out, 'utf8'), 'HELLO', 'command string must really run');
  assert.ok(fs.readFileSync(logFile(h, 't_cmd_1'), 'utf8').includes('STD_OUT'), 'stdout must go to LOG_FILE');
  const led = JSON.parse(fs.readFileSync(ledger(h, 't_cmd_1'), 'utf8'));
  assert.equal(led.status, 'completed');
  assert.equal(led.task_id, 't_cmd_1');
  assert.equal(fs.existsSync(marker(h, 't_cmd_1')), false, 'marker must be removed on success');
});

test('命令串模式：引号与管道按提交层原意解析（不是当成一个含空格的文件名）', () => {
  const h = makeHarness();
  const out = path.join(h.root, 'quoted.txt');
  const r = runWrapper(
    h,
    ['t_cmd_2', 'line2_scrna', 'probe', 'self', '/mnt/ssd/bio_data/bin/line2_scrna/probe'],
    { BIO_EXEC_CMD: 'printf "%s\\n" "a b" | tr " " "_" > "' + out + '"' }
  );
  assert.equal(r.code, 0, r.stdout);
  assert.equal(fs.readFileSync(out, 'utf8').trim(), 'a_b', 'pipes and quoted args must survive');
});

test('命令串失败时退出码透传，台账记 failed', () => {
  const h = makeHarness();
  const r = runWrapper(
    h,
    ['t_cmd_3', 'line2_scrna', 'probe', 'self', '/mnt/ssd/bio_data/bin/line2_scrna/probe'],
    { BIO_EXEC_CMD: 'exit 7' }
  );
  assert.equal(r.code, 7, 'exit code must pass through: ' + r.stdout);
  const led = JSON.parse(fs.readFileSync(ledger(h, 't_cmd_3'), 'utf8'));
  assert.equal(led.status, 'failed');
  assert.equal(led.checkpoint_status, 'halted');
  assert.equal(fs.existsSync(marker(h, 't_cmd_3')), false, 'marker removed even on failure');
});

test('BIO_WRAPPER_LEDGER=0：跳过包装器台账（避免与引擎权威台账双账），标记照删', () => {
  const h = makeHarness();
  const r = runWrapper(
    h,
    ['t_cmd_4', 'line2_scrna', 'probe', 'self', '/mnt/ssd/bio_data/bin/line2_scrna/probe'],
    { BIO_EXEC_CMD: 'true', BIO_WRAPPER_LEDGER: '0' }
  );
  assert.equal(r.code, 0, r.stdout);
  assert.equal(fs.existsSync(ledger(h, 't_cmd_4')), false, 'wrapper ledger must be skipped');
  assert.ok(r.stdout.includes('跳过包装器台账'), 'must announce the skip, not silently');
  assert.equal(fs.existsSync(marker(h, 't_cmd_4')), false, 'marker still removed');
});

test('脚本路径模式保持向后兼容：LANG_SPEC=bash 时按解释器执行 $5', () => {
  const h = makeHarness();
  const step = path.join(h.root, 'probe.sh');
  fs.writeFileSync(step, '#!/bin/bash\necho SCRIPT_PATH_MODE\n', 'utf8');
  const r = runWrapper(h, ['t_cmd_5', 'line2_scrna', 'probe', 'bash', step]);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(fs.readFileSync(logFile(h, 't_cmd_5'), 'utf8').includes('SCRIPT_PATH_MODE'), 'script-path mode must still work');
});

test('静态：BIO_EXEC_CMD 分支排在 EXEC_CMD 分支之前，且用 bash -c 执行', () => {
  const text = fs.readFileSync(WRAPPER, 'utf8');
  const execIdx = text.indexOf('if [ -n "${BIO_EXEC_CMD:-}" ]');
  const legacyIdx = text.indexOf('elif [ -n "$EXEC_CMD" ]');
  assert.ok(execIdx > 0, 'missing BIO_EXEC_CMD branch');
  assert.ok(legacyIdx > execIdx, 'BIO_EXEC_CMD branch must come first');
  assert.ok(/nice -n 10 ionice -c 2 -n 4 bash -c "\$BIO_EXEC_CMD"/.test(text), 'command string must keep the throttle prefix and go through bash -c');
});

test('静态：台账开关包住 heredoc，删标记排在开关之后（标记残留仍等于中断取证）', () => {
  const text = fs.readFileSync(WRAPPER, 'utf8');
  const guardIdx = text.indexOf('if [ "${BIO_WRAPPER_LEDGER:-1}" = "1" ]; then');
  const heredocIdx = text.indexOf('cat <<EOF > "$LEDGER_JSON"');
  const rmIdx = text.indexOf('rm -f "$RUNNING_JSON"');
  assert.ok(guardIdx > 0, 'missing BIO_WRAPPER_LEDGER switch');
  assert.ok(heredocIdx > guardIdx, 'ledger heredoc must be inside the switch');
  assert.ok(rmIdx > heredocIdx, 'marker removal must stay after ledger write (D-20)');
  assert.ok(text.includes('跳过包装器台账'), 'skip path must be announced');
});

test('静态：文件头写明两种执行体形态与 D-21 出处', () => {
  const text = fs.readFileSync(WRAPPER, 'utf8');
  assert.ok(text.includes('BIO_EXEC_CMD'), 'header must document command-string mode');
  assert.ok(text.includes('BIO_WRAPPER_LEDGER'), 'header must document ledger switch');
  assert.ok(/D-21/.test(text), 'header must cite the decision id');
  assert.ok(text.includes('脚本路径模式') && text.includes('命令串模式'), 'both modes must be named');
});

test('包装器仍是 LF-only 且语法正确', () => {
  const bytes = fs.readFileSync(WRAPPER);
  assert.equal(bytes.includes(13), false, 'no CR allowed (CRLF breaks awk numeric compare, pitfall #103)');
  assert.ok(BASH, 'bash not found');
  const res = spawnSync(BASH, ['-n', WRAPPER], { encoding: 'utf8' });
  assert.equal(res.status, 0, 'bash -n must pass: ' + (res.stderr || ''));
});
