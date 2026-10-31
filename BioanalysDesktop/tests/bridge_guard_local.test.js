/**
 * 桥接守卫的引擎解析顺序测试（本机优先 / ssh 兜底）。
 *
 * 真机事故（2026-10-21）：母版跑在计算节点 k40-ubuntu 容器内，守卫却去 ssh k40-ubuntu，
 * 容器里不解析该主机名 → exit 255 → 守卫恒打印 [BRIDGE SKIP]，四项断言在真实主路径上
 * 形同空转（与 D1「桥接断言空转」同一类问题，只是从提交层搬到了执行层）。
 * 修法与口径见 con_hf/SPEC_DECISIONS.md D-14 与 con_hf/pitfalls_ledger.md P-15。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const GUARD = path.join(REPO_ROOT, 'src', 'bridge_guard.sh');

function findBash() {
  const candidates = [process.env.BRIDGE_GUARD_BASH, 'D:\\Git\\bin\\bash.exe', 'D:\\Git\\usr\\bin\\bash.exe', 'bash']
    .filter((v) => typeof v === 'string' && v.length > 0);
  for (const cand of candidates) {
    const res = spawnSync(cand, ['-n', GUARD], { encoding: 'utf8' });
    if (!res.error && res.status === 0) return cand;
  }
  return null;
}
const BASH = findBash();
const NEED_BASH = BASH === null ? '宿主无 bash 解释器' : false;

/**
 * Locate a python3 usable inside Git-Bash.
 *
 * Why: the guard local branch needs command -v python3 to hit; on Windows the common
 * shape is Git for Windows installed with Python absent from PATH. Without it the three
 * local-branch cases silently degrade to the ssh branch, testing D-14 as a false green.
 *
 * Probe order: env BRIDGE_GUARD_PYTHON3 -> command -v python3 in Git-Bash ->
 * Codex bundled Python (fallback when the host has no python3 at all).
 * @returns {string|null} path bash can execute, or null
 */
function findPython3() {
  const fromEnv = String(process.env.BRIDGE_GUARD_PYTHON3 || '').trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  if (!BASH) return null;
  const probe = spawnSync(BASH, ['-lc', 'command -v python3'], { encoding: 'utf8' });
  const hit = (probe.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
  if (hit) return hit;
  const bundled = 'C:/Users/18765/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
  return fs.existsSync(bundled) ? bundled : null;
}

const PY3 = findPython3();
/** local branch is testable only when python3 is present; skip with a reason, never invert. */
const NEED_PY3 = PY3 ? false : '宿主日 python3';

/** 造一套工作区：dummy 输入 + 可控的本机引擎 + 会被记录的 ssh 垫片。 */
function makeWorld({ engine }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-local-'));
  const input = path.join(dir, 'matrix.h5ad');
  fs.writeFileSync(input, 'dummy', 'utf8');
  const sshMark = path.join(dir, 'ssh-called.txt');
  const sshPath = path.join(dir, 'ssh');
  const sshBody = [
    '#!/bin/sh',
    'printf "%s\\n" called >> "' + sshMark.replace(/\\/g, '/') + '"',
    'echo "[BRIDGE OK] shim"',
    'exit 0',
    '',
  ].join('\n');
  fs.writeFileSync(sshPath, sshBody, { mode: 0o755 });
  let enginePath = path.join(dir, 'engine.py');
  if (engine) {
    fs.writeFileSync(enginePath, engine, 'utf8');
  } else {
    enginePath = path.join(dir, 'no_such_engine.py');
  }
  // Guard copy: predefine python3 as a bash function so command -v python3 hits.
  // Adding a fresh dir to PATH is unreliable on Windows (extension-less lookups fail and
  // sandbox special paths such as /tmp behave oddly); a function is path-agnostic.
  const guardScript = path.join(dir, 'guard.sh');
  const guardText = fs.readFileSync(GUARD, 'utf8');
  const pyFn = PY3 ? 'python3() { ' + PY3.replace(/\\/g, '/') + ' "$@"; }' + '\n' : '';
  fs.writeFileSync(guardScript, pyFn + guardText, 'utf8');
  return {
    dir, input, sshPath: sshPath.replace(/\\/g, '/'), sshMark,
    enginePath: enginePath.replace(/\\/g, '/'),
    guardScript: guardScript.replace(/\\/g, '/'),
  };
}

function runGuard(world, { localEngine, args = [], extraEnv = {} } = {}) {
  const env = {
    ...process.env,
    BRIDGE_SSH_CMD: world.sshPath,
    BRIDGE_ENGINE_LOCAL: localEngine === undefined ? world.enginePath : localEngine,
    ...extraEnv,
  };
  const res = spawnSync(
    BASH,
    [world.guardScript, '--input', world.input, '--from', 'Python', '--to', 'R', '--script', 'gsva_pathways', ...args],
    { encoding: 'utf8', env }
  );
  const sshCalled = fs.existsSync(world.sshMark);
  return { code: res.status, out: (res.stdout ?? '') + (res.stderr ?? ''), sshCalled };
}

test('本机引擎存在时走 local，完全不调用 ssh', { skip: NEED_BASH || NEED_PY3 }, () => {
  const world = makeWorld({
    engine: 'import sys\nprint("[BRIDGE PASS] all 4 assertions passed")\nprint("[BRIDGE OK] fake local engine")\nsys.exit(0)\n',
  });
  try {
    const res = runGuard(world);
    assert.equal(res.code, 0, res.out);
    assert.equal(res.sshCalled, false, '本机引擎可用时不许再 ssh（容器内 ssh 自己必然失败）');
    assert.match(res.out, /\[BRIDGE OK\]/);
    assert.match(res.out, /engine=local/);
  } finally {
    fs.rmSync(world.dir, { recursive: true, force: true });
  }
});

test('本机引擎缺失时回落到 ssh，并透传 stage 与输入路径', { skip: NEED_BASH }, () => {
  const world = makeWorld({ engine: null });
  try {
    const res = runGuard(world, { args: ['--stage', 'pre-dimred'] });
    assert.equal(res.code, 0, res.out);
    assert.equal(res.sshCalled, true, '本机无引擎时必须走 ssh 兜底; out=' + res.out + ' code=' + res.code);
    assert.match(res.out, /engine=ssh/);
  } finally {
    fs.rmSync(world.dir, { recursive: true, force: true });
  }
});

test('本机引擎判失败时守卫必须中止母版（exit 非 0 + BRIDGE FAIL）', { skip: NEED_BASH || NEED_PY3 }, () => {
  const world = makeWorld({
    engine: 'import sys\nsys.stderr.write("[BRIDGE FAIL] obsm missing\\n")\nsys.exit(1)\n',
  });
  try {
    const res = runGuard(world);
    assert.notEqual(res.code, 0, '断言失败不许放行');
    assert.match(res.out, /\[BRIDGE FAIL\]/);
    assert.equal(res.sshCalled, false);
  } finally {
    fs.rmSync(world.dir, { recursive: true, force: true });
  }
});

test('本机引擎崩溃（无 BRIDGE FAIL 结论）必须判 FAIL，不许降级成 SKIP', { skip: NEED_BASH || NEED_PY3 }, () => {
  // 真机事故（2026-10-21，/tmp/bad.h5ad）：损坏的 h5ad 让 anndata 抛 OSError 并冒出
  // traceback，早期版本把它归到"引擎不可达"→ SKIP → exit 0，坏输入被静默放行。
  // 本机引擎是否存在在解析阶段已经确认过，非 0 只能是校验失败，一律 FAIL（契约 3c）。
  const world = makeWorld({
    engine: 'import sys\nprint("Traceback (most recent call last):")\nsys.exit(3)\n',
  });
  try {
    const res = runGuard(world);
    assert.notEqual(res.code, 0, '引擎异常退出时不许放行母版');
    assert.match(res.out, /\[BRIDGE FAIL\]/);
    assert.match(res.out, /local 模式退出码 3/);
    assert.equal(res.sshCalled, false);
  } finally {
    fs.rmSync(world.dir, { recursive: true, force: true });
  }
});

test('ssh 分支的不可达（退出码 255）→ 默认 SKIP exit 0（K40 离线母版仍可跑）', { skip: NEED_BASH || NEED_PY3 }, () => {
  const world = makeWorld({ engine: null });
  try {
    fs.writeFileSync(world.sshPath, '#!/bin/sh\necho "ssh: Could not resolve hostname k40-ubuntu" >&2\nexit 255\n', { mode: 0o755 });
    const res = runGuard(world);
    assert.equal(res.code, 0, 'K40 离线不该阻断母版; out=' + res.out);
    assert.match(res.out, /\[BRIDGE SKIP\]/);
  } finally {
    fs.rmSync(world.dir, { recursive: true, force: true });
  }
});
test('ssh 分支不可达 + BIO_STRICT_BRIDGE=1 → 硬阻断 exit 2', { skip: NEED_BASH || NEED_PY3 }, () => {
  const world = makeWorld({ engine: null });
  try {
    fs.writeFileSync(world.sshPath, '#!/bin/sh\nexit 255\n', { mode: 0o755 });
    const res = runGuard(world, { extraEnv: { BIO_STRICT_BRIDGE: '1' } });
    assert.equal(res.code, 2, 'strict 模式 ssh 离线也硬阻断; out=' + res.out);
    assert.match(res.out, /\[BRIDGE FAIL\]/);
  } finally {
    fs.rmSync(world.dir, { recursive: true, force: true });
  }
});
test('BRIDGE_ENGINE_LOCAL 显式置空可强制走 ssh 分支', { skip: NEED_BASH }, () => {
  const world = makeWorld({
    engine: 'import sys\nprint("[BRIDGE OK] should not run")\nsys.exit(0)\n',
  });
  try {
    const res = runGuard(world, { localEngine: '' });
    assert.equal(res.code, 0, res.out);
    assert.equal(res.sshCalled, true, '置空后必须走 ssh; out=' + res.out + ' code=' + res.code);
    assert.doesNotMatch(res.out, /should not run/);
  } finally {
    fs.rmSync(world.dir, { recursive: true, force: true });
  }
});

test('守卫源码保留本机优先解析块与契约 3b 说明', () => {
  const text = fs.readFileSync(GUARD, 'utf8');
  assert.ok(text.includes('BRIDGE_ENGINE_LOCAL'), '缺本机引擎变量');
  assert.ok(text.includes('MODE="local"'), '缺 local 分支判定');
  assert.ok(text.includes('3b.'), '缺契约 3b 的成文说明（改回去必须有人看见）');
  assert.ok(text.includes('3c.'), '缺契约 3c（本机引擎非 0 即 FAIL）的成文说明');
  assert.match(text, /python3 "\$BRIDGE_ENGINE_LOCAL"[^\n]*--stage/);
});
