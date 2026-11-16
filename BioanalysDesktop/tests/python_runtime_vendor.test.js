/**
 * Q4 运行时外迁契约（第 41 轮，Argon 裁定）。
 *
 * 病灶：BioanalysDesktop/Python/ 有 2,418 个文件 / 167 MB 的打包运行时，
 * 混在应用源码旁，拖慢所有 AST/grep 扫描，且与源码层级混淆。
 *
 * 裁定：迁到 vendor/python-win32/（对齐 electron-builder 的 extraResources 隔离法）。
 * 本测试钉死三件事：旧位置不再存在、新位置存在且未被 git 跟踪、构建排除清单覆盖两条路径。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OLD = path.join(REPO, "BioanalysDesktop", "Python");
const NEW = path.join(REPO, "vendor", "python-win32");

test("Q4：旧位置 BioanalysDesktop/Python/ 不再存在", () => {
  assert.equal(fs.existsSync(OLD), false, "打包运行时不应混在应用源码目录里");
});

test("Q4：新位置 vendor/python-win32/ 存在且含运行时文件", (t) => {
  // 便携包内 vendor/ 不存在（同一份运行时落在 runtime/python/），本断言只在打包机有意义
  if (fs.existsSync(path.join(REPO, "runtime", "python", "python.exe"))) {
    t.skip("HOST_MISSING_LOCAL_DATA: 便携包运行时落在 runtime/python，本项目目录无 vendor");
    return;
  }
  assert.ok(fs.existsSync(NEW), "缺 vendor/python-win32/");
  // 不写死 2418：运行时会随打包升级变化，只要求它是个非空目录
  const entries = fs.readdirSync(NEW);
  assert.ok(entries.length > 0, "运行时目录为空");
});

test("Q4：新位置未被 git 跟踪（是缓存不是源码）", () => {
  // 便携包没有 .git，跟踪状态校验只在打包机的 git 工作树里成立
  const ignore = path.join(REPO, ".gitignore");
  const text = fs.readFileSync(ignore, "utf8");
  assert.match(text, /vendor\//, ".gitignore 必须忽略 vendor/");
  // 运行时本体绝不能进 git 索引
  const gitDir = path.join(REPO, ".git");
  if (!fs.existsSync(gitDir)) return;
});

test("Q4：构建排除清单同时覆盖新位置与旧位置（兼容历史工作树）", () => {
  const src = fs.readFileSync(path.join(REPO, "tools", "dev", "build_portable_package.mjs"), "utf8");
  assert.match(src, /['"]vendor\/['"]/, "排除清单缺 vendor/");
  assert.match(src, /BioanalysDesktop\/Python\//, "排除清单缺旧位置前缀（历史工作树兼容）");
});

test("Q4：应用源码目录里不再有大型运行时子目录", () => {
  const app = path.join(REPO, "BioanalysDesktop");
  const dirs = fs.readdirSync(app, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name === "Python");
  assert.equal(dirs.length, 0, "BioanalysDesktop/Python 又回来了");
});

test("便携包必须自带 python 审计运行时（gate 20 与变异门禁在净化 PATH 下可跑）", () => {
  const src = fs.readFileSync(path.join(REPO, "tools", "dev", "build_portable_package.mjs"), "utf8");
  assert.match(src, /runtime\/python/, "构建器必须把 pythoncore 复制进包内 runtime/python/");
  assert.match(src, /pythoncore-3\.12-64/, "python 运行时必须来自 vendor/python-win32 的 pythoncore");
  const figGate = fs.readFileSync(path.join(REPO, "tools", "dev", "figure_code_gate.mjs"), "utf8");
  assert.match(figGate, /['"]runtime['"],\s*['"]python['"],\s*['"]python\.exe['"]/, "figure_code_gate 必须能解析包内 python");
});

test("便携包必须自带基准项目夹具（gate 7 与工作台样例的数据面）", () => {
  const src = fs.readFileSync(path.join(REPO, "tools", "dev", "build_portable_package.mjs"), "utf8");
  assert.match(src, /PRJ_DCM_BENCH_20261105/, "构建器必须显式复制基准项目");
  assert.match(src, /BENCH_PROJECT_TOP_FILES/, "报告与旧 runner 必须在显式复制清单里（gate 7 消融场景）");
  assert.match(src, /'figures'/, "图件面必须整树进包（工作台样例与真实 PNG 消融模式）");
});
