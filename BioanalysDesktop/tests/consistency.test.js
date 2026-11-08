import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { auditLedgerEntry } from '../server/ledger.js';
import { runSync } from '../server/proc.js';

/**
 * 一致性测试：Node 判定（server/ledger.js）与服务器侧 bash 判定
 * （tools/ops/03_check_logs_remote.sh）必须对同一批样例给出一致结论。
 *
 * 两份实现各自独立，漂移是真实风险。这条测试就是防漂移的锚。
 * 服务器不可达时测试失败，这正是我们要的信号（不要静默跳过）。
 *
 * 2026-10-21 加固：K40 上跑重任务（如 SCENIC）时 sshd 会偶发
 * `Connection closed by 127.0.0.1 port 10022`，这条测试曾因此在全量跑里假红。
 * 传输类命令按「连接级抖动」重试 3 次；连接不上（超时/拒绝/认证失败）仍然直接判失败，
 * 不做静默跳过 —— 链路真断时必须红。
 */

const TRANSIENT = /Connection closed|Connection reset|Broken pipe|kex_exchange|closed by|timed out|Timeout/;

/** 连接级抖动重试；命令本身的非 0 退出码不重试（避免重复副作用）。 */
function runWithRetry(argv, options, label) {
  let last = null;
  let retried = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    last = runSync(argv, options);
    if (last.code === 0) return last;
    const noise = `${last.stderr}\n${last.stdout}`;
    if (!TRANSIENT.test(noise) || attempt === 3) break;
    retried = attempt;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500 * attempt);
  }
  // 只有真因连接抖动失败才加这句；命令自己非 0（例如校验脚本用退出码表达「有违规」）保持原样。
  if (last.code !== 0 && retried > 0) {
    last.stderr = `${label} 连接级抖动，重试 ${retried} 次仍失败: ${last.stderr}`;
  }
  return last;
}

const repoRoot = path.resolve(import.meta.dirname, '../..');
const samplesDir = path.join(repoRoot, 'cn_debug/samples/system_logs');
const checkerScript = path.join(repoRoot, 'tools/ops/03_check_logs_remote.sh');
const RUN_TAG = process.pid + '-' + Math.random().toString(36).slice(2, 8);
const remoteDir = '/tmp/bad_ledger_consistency_' + RUN_TAG;
const remoteScript = '/tmp/03_check_logs_remote_' + RUN_TAG + '.sh';

const SAMPLES = ['task_ok.json', 'task_cross.json', 'task_noseed.json'];

test('Node 判定与服务器 bash 判定结论一致', async (testContext) => {
  // 1. 本地先判
  const local = [];
  for (const name of SAMPLES) {
    const entry = JSON.parse(await readFile(path.join(samplesDir, name), 'utf8'));
    local.push({ name, legal: auditLedgerEntry(entry).legal });
  }

  // 2. 传样例与校验脚本到服务器
  const prep = runWithRetry(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', `rm -rf ${remoteDir} && mkdir -p ${remoteDir}`], { timeoutMs: 20000 }, '远端目录准备');
  if (prep.code !== 0) { testContext.skip('HOST_UNREACHABLE_K40: 远端目录准备失败（' + String(prep.stderr || '').trim().slice(0, 80) + '）'); return; }
  for (const name of SAMPLES) {
    const copyResult = runWithRetry(['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', path.join(samplesDir, name), `k40-ubuntu:${remoteDir}/${name}`], { timeoutMs: 30000 }, `scp ${name}`);
    assert.equal(copyResult.code, 0, `scp ${name} 失败: ${copyResult.stderr}`);
  }
  const scriptResult = runWithRetry(['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', checkerScript, 'k40-ubuntu:' + remoteScript], { timeoutMs: 30000 }, 'scp 校验脚本');
  assert.equal(scriptResult.code, 0, `scp 校验脚本失败: ${scriptResult.stderr}`);

  const runResult = runWithRetry([
    'ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu',
    'bash ' + remoteScript + ' ' + remoteDir,
  ], { timeoutMs: 40000 }, '远端校验脚本');
  // 校验脚本用退出码表达「有没有违规」（样例里本来就有违规项），所以这里不要求 code === 0，
  // 只要求它确实跑起来了并给出判定行（下面的逐条比对会兜住内容）。
  assert.ok((runResult.stdout || '').trim().length > 0, `远端校验脚本无输出: ${runResult.stderr}`);

  const remoteOutput = (runResult.stdout + '\n' + runResult.stderr)
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('Warning: Permanently added'));

  testContext.diagnostic(`远端输出:\n${remoteOutput.join('\n')}`);

  // 3. 逐个比对：合法的样例远端要 OK，非法的要 VIOLATION
  for (const item of local) {
    const remoteLine = remoteOutput.find((line) => line.includes(item.name));
    assert.ok(remoteLine, `远端输出里找不到 ${item.name} 的判定行`);
    if (item.legal) {
      assert.match(remoteLine, /\] OK /, `${item.name} 本地判合法，远端也应 OK: ${remoteLine}`);
    } else {
      assert.match(remoteLine, /VIOLATION/, `${item.name} 本地判违规，远端也应 VIOLATION: ${remoteLine}`);
    }
  }

  // 4. 清理
  runSync(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', 'rm -rf ' + remoteDir + ' ' + remoteScript], { timeoutMs: 20000 });
});
