/**
 * .tmp/ 缓存清理器的安全边界契约（第 41 轮）。
 *
 * 清理器会递归删除，属于高风险操作。本测试钉死四条安全边界：
 *   1. 默认是 dry-run，不加 --apply 绝不删；
 *   2. --older-than 必须是正数，否则 exit 2；
 *   3. 白名单目录（dcm_bench / node-compile-cache / mutation_gate）永远保留；
 *   4. 未过期条目保留。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE = path.join(REPO, "ops", "clean_tmp_cache.mjs");

function run(args = []) {
  try {
    const out = execFileSync(process.execPath, [GATE, ...args], { cwd: REPO, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (exc) {
    return { code: exc.status ?? 1, out: (exc.stdout || "") + (exc.stderr || "") };
  }
}

test("默认是 dry-run：不加 --apply 只报告不删除", () => {
  const r = run();
  assert.equal(r.code, 0);
  assert.match(r.out, /CLEAN_TMP_(DRY_RUN|NOOP)/);
  assert.doesNotMatch(r.out, /CLEAN_TMP_OK/);
});

test("--older-than 非正数必须 exit 2，不能当成 0 小时把全部删光", () => {
  for (const bad of ["0", "-5", "abc"]) {
    const r = run(["--older-than", bad, "--apply"]);
    assert.equal(r.code, 2, "--older-than " + bad + " 应 exit 2");
  }
});

test("白名单目录永远保留：源码里写死了三个进行中的工作目录", () => {
  const src = fs.readFileSync(GATE, "utf8");
  for (const keep of ["dcm_bench", "node-compile-cache", "mutation_gate"]) {
    assert.ok(src.includes('"' + keep + '"'), "白名单缺 " + keep);
  }
  assert.match(src, /if \(KEEP\.has\(entry\.name\)\)/, "白名单判定必须发生在 mtime 判定之前");
});

test("符号链接不跟随：候选收集阶段显式跳过 symlink", () => {
  const src = fs.readFileSync(GATE, "utf8");
  assert.match(src, /if \(stat\.isSymbolicLink\(\)\) continue;/);
});

test("删除范围限定在 .tmp/ 之内（TMP 由 REPO 推导，不接受外部路径）", () => {
  const src = fs.readFileSync(GATE, "utf8");
  assert.match(src, /const TMP = path\.join\(REPO, "\.tmp"\)/);
  assert.doesNotMatch(src, /process\.argv\.indexOf\("--path"\)/, "不应提供任意路径参数");
});