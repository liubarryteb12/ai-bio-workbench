#!/usr/bin/env node
/**
 * 便携包关键资产同源门禁（第三十五轮 4 Argon Q4 条件同意）。
 *
 * 实测背景：dist/portable/BioanalysWorkbench 是第 28 轮生成的陈旧快照，
 * 历经 29~35 轮修复后已与主仓分叉（figure_adapters.js 主仓 fe7e7b4f 对 dist 0b9b68d8，
 * 且 dist 里仍残留 13 处 #D55E00 旧暗橙色）。这类陈旧脏包一旦分发，用户拿到的
 * 出图配色与注册表都不是修复后的版本。
 *
 * 按裁定：
 *   - dist/ 存在 → 强制逐一比对关键资产 SHA256，分叉即报红并提示刷新包；
 *   - dist/ 不存在（CI 干净 Runner、刚 clone）→ 显式标 SKIP_NO_DIST 并 exit 0，
 *     不误报。存在性守卫是硬要求。
 *
 * 用法：
 *   node ops/dist_parity_gate.mjs           # 检查
 *   node ops/dist_parity_gate.mjs --json    # 机器可读
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_ROOT = path.join(REPO, 'dist', 'portable', 'BioanalysWorkbench');

/**
 * 关键资产清单。每条都是「主仓改了而便携包没重跑就会危害用户」的文件：
 * 出图适配器、图件注册表、需求单 schema、矩阵证据、项目元数据读取入口。
 * 冻结，新增需要人裁定。
 */
export const PARITY_ASSETS = Object.freeze([
  'BioanalysDesktop/server/figure_adapters.js',
  'src/figure_templates.json',
  'shared/requirement_schema.json',
  'reference/05.可参考出图代码/_meta/script_plot_matrix.json',
  'BioanalysDesktop/server/project.js',
]);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function checkDistParity(distRoot = DIST_ROOT, repoRoot = REPO) {
  if (!fs.existsSync(distRoot)) {
    return { skipped: true, reason: 'SKIP_NO_DIST', assets: [], diverged: [], missingInDist: [] };
  }
  const assets = [];
  const diverged = [];
  const missingInDist = [];
  for (const rel of PARITY_ASSETS) {
    const repoFile = path.join(repoRoot, rel);
    const distFile = path.join(distRoot, rel);
    const repoExists = fs.existsSync(repoFile);
    const distExists = fs.existsSync(distFile);
    const repoSha = repoExists ? sha256(repoFile) : null;
    const distSha = distExists ? sha256(distFile) : null;
    assets.push({ rel, repoSha, distSha, present: repoExists && distExists });
    if (!repoExists) continue; // 主仓已删的资产不要求 dist 保留
    if (!distExists) missingInDist.push(rel);
    else if (repoSha !== distSha) diverged.push({ rel, repoSha: repoSha.slice(0, 8), distSha: distSha.slice(0, 8) });
  }
  return { skipped: false, assets, diverged, missingInDist };
}

function main() {
  const asJson = process.argv.includes('--json');
  const r = checkDistParity();
  const ok = r.skipped || (r.diverged.length === 0 && r.missingInDist.length === 0);
  if (asJson) {
    console.log(JSON.stringify({ ok, ...r }, null, 2));
    return ok ? 0 : 1;
  }
  if (r.skipped) {
    console.log(`[dist_parity] dist not built, clean state OK (${r.reason})`);
    return 0;
  }
  console.log(`[dist_parity] 比对 ${r.assets.length} 个关键资产：分叉 ${r.diverged.length} / 缺失 ${r.missingInDist.length}`);
  for (const d of r.diverged) {
    console.log(`  [FAIL] ${d.rel}  repo=${d.repoSha} dist=${d.distSha}`);
  }
  for (const f of r.missingInDist) {
    console.log(`  [FAIL] ${f}  主仓有、便携包缺`);
  }
  if (!ok) {
    console.log('  修复：node ops/build_portable_package.mjs 重建便携包（或删掉 dist/ 让本门禁 SKIP）');
  }
  console.log(ok ? '[dist_parity] 关键资产与主仓逐字节一致' : '[dist_parity] 失败');
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}