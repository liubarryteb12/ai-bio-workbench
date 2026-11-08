// 便携包同源门禁契约测试（第三十五轮 4 Argon Q4 条件同意）。
// 判据用纯函数 checkDistParity(distRoot, repoRoot) 做正反与存在性守卫断言，不依赖真实 dist。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkDistParity, PARITY_ASSETS } from '../../tools/dev/dist_parity_gate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('资产清单冻结且每条都是主仓真实存在的路径', () => {
  assert.equal(Object.isFrozen(PARITY_ASSETS), true);
  assert.ok(PARITY_ASSETS.length >= 5, '至少覆盖出图适配器/注册表/schema/矩阵/项目入口');
  for (const rel of PARITY_ASSETS) {
    assert.ok(fs.existsSync(path.join(REPO, rel)), '清单里出现主仓不存在的文件: ' + rel);
  }
});

test('存在性守卫：dist 不存在时 SKIP_NO_DIST 放行，不误报', () => {
  const r = checkDistParity(path.join(REPO, '.tmp', 'definitely_missing_dist_' + Date.now()), REPO);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'SKIP_NO_DIST');
  assert.deepEqual(r.diverged, []);
});

test('逐字节一致时判绿', () => {
  const tmp = fs.mkdtempSync(path.join(REPO, '.tmp', 'dist_parity_same_'));
  try {
    for (const rel of PARITY_ASSETS) {
      const dst = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(REPO, rel), dst);
    }
    const r = checkDistParity(tmp, REPO);
    assert.equal(r.skipped, false);
    assert.deepEqual(r.diverged, []);
    assert.deepEqual(r.missingInDist, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('分叉 1 字节即判红，并点名文件', () => {
  const tmp = fs.mkdtempSync(path.join(REPO, '.tmp', 'dist_parity_diff_'));
  try {
    for (const rel of PARITY_ASSETS) {
      const dst = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(REPO, rel), dst);
    }
    const victim = PARITY_ASSETS[0];
    const bad = Buffer.from(fs.readFileSync(path.join(tmp, victim)));
    bad[0] ^= 0xFF;
    fs.writeFileSync(path.join(tmp, victim), bad);
    const r = checkDistParity(tmp, REPO);
    assert.deepEqual(r.diverged.map((d) => d.rel), [victim]);
    assert.equal(r.diverged[0].distSha === r.diverged[0].repoSha, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('主仓有而便携包缺 -> missingInDist 报红', () => {
  const tmp = fs.mkdtempSync(path.join(REPO, '.tmp', 'dist_parity_missing_'));
  try {
    // 只放第一个，其余缺失
    const first = PARITY_ASSETS[0];
    const dst = path.join(tmp, first);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(REPO, first), dst);
    const r = checkDistParity(tmp, REPO);
    assert.ok(r.missingInDist.length >= 1, '缺的资产必须被点名');
    assert.ok(r.missingInDist.includes(PARITY_ASSETS[1]));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('真实 dist 若存在必须全部一致（CI 无盘时由存在性守卫放行）', () => {
  const r = checkDistParity();
  if (r.skipped) { assert.equal(r.reason, 'SKIP_NO_DIST'); return; }
  assert.deepEqual(r.diverged, [], '真实便携包关键资产分叉: ' + JSON.stringify(r.diverged));
  assert.deepEqual(r.missingInDist, [], '真实便携包缺关键资产: ' + r.missingInDist.join(', '));
});

test('CLI 信号：当前真实 dist 存在时 exit 0 且打印逐字节一致', () => {
  const r = spawnSync(process.execPath, ['tools/dev/dist_parity_gate.mjs'], { cwd: REPO, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  assert.match(r.stdout, /逐字节一致|SKIP_NO_DIST|dist not built/);
});