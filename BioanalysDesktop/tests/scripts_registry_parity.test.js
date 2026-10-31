/**
 * src/<line>/scripts/ 与 src/workflows.json 的一致性守卫。
 *
 * 为什么需要：scripts/ 是母版目录，落到服务器 bin/ 后即可被 /api/tasks/submit 点名执行，
 * 而提交层只校验 step 字符集、不校验是否登记。2026-10-24 曾有 4 个 R 测试案例落在这里，
 * 会被 ops/06_deploy_scripts.ps1 原样推上服务器变成线上可执行步骤，同时 4 个按
 * 「目录下每个文件都是母版」枚举的测试被打破（母版 58 -> 62）。
 *
 * 本文件把「scripts/ 下每个文件都必须登记」钉成机器可判的契约：
 * 新步骤先登记再落盘，测试案例放 cn_debug/。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const LINES = ['line1_bulk', 'line2_scrna', 'line3_spatial'];

/**
 * 允许留在 scripts/ 但不属于分析步骤的件。
 * 只收「确需部署、且不是客户可勾选的分析步骤」的件，逐个写明理由；不批量放行。
 * 与 ops/06_deploy_scripts.ps1 的 $deployExempt 保持同一份口径。
 */
const DEPLOY_EXEMPT = {
  probe_env: '环境自检冒烟脚本：验证 seed 注入、PATH 注入与 manifest 在位（handoff.md 母版口径不含它）',
};

/** scripts/ 下的文件名（README.md 不部署，不是母版） */
function scriptsOf(line) {
  const dir = path.join(REPO, 'src', line, 'scripts');
  return fs.readdirSync(dir).filter((name) => {
    if (name === 'README.md') return false;
    return fs.statSync(path.join(dir, name)).isFile();
  });
}

/** 注册表登记的母版名：<line>/<mod.script || mod.id> */
function registeredScripts() {
  const registry = JSON.parse(
    fs.readFileSync(path.join(REPO, 'src', 'workflows.json'), 'utf8'),
  );
  const out = new Set();
  for (const series of registry.series) {
    for (const stage of series.stages) {
      for (const mod of stage.mods) {
        out.add(`${series.id}/${mod.script || mod.id}`);
      }
    }
  }
  return out;
}

const registered = registeredScripts();

test('scripts/ 下每个文件都必须登记进 workflows.json（或显式豁免）', () => {
  const unregistered = [];
  for (const line of LINES) {
    for (const name of scriptsOf(line)) {
      if (DEPLOY_EXEMPT[name]) continue;
      if (!registered.has(`${line}/${name}`)) unregistered.push(`${line}/${name}`);
    }
  }
  assert.deepEqual(
    unregistered,
    [],
    'scripts/ 是母版目录，未登记的件会被部署成线上可执行步骤。'
      + '正式母版请登记进 src/workflows.json；测试案例请放 cn_debug/',
  );
});

test('注册表登记的母版都必须真实存在于 scripts/', () => {
  const missing = [];
  for (const key of registered) {
    const [line, name] = key.split('/');
    const abs = path.join(REPO, 'src', line, 'scripts', name);
    if (!fs.existsSync(abs)) missing.push(key);
  }
  assert.deepEqual(missing, [], '注册表指向的母版在 scripts/ 下不存在，resolvePlan 会拿到空计划');
});

test('豁免名单只收已知的非步骤件，且与部署脚本口径一致', () => {
  const deployPath = path.join(REPO, 'ops', '06_deploy_scripts.ps1');
  const deployText = fs.readFileSync(deployPath, 'utf8');
  for (const [name, reason] of Object.entries(DEPLOY_EXEMPT)) {
    assert.ok(
      deployText.includes(`'${name}'`),
      `${name} 在测试里豁免但部署脚本没豁免，两处口径分叉`,
    );
    assert.ok(reason.length > 0, `${name} 的豁免理由不能为空`);
  }
});

test('母版总规模与 git 跟踪口径一致（防止静默增删）', () => {
  const total = LINES.reduce((sum, line) => sum + scriptsOf(line).length, 0);
  const exempt = LINES.reduce(
    (sum, line) => sum + scriptsOf(line).filter((n) => DEPLOY_EXEMPT[n]).length,
    0,
  );
  // 注册表 54 + probe_env 1 = 55；数字变了说明有母版进出，需同步登记或更新此处口径
  assert.equal(total - exempt, registered.size, '母版数与注册表登记数不一致');
  assert.equal(total, 55, `母版总数变化: ${total}（含豁免件），需人工核对`);
});
