// 工作区卫生：仓库根不许出现字面 %SystemDrive% 这类变量未展开目录，
// 也不许把一次性探针脚本散落在包根。
//
// 背景（2026-11 全量审查外部评审点名）：仓库根曾出现一个字面名为 %SystemDrive% 的目录链，
// 是 Windows 变量在未被 shell 展开时当路径用的产物；BioanalysDesktop 根下散落 8 个
// .tmp_probe_*.mjs，是上一轮 Playwright 冒烟留下的。两者都不被 .gitignore 之外的东西挡住，
// 会被便携包打包脚本顺手带走。已清理并归档到 tools/dev/diagnostics/，这里加机器检查防复发。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('仓库根不得出现字面 %变量% 形态的残留目录', () => {
  const entries = fs.readdirSync(REPO_ROOT, { withFileTypes: true });
  // Windows 的 %NAME% 与 POSIX 的 $NAME 未展开形态；只查目录，且只看仓库根一层。
  const strays = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => /^%[A-Za-z_][A-Za-z0-9_]*%$/.test(name) || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(name));
  assert.deepEqual(strays, [], `仓库根出现未展开的变量目录: ${strays.join(', ')}`);
});

test('一次性探针脚本统一放在 tools/dev/diagnostics，不许散落在包根', () => {
  const pkgRoot = path.join(REPO_ROOT, 'BioanalysDesktop');
  const strays = fs.readdirSync(pkgRoot).filter((name) => name.startsWith('.tmp_probe_'));
  assert.deepEqual(strays, [], `BioanalysDesktop 根下仍有探针脚本: ${strays.join(', ')}`);
  const diagDir = path.join(REPO_ROOT, 'tools', 'dev', 'diagnostics');
  assert.ok(fs.existsSync(diagDir), 'tools/dev/diagnostics 必须存在（探针归档点）');
});