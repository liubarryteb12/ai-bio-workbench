import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SSHD = path.join(REPO, 'ops', 'k40', 'sv', 'sshd', 'run');
const UBU = path.join(REPO, 'ops', 'k40', 'sv', 'ubuntu-sshd', 'run');
const SELFTEST = path.join(REPO, 'ops', 'k40', 'hostkey_guard_selftest.sh');

// ── runit host key 守卫的静态契约（2026-11-03，4 Argon 第十八轮）──
//
// 故障形态（实测）：host key 文件缺失时 sshd 打印 "no hostkeys available"、dropbear 打印
// "No hostkeys available" 后立即退出（exit 1），runit 反复重启，8022 / 10022 永不监听，
// 服务状态显示 run 但连不上。守卫必须在「缺 key 时生成」，且只在缺 key 时生成。
//
// 另一个实测事实决定写法：本机 runit 的 log/run 只接 fd1（exec cat >>），run 脚本写到
// stderr 的诊断会丢。所以守卫的诊断一律走 stdout，任何一处 >&2 都会让故障看不见。

const read = (p) => fs.readFileSync(p, 'utf8');
const idx = (text, needle) => {
  const i = text.indexOf(needle);
  assert.ok(i >= 0, '缺片段：' + needle);
  return i;
};

test('sshd/run 只在 host key 缺失时生成，且生成后仍 exec sshd', () => {
  assert.ok(fs.existsSync(SSHD), 'ops/k40/sv/sshd/run 缺失');
  const text = read(SSHD);
  const keyDecl = idx(text, 'HOST_KEY=/data/data/com.termux/files/usr/etc/ssh/ssh_host_ed25519_key');
  const guard = idx(text, 'if [ ! -f "$HOST_KEY" ]; then');
  // 钉整行命令：只认 echo 文案里的 ssh-keygen -A 会让「命令被换成 true」蒙混过关（变异 M5 实证）
  const gen = idx(text, '/data/data/com.termux/files/usr/bin/ssh-keygen -A 2>&1');
  const post = idx(text, '[ -f "$HOST_KEY" ] || echo "[sshd] ssh-keygen -A failed');
  const exec = idx(text, 'exec sshd -D -e 2>&1');
  assert.ok(keyDecl < guard, 'HOST_KEY 必须在守卫之前定义');
  assert.ok(guard < gen, 'ssh-keygen -A 必须在「缺 key」分支内');
  assert.ok(gen < post, '生成后必须复查，否则失败会被静默');
  assert.ok(post < exec, '守卫必须在 exec sshd 之前');
  assert.ok(text.trimEnd().endsWith('exec sshd -D -e 2>&1'), 'run 脚本末行必须是 exec sshd');
});

test('ubuntu-sshd/run 用宿主侧 rootfs 路径判断，再进容器 dropbearkey 生成', () => {
  assert.ok(fs.existsSync(UBU), 'ops/k40/sv/ubuntu-sshd/run 缺失');
  const text = read(UBU);
  const rootfs = idx(text, 'ROOTFS="$PREFIX/var/lib/proot-distro/containers/ubuntu/rootfs"');
  const keyDecl = idx(text, 'HOST_KEY="$ROOTFS/etc/dropbear/dropbear_ed25519_host_key"');
  const guard = idx(text, 'if [ ! -f "$HOST_KEY" ]; then');
  // 钉整行命令，理由同上
  const gen = idx(text, '/usr/bin/dropbearkey -t ed25519 -f /etc/dropbear/dropbear_ed25519_host_key 2>&1');
  const post = idx(text, '[ -f "$HOST_KEY" ] || echo "[ubuntu-sshd] dropbearkey failed');
  const exec = idx(text, 'exec "$PREFIX/bin/proot-distro" login ubuntu --');
  assert.ok(rootfs < keyDecl, 'ROOTFS 必须先定义');
  assert.ok(keyDecl < guard, 'HOST_KEY 必须在守卫之前定义');
  assert.ok(guard < gen, 'dropbearkey 必须在「缺 key」分支内');
  assert.ok(gen < post, '生成后必须复查');
  assert.ok(post < exec, '守卫必须在 exec proot-distro 之前');
  assert.ok(!text.includes('installed-rootfs'), 'proot 容器根路径写错：installed-rootfs 在本机不存在');
  assert.ok(text.includes('-r /etc/dropbear/dropbear_ed25519_host_key -s 2>&1'), '-r 路径与生成路径必须一致');
});

test('两个 run 脚本的诊断只走 stdout（runit log/run 只收 fd1）', () => {
  for (const f of [SSHD, UBU]) {
    const lines = read(f).split('\n').filter((l) => !l.trim().startsWith('#'));
    const bad = lines.filter((l) => l.includes('>&2'));
    assert.deepEqual(bad, [], path.basename(path.dirname(f)) + '/run 有 stderr 重定向，日志里会看不到：' + bad.join(' | '));
  }
});

test('守卫自测脚本覆盖三条分支并带哨兵', () => {
  assert.ok(fs.existsSync(SELFTEST), 'ops/k40/hostkey_guard_selftest.sh 缺失');
  const text = read(SELFTEST);
  assert.ok(text.includes('SELFTEST_PASS'), '缺成功哨兵');
  assert.ok(text.includes('SELFTEST_FAIL'), '缺失败哨兵');
  assert.ok(text.includes('MODE=fail'), '缺「生成失败」分支');
  assert.ok(text.includes('check_absent'), '缺「有 key 不生成」断言');
  assert.ok(text.includes('proot-distro'), '缺容器侧 shim');
  assert.ok(text.includes('mktemp -d'), '自测未用临时目录，会碰到生产密钥');
  assert.ok(text.includes('trap') && text.includes('rm -rf "$T"'), '自测缺清理');
});
