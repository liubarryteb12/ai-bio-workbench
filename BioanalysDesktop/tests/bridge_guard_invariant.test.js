/**
 * bridge_guard 不变量测试（task-10 / m00939 边界②）
 *
 * 解决的真实问题：桥接四项断言此前只在工作台提交层执行一次，分析母版内部
 * 0 调用。本测试用仓库事实把不变量钉住：
 *   1. 凡按 task.js 口径判定为 bilingual 的母版，必须调用 src/bridge_guard.sh；
 *   2. 该调用必须出现在第一次 Rscript 之前（断言先于跨语言数据交接）；
 *   3. bridge_guard.sh 自身语法正确（bash -n）；
 *   4. 三种退出路径：引擎 0 → 0、引擎非 0 → 同码、引擎不可达 → 0 且含 BRIDGE SKIP。
 *
 * 判定正则与 BioanalysDesktop/server/task.js 同源（此处独立维护，避免测试反向依赖被测系统）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const GUARD = path.join(SRC_ROOT, 'bridge_guard.sh');

const RSCRIPT_CALL_RE = /(^|[\s;&|"])Rscript(?=[\s"']|$)/;
const PYTHON_CALL_RE = /(^|[\s;&])python3?(?=[\s"']|$)/;
const GUARD_CALL_RE = /bridge_guard\.sh/;

function listMasters() {
  const out = [];
  for (const line of fs.readdirSync(SRC_ROOT, { withFileTypes: true })) {
    if (!line.isDirectory()) continue;
    const scriptsDir = path.join(SRC_ROOT, line.name, 'scripts');
    if (!fs.existsSync(scriptsDir)) continue;
    for (const f of fs.readdirSync(scriptsDir)) {
      const abs = path.join(scriptsDir, f);
      if (fs.statSync(abs).isFile()) out.push({ lineId: line.name, step: f, abs });
    }
  }
  out.sort((a, b) => a.abs.localeCompare(b.abs));
  return out;
}

function countsOf(content) {
  const lines = content.split(/\r?\n/);
  return {
    rCount: lines.filter((l) => RSCRIPT_CALL_RE.test(l)).length,
    pCount: lines.filter((l) => PYTHON_CALL_RE.test(l)).length,
  };
}

function firstIndexOf(content, re) {
  const idx = content.split(/\r?\n/).findIndex((l) => re.test(l));
  return idx;
}

const masters = listMasters();
const bilingual = masters
  .map((m) => ({ ...m, ...countsOf(fs.readFileSync(m.abs, 'utf8')) }))
  .filter((m) => m.rCount >= 1 && m.pCount >= 1);

test('母版全集可枚举且规模稳定（>=50）', () => {
  assert.ok(masters.length >= 50, `母版数量异常: ${masters.length}`);
});

test('bilingual 母版必须调用 bridge_guard.sh', () => {
  assert.ok(bilingual.length >= 1, '仓库里应当至少有一个真跨语言母版');
  for (const m of bilingual) {
    const content = fs.readFileSync(m.abs, 'utf8');
    assert.ok(
      GUARD_CALL_RE.test(content),
      `${m.lineId}/${m.step} 是 bilingual（Rscript ${m.rCount} 处、python ${m.pCount} 处）但未调用 bridge_guard.sh`,
    );
  }
});

test('bridge_guard 调用必须早于第一次 Rscript', () => {
  for (const m of bilingual) {
    const content = fs.readFileSync(m.abs, 'utf8');
    const guardIdx = firstIndexOf(content, GUARD_CALL_RE);
    const rIdx = firstIndexOf(content, RSCRIPT_CALL_RE);
    assert.ok(guardIdx >= 0 && rIdx >= 0, `${m.step}: 缺少守卫调用或 Rscript 调用`);
    assert.ok(guardIdx < rIdx, `${m.step}: 守卫在第 ${guardIdx + 1} 行，第一个 Rscript 在第 ${rIdx + 1} 行，断言晚于数据交接`);
  }
});

test('非 bilingual 母版不强制守卫（R-only / Python-only 放行）', () => {
  const single = masters
    .map((m) => ({ ...m, ...countsOf(fs.readFileSync(m.abs, 'utf8')) }))
    .filter((m) => !(m.rCount >= 1 && m.pCount >= 1));
  assert.ok(single.length >= 40, `单语言母版数量异常: ${single.length}`);
});

/**
 * 定位 bash 解释器：Git for Windows 自带 D:\Git\bin\bash.exe，WSL 无发行版时它就是唯一宿主。
 * 找不到 bash 的环境（裸 Windows CI）下相关用例显式 skip，不假 PASS。
 */
function findBash() {
  const fromEnv = process.env.BRIDGE_GUARD_BASH;
  const candidates = [fromEnv, 'D:\\Git\\bin\\bash.exe', 'D:\\Git\\usr\\bin\\bash.exe', 'bash']
    .filter((v) => typeof v === 'string' && v.length > 0);
  for (const cand of candidates) {
    const res = spawnSync(cand, ['-n', GUARD], { encoding: 'utf8' });
    if (!res.error && res.status === 0) return cand;
  }
  return null;
}

const BASH = findBash();

/**
 * 用 BRIDGE_SSH_CMD 把 ssh 客户端指向垫片脚本，完全隔离真实 ssh。
 * 走 env 覆盖而不是改 PATH：git-bash 启动时用 /etc/profile 重置 PATH，
 * PATH 前缀注入在 Windows 宿主上不可靠（实测 /usr/bin/ssh 仍胜出）。
 */
function runGuard(env, args) {
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-shim-'));
  const sshPath = path.join(shimDir, 'ssh');
  fs.writeFileSync(sshPath, env.sshScript, { mode: 0o755 });
  const msysPath = sshPath.replace(/\\/g, '/');
  const childEnv = { ...process.env, BRIDGE_SSH_CMD: msysPath, ...env.extra };
  const res = spawnSync(BASH, [GUARD, ...args], { encoding: 'utf8', env: childEnv });
  fs.rmSync(shimDir, { recursive: true, force: true });
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

test('bridge_guard.sh 语法正确（bash -n）', { skip: BASH === null ? '宿主无 bash 解释器' : false }, () => {
  const res = spawnSync(BASH, ['-n', GUARD], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr || 'bash -n 未通过');
});

test('引擎返回 0 → 守卫 0 且含 BRIDGE OK', { skip: BASH === null ? '宿主无 bash 解释器' : false }, () => {
  const res = runGuard({ sshScript: '#!/bin/sh\necho "[BRIDGE OK] assert1 ok"\nexit 0\n' }, ['--input', 'x.h5ad', '--from', 'Python', '--to', 'R', '--script', 'gsva_pathways']);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /BRIDGE OK/);
});

test('引擎断言失败（3）→ 守卫透传同码且含 BRIDGE FAIL', { skip: BASH === null ? '宿主无 bash 解释器' : false }, () => {
  const res = runGuard({ sshScript: '#!/bin/sh\necho "[BRIDGE FAIL] assert2 mismatch"\nexit 3\n' }, ['--input', 'x.h5ad', '--from', 'Python', '--to', 'R', '--script', 'gsva_pathways']);
  assert.equal(res.code, 3, `expected 3 got ${res.code}`);
  assert.match(res.stdout, /BRIDGE FAIL/);
});

test('ssh 不可达 → 守卫 0 且含 BRIDGE SKIP（K40 离线母版仍可跑）', { skip: BASH === null ? '宿主无 bash 解释器' : false }, () => {
  const res = runGuard({ sshScript: '#!/bin/sh\nexit 255\n' }, ['--input', 'x.h5ad', '--from', 'Python', '--to', 'R', '--script', 'gsva_pathways']);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /BRIDGE SKIP/);
});

test('输入非 h5ad/rds → 守卫 0 且 SKIP（不编造可校验对象）', { skip: BASH === null ? '宿主无 bash 解释器' : false }, () => {
  const res = runGuard({ sshScript: '#!/bin/sh\necho "[BRIDGE OK]"\nexit 0\n' }, ['--input', 'x.tsv', '--from', 'Python', '--to', 'R', '--script', 'gsva_pathways']);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /BRIDGE SKIP/);
});
