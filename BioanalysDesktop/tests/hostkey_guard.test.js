import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SSHD = path.join(REPO, 'tools', 'ops', 'k40', 'sv', 'sshd', 'run');
const UBU = path.join(REPO, 'tools', 'ops', 'k40', 'sv', 'ubuntu-sshd', 'run');
const SELFTEST = path.join(REPO, 'tools', 'ops', 'k40', 'hostkey_guard_selftest.sh');

// ── host key 守卫的静态契约（2026-11-03，4 Argon 第十八/十九轮）──
//
// 故障形态（实测）：host key 缺失时 sshd 打印 "no hostkeys available"、dropbear 打印
// "No hostkeys available" 后立即退出（exit 1），runit 反复重启，8022 / 10022 永不监听，
// 服务状态显示 run 但连不上。守卫只在缺 key 时生成；生成失败或生成后仍缺，必须打层代号
// 并 exit 1（禁止「告警后照常启动」，那会让 runit 用无 key 的 sshd 空转）。
//
// 诊断只走 stdout 的理由（runit 只接 fd1）写在 tests/runit_sv_contract.test.js。

const read = (p) => fs.readFileSync(p, 'utf8');
// 只数代码行里的 exit：注释里也会写「exit 1」，混进来会让计数断言失真
const codeText = (text) => text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
const idx = (text, needle, from = 0) => {
  const i = text.indexOf(needle, from);
  assert.ok(i >= 0, '缺片段：' + needle);
  return i;
};

test('sshd 守卫：生成失败与「生成后仍缺」都打 8022 层代号并退出', () => {
  const text = read(SSHD);
  const gen = idx(text, 'if ! "$PREFIX/bin/ssh-keygen" -A; then');
  const codeGen = idx(text, '[guard:sshd] ERR_STAGE_HOSTKEY_8022 ssh-keygen -A 退出码非零');
  const verify = idx(text, '[ -f "$HOST_KEY" ] || { echo', codeGen);
  const codeVerify = idx(text, '[guard:sshd] ERR_STAGE_HOSTKEY_8022 ssh-keygen -A 未产出');
  const exec = idx(text, 'exec sshd -D -e');
  assert.ok(gen < codeGen, '生成失败的错误码必须在生成调用之后');
  assert.ok(codeGen < verify, '复查必须排在「生成失败」之后，两条分支各自独立可见');
  assert.ok(verify < codeVerify, '复查行的错误码必须写在同一行上');
  assert.ok(codeVerify < exec, '守卫必须在段4 之前');
  assert.equal((codeText(text).match(/exit 1/g) || []).length, 2, 'sshd 代码里必须恰好两处 exit 1');
});

test('ubuntu-sshd 守卫：同样两条失败分支都打 10022 层代号并退出', () => {
  const text = read(UBU);
  const gen = idx(text, 'if ! "$PREFIX/bin/proot-distro" login ubuntu --');
  const codeGen = idx(text, '[guard:ubuntu-sshd] ERR_STAGE_HOSTKEY_10022 dropbearkey 退出码非零');
  const verify = idx(text, '[ -f "$HOST_KEY" ] || { echo', codeGen);
  const codeVerify = idx(text, '[guard:ubuntu-sshd] ERR_STAGE_HOSTKEY_10022 宿主侧仍看不到');
  const exec = idx(text, 'exec "$PREFIX/bin/proot-distro" login ubuntu --');
  assert.ok(gen < codeGen, '生成失败的错误码必须在生成调用之后');
  assert.ok(codeGen < verify, '复查必须排在「生成失败」之后');
  assert.ok(verify < codeVerify, '复查行的错误码必须写在同一行上');
  assert.ok(codeVerify < exec, '守卫必须在段4 之前');
  assert.equal((codeText(text).match(/exit 1/g) || []).length, 2, 'ubuntu-sshd 代码里必须恰好两处 exit 1');
});

test('守卫入口唯一：只在缺 key 时触发一次，key 由同一个变量表达', () => {
  for (const [p, keyVar] of [
    [SSHD, 'HOST_KEY="$PREFIX/etc/ssh/ssh_host_ed25519_key"'],
    [UBU, 'HOST_KEY="$ROOTFS/etc/dropbear/dropbear_ed25519_host_key"'],
  ]) {
    const text = read(p);
    const svc = path.basename(path.dirname(p));
    assert.ok(text.includes(keyVar), svc + ' 的 HOST_KEY 定义变了：' + keyVar);
    assert.equal((text.match(/if \[ ! -f "\$HOST_KEY" \]; then/g) || []).length, 1, svc + ' 守卫入口必须唯一');
    // 守卫必须在段2 之后：exec 2>&1 是全局 fd 合并，守卫的 echo 才进得了日志
    assert.ok(idx(text, 'exec 2>&1') < idx(text, 'if [ ! -f "$HOST_KEY" ]; then'), svc + ' 守卫必须排在 exec 2>&1 之后');
  }
});

test('自测脚本覆盖三条分支并带哨兵与清理', () => {
  assert.ok(fs.existsSync(SELFTEST), 'tools/ops/k40/hostkey_guard_selftest.sh 缺失');
  const text = read(SELFTEST);
  assert.ok(text.includes('SELFTEST_PASS'), '缺成功哨兵');
  assert.ok(text.includes('SELFTEST_FAIL'), '缺失败哨兵');
  assert.ok(text.includes('MODE=fail'), '缺「生成失败」分支');
  assert.ok(text.includes('check_absent'), '缺「有 key 不生成」断言');
  assert.ok(text.includes('check_exit'), '缺退出码断言（守卫失败必须 exit 1）');
  assert.ok(text.includes('ERR_STAGE_HOSTKEY_8022') && text.includes('ERR_STAGE_HOSTKEY_10022'), '缺层代号断言');
  assert.ok(text.includes('proot-distro'), '缺容器侧 shim');
  assert.ok(text.includes('mktemp -d'), '自测未用临时目录，会碰到生产密钥');
  // 段2 也是 exec 开头：自测的哨兵替换必须只命中最后一行 exec，否则守卫段被跳过（假绿）
  assert.ok(text.includes('if (i == last)'), '自测必须只替换最后一处 exec（段2 exec 2>&1 不能一起换）');
  assert.ok(!text.includes("awk '/^exec /{"), '自测不能退回「凡 exec 开头一律替换」的旧写法');
  // sshd 的守卫用 $PREFIX 拼密钥路径：不把 PREFIX 重定向到临时目录，自测就会去读生产密钥，
  // 在生产设备上恒命中「有 key」分支，守卫段全部变成看不见的假绿（2026-11-03 实测踩到）
  assert.ok(text.includes('s#^PREFIX=.*#PREFIX='), '自测必须把 PREFIX 重定向到临时目录');
  assert.ok(text.includes('trap') && text.includes('rm -rf "$T"'), '自测缺清理');
});