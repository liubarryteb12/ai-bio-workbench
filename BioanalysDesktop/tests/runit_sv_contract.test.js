import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SV = path.join(REPO, 'tools', 'ops', 'k40', 'sv');
const SERVICES = ['sshd', 'ubuntu-sshd', 'crond', 'ssh-agent', 'pi-a2a'];
const SHEBANG = '#!/data/data/com.termux/files/usr/bin/sh';

// ── runit run 脚本的四段式契约（2026-11-03，4 Argon 第十九轮 Q4）──
//
// 为什么必须钉段2：本机实测（hktest 探针）runsv 只把 ./run 的 fd1 接到 ./log/run 的
// stdin，log/run 就是 exec cat >> logfile。不做 exec 2>&1，脚本里写 stderr 的内容
// 都进不了日志：守卫自己的告警会消失，daemon 的原生崩溃栈与认证失败也一并消失。
// 上一版只有 sshd / ubuntu-sshd 的守卫被迫手写 stdout，crond 与 ssh-agent 完全裸奔。
//
// 段定义：
//   段1 shebang + set -eu
//   段2 exec 2>&1（紧跟段1，处于前 10 行内）
//   段3 幂等守卫（诊断走 stdout，前缀 [guard:<svc>]，失败打 ERR_STAGE_* 并 exit 1）
//   段4 末行 exec <daemon>（原位替换，让 runsv 直接监督）

const runPath = (svc) => path.join(SV, svc, 'run');
const read = (p) => fs.readFileSync(p, 'utf8');
// 先把「反斜杠续行」折成单行，再剔空行与注释行，否则 ubuntu-sshd 的段4 会因为续行
// 被拆开而看起来「末行不是 exec」。
const codeLines = (text) =>
  text
    .replace(/\\\n/g, ' ')
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
const indexOf = (text, needle) => {
  const i = text.indexOf(needle);
  assert.ok(i >= 0, '缺片段：' + needle);
  return i;
};

test('四个 sv 目录都有 run 与 log/run，run 可执行', () => {
  for (const svc of SERVICES) {
    const run = runPath(svc);
    assert.ok(fs.existsSync(run), svc + '/run 缺失');
    assert.ok(fs.existsSync(path.join(SV, svc, 'log', 'run')), svc + '/log/run 缺失');
    // 权限位不在 Windows 工作区断言：NTFS 不保存 exec 位（检出后恒为 644），
    // 755 由 K40 部署侧与 git index 保证，见 docs/k40_hostkey_guard.md。
  }
});

test('四个 run 脚本都符合段1/段2：shebang + set -eu + exec 2>&1 在前三行', () => {
  for (const svc of SERVICES) {
    const text = read(runPath(svc));
    const lines = text.split('\n');
    assert.equal(lines[0], SHEBANG, svc + '/run 首行必须是 Termux sh 的 shebang');
    assert.equal(lines[1].trim(), 'set -eu', svc + '/run 第 2 行必须是 set -eu');
    assert.equal(lines[2].trim(), 'exec 2>&1', svc + '/run 第 3 行必须是 exec 2>&1');
    const firstTen = lines.slice(0, 10).map((l) => l.trim());
    assert.ok(firstTen.includes('exec 2>&1'), svc + '/run 的 exec 2>&1 必须在前 10 行内');
  }
});

test('四个 run 脚本的非注释代码里没有任何 >&2（诊断一律走 stdout）', () => {
  for (const svc of SERVICES) {
    const bad = codeLines(read(runPath(svc))).filter((l) => l.includes('>&2'));
    assert.deepEqual(bad, [], svc + '/run 出现 stderr 重定向，日志会丢：' + bad.join(' | '));
  }
});

test('四个 run 脚本末行都是段4 的原位替换', () => {
  for (const svc of SERVICES) {
    const codes = codeLines(read(runPath(svc)));
    const last = codes[codes.length - 1].trim();
    assert.notEqual(last, 'exec 2>&1', svc + '/run 的末行不能是段2 的重定向');
    if (svc === 'ssh-agent') {
      // ssh-agent 的段4 经函数委托：service_agent 内部 exec ssh-agent，末行是函数调用。
      // 这是唯一允许的例外形态，函数体内必须真有 exec（见上一条用例）。
      assert.equal(last, 'service_agent "${SSH_AUTH_SOCK}"', 'ssh-agent 末行必须是 service_agent 调用');
      continue;
    }
    assert.ok(last.startsWith('exec '), svc + '/run 末行必须是 exec <daemon>，实得：' + last);
  }
});

test('crond 与 ssh-agent 的段4 命令正确（模板改造不得改动原语义）', () => {
  const crond = read(runPath('crond'));
  assert.ok(crond.trimEnd().endsWith('exec crond -n -s'), 'crond 段4 必须是前台模式 exec crond -n -s');
  const agent = read(runPath('ssh-agent'));
  assert.ok(agent.includes('exec ssh-agent -D -a "$1"'), 'ssh-agent 段4 必须保留 -D -a "$1"');
  assert.ok(agent.includes('if [ -S "$1" ]; then'), 'ssh-agent 段3 必须保留残留 socket 清理');
  // set -u 下 ${XDG_RUNTIME_DIR:-${TERMUX__PREFIX:-${PREFIX}}} 会在 PREFIX 未导出时炸掉，
  // 所以脚本必须先给 PREFIX 兜底默认值
  const fallback = 'PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"';
  assert.ok(agent.includes(fallback), 'ssh-agent 缺 PREFIX 兜底');
  assert.ok(indexOf(agent, fallback) < indexOf(agent, 'service_agent "${SSH_AUTH_SOCK}"'), 'PREFIX 兜底必须在调用 service_agent 之前');
});

test('sshd 段3 守卫：缺 key 生成、失败打 ERR_STAGE_HOSTKEY_8022 并 exit 1', () => {
  const text = read(runPath('sshd'));
  const keyDecl = indexOf(text, 'HOST_KEY="$PREFIX/etc/ssh/ssh_host_ed25519_key"');
  const guard = indexOf(text, 'if [ ! -f "$HOST_KEY" ]; then');
  const gen = indexOf(text, 'if ! "$PREFIX/bin/ssh-keygen" -A; then');
  const code = indexOf(text, 'ERR_STAGE_HOSTKEY_8022');
  const exec = indexOf(text, 'exec sshd -D -e');
  assert.ok(keyDecl < guard, 'HOST_KEY 必须先定义');
  assert.ok(guard < gen, 'ssh-keygen -A 必须在「缺 key」分支内');
  assert.ok(gen < code, '生成失败的错误码必须在生成调用之后');
  assert.ok(code < exec, '守卫必须在段4 之前');
  assert.ok(text.includes('[guard:sshd] host key missing -> ssh-keygen -A'), '缺 key 告警应带 [guard:sshd] 前缀');
  assert.ok(text.includes('exit 1'), '生成失败必须 exit 1，不能静默继续');
});

test('ubuntu-sshd 段3 守卫：宿主侧判 rootfs，进容器 dropbearkey，失败打 10022 层代号', () => {
  const text = read(runPath('ubuntu-sshd'));
  const rootfs = indexOf(text, 'ROOTFS="$PREFIX/var/lib/proot-distro/containers/ubuntu/rootfs"');
  const keyDecl = indexOf(text, 'HOST_KEY="$ROOTFS/etc/dropbear/dropbear_ed25519_host_key"');
  const guard = indexOf(text, 'if [ ! -f "$HOST_KEY" ]; then');
  const gen = indexOf(text, '/usr/bin/dropbearkey -t ed25519 -f /etc/dropbear/dropbear_ed25519_host_key');
  const code = indexOf(text, 'ERR_STAGE_HOSTKEY_10022');
  const exec = indexOf(text, 'exec "$PREFIX/bin/proot-distro" login ubuntu --');
  assert.ok(rootfs < keyDecl, 'ROOTFS 必须先定义');
  assert.ok(keyDecl < guard, 'HOST_KEY 必须先定义');
  assert.ok(guard < gen, 'dropbearkey 必须在「缺 key」分支内');
  assert.ok(gen < code, '错误码必须在生成调用之后');
  assert.ok(code < exec, '守卫必须在段4 之前');
  assert.ok(!text.includes('installed-rootfs'), 'proot 容器根路径写错：installed-rootfs 在本机不存在');
  assert.ok(text.includes('-r /etc/dropbear/dropbear_ed25519_host_key -s'), '段4 的 -r 路径必须与生成路径一致');
});

test('段3 守卫的 grep 友好性：错误码是独立可检索的单一词', () => {
  // 事故现场只靠 ssh 手敲 grep 定位故障层，错误码必须能直接 grep 到，且必须走 echo（stdout）
  for (const [svc, code] of [['sshd', 'ERR_STAGE_HOSTKEY_8022'], ['ubuntu-sshd', 'ERR_STAGE_HOSTKEY_10022']]) {
    const hits = codeLines(read(runPath(svc))).filter((l) => l.includes(code));
    assert.ok(hits.length >= 1, svc + ' 缺故障层代号 ' + code);
    for (const line of hits) {
      assert.ok(/echo "/.test(line), svc + ' 的错误码必须通过 echo 打到 stdout：' + line);
    }
  }
});