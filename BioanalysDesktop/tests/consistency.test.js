import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { auditLedgerEntry } from '../server/ledger.js';
import { runSync } from '../server/proc.js';

/**
 * 一致性测试：Node 判定（server/ledger.js）与服务器侧 bash 判定
 * （ops/03_check_logs_remote.sh）必须对同一批样例给出一致结论。
 *
 * 两份实现各自独立，漂移是真实风险。这条测试就是防漂移的锚。
 * 服务器不可达时测试失败，这正是我们要的信号（不要静默跳过）。
 */

const repoRoot = path.resolve(import.meta.dirname, '../..');
const samplesDir = path.join(repoRoot, 'cn_debug/samples/system_logs');
const checkerScript = path.join(repoRoot, 'ops/03_check_logs_remote.sh');
const remoteDir = '/tmp/bad_ledger_consistency';

const SAMPLES = ['task_ok.json', 'task_cross.json', 'task_noseed.json'];

test('Node 判定与服务器 bash 判定结论一致', async (testContext) => {
  // 1. 本地先判
  const local = [];
  for (const name of SAMPLES) {
    const entry = JSON.parse(await readFile(path.join(samplesDir, name), 'utf8'));
    local.push({ name, legal: auditLedgerEntry(entry).legal });
  }

  // 2. 传样例与校验脚本到服务器
  runSync(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', `rm -rf ${remoteDir} && mkdir -p ${remoteDir}`], { timeoutMs: 20000 });
  for (const name of SAMPLES) {
    const copyResult = runSync(['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', path.join(samplesDir, name), `k40-ubuntu:${remoteDir}/${name}`], { timeoutMs: 30000 });
    assert.equal(copyResult.code, 0, `scp ${name} 失败: ${copyResult.stderr}`);
  }
  const scriptResult = runSync(['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', checkerScript, 'k40-ubuntu:/tmp/03_check_logs_remote.sh'], { timeoutMs: 30000 });
  assert.equal(scriptResult.code, 0, `scp 校验脚本失败: ${scriptResult.stderr}`);

  const runResult = runSync([
    'ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu',
    `bash /tmp/03_check_logs_remote.sh ${remoteDir}`,
  ], { timeoutMs: 40000 });

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
  runSync(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', `rm -rf ${remoteDir} /tmp/03_check_logs_remote.sh`], { timeoutMs: 20000 });
});
