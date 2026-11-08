/**
 * 存储水位门禁的「量不出来必须算不过」回归测试。
 *
 * 真机事故（2026-11-01，K40 上线后首次真机核验）：tools/ops/check_storage_and_isolation.sh
 * 只开了 `set -e`，没开 pipefail。df -P 失败时管道里最后的 tr 仍回 0，set -e 不触发，
 * USED_PERCENT 取到空串；下一行 $((100 - USED_PERCENT)) 把空串当 0 算，FREE_PERCENT=100，
 * 门禁于是打印「[OK] … 剩余空间=100%」并 exit 0。测不出来的存储水位被判成健康，
 * 属于 P-15 同一类假绿灯：自检是提交门禁，假绿灯比红灯危险。
 *
 * 同文件第 2 维（FS_TYPE）早就有 -z 空值守卫，这一维漏了。
 *
 * 口径：测量失败必须 exit 1 且不得打印通过行。期望值来自 df 的独立真源桩，
 * 不是把被测逻辑抄一遍算出来的。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const GATE = path.join(REPO_ROOT, 'tools', 'ops', 'check_storage_and_isolation.sh').replace(/\\/g, '/');

function findBash() {
  const candidates = [process.env.BRIDGE_GUARD_BASH, 'D:\\Git\\bin\\bash.exe', 'D:\\Git\\usr\\bin\\bash.exe', 'bash']
    .filter((v) => typeof v === 'string' && v.length > 0);
  for (const cand of candidates) {
    const res = spawnSync(cand, ['-c', 'true'], { encoding: 'utf8' });
    if (!res.error && res.status === 0) return cand;
  }
  return null;
}
const BASH = findBash();
const NEED_BASH = BASH === null ? 'HOST_MISSING_BASH: 宿主无 bash 解释器' : false;

/** df -T 的合法输出桩：让第 2 维先过，把问题隔离到第 3 维 */
const DF_T_OK = [
  'echo "Filesystem     Type 1K-blocks    Used Available Use% Mounted on"',
  'echo "/dev/block/f2fs f2fs 100000 26000 74000 26% /mnt/ssd/bio_data"',
].join('; ');

/**
 * 在同一个 bash 里定义 df 函数再 source 门禁脚本：函数遮蔽同名外部命令，
 * 不需要往 PATH 里塞带可执行位的桩文件（Windows 上那一位不可靠）。
 * source 而非子 bash，是为了让 exit 码直接成为 spawnSync 的 status。
 */
function runGate(dfBody) {
  // 闭括号前必须有分隔符，否则 bash 认不出 } 而归给 return，整条环以 status 2 退出
  const script = `df() { ${dfBody}; }; . '${GATE}' line1_bulk`;
  return spawnSync(BASH, ['-c', script], { encoding: 'utf8', cwd: REPO_ROOT });
}

test('正对照：df 正常给出 26% 时门禁必须通过（证明这条环真的在驱动门禁）', { skip: NEED_BASH }, () => {
  const dfBody = `if [ "$1" = "-T" ]; then ${DF_T_OK}; return 0; fi; `
    + `if [ "$1" = "-P" ]; then echo "Filesystem 1024-blocks Used Available Capacity Mounted on"; `
    + `echo "/dev/block/f2fs 100000 26000 74000 26% /mnt/ssd/bio_data"; return 0; fi; return 1`;
  const res = runGate(dfBody);
  assert.equal(res.status, 0, `健康水位应通过，实际 status=${res.status} stderr=${res.stderr}`);
  assert.match(res.stdout, /\[OK\] 门禁校验通过/);
  assert.match(res.stdout, /剩余空间=74%/);
});

test('假绿灯回归：df -P 无输出时必须 exit 1，不得报通过', { skip: NEED_BASH }, () => {
  // 只让 df -T 成功；df -P 一律失败且无输出，复现真机上的空测量
  const dfBody = `if [ "$1" = "-T" ]; then ${DF_T_OK}; return 0; fi; return 1`;
  const res = runGate(dfBody);
  assert.doesNotMatch(res.stdout, /\[OK\] 门禁校验通过/,
    `存储水位没量出来却打印了通过行：${res.stdout}`);
  assert.doesNotMatch(res.stdout, /剩余空间=100%/,
    `空测量被判成 100% 空闲：${res.stdout}`);
  assert.equal(res.status, 1, `空测量必须非 0 退出，实际 status=${res.status}`);
});

test('假绿灯回归：df -P 只回头部行（无数据行）时同样不得通过', { skip: NEED_BASH }, () => {
  const dfBody = `if [ "$1" = "-T" ]; then ${DF_T_OK}; return 0; fi; `
    + `if [ "$1" = "-P" ]; then echo "Filesystem 1024-blocks Used Available Capacity Mounted on"; return 0; fi; return 1`;
  const res = runGate(dfBody);
  assert.doesNotMatch(res.stdout, /\[OK\] 门禁校验通过/,
    `缺数据行却打印了通过行：${res.stdout}`);
  assert.equal(res.status, 1, `缺数据行必须非 0 退出，实际 status=${res.status}`);
});

test('静态：门禁脚本必须开 pipefail，并给使用率加数字校验', () => {
  const text = fs.readFileSync(GATE, 'utf8');
  assert.match(text, /set -[a-z]*o pipefail/, '门禁脚本必须开 pipefail，否则管道尾命令掩盖 df 失败');
  assert.match(text, /\[\[ ! "\$USED_PERCENT" =~ \^\[0-9\]\+\$ \]\]/,
    '使用率必须有数字校验，空串或非数字一律拦');
});
