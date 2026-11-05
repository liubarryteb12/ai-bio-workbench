#!/usr/bin/env node
/**
 * clean_tmp_cache.mjs —— 清理 .tmp/ 下的陈旧缓存（第 41 轮）。
 *
 * 为什么需要：实测 .tmp/ 累积 18,715 个文件 / 249 MB，其中 1,194 个目录超过两天。
 * 后果不是占磁盘，而是让「按目录扫描」的工具变慢（全仓色值扫描要遍历它们），
 * 并且掩盖真实产物。
 *
 * 安全边界（任一不满足就不删）：
 *   1. 只动 .tmp/ 下面，且只动目录与普通文件，不跟随符号链接；
 *   2. 只删 mtime 早于 --older-than 小时的条目（默认 48），近期测试夹具保留；
 *   3. 保留 KEEP_DIRS 白名单（正在进行中的工作目录）；
 *   4. --dry-run 默认行为：先报告将删什么，必须显式 --apply 才真删。
 *
 * 用法：
 *   node ops/clean_tmp_cache.mjs                 # 只报告
 *   node ops/clean_tmp_cache.mjs --apply         # 执行清理
 *   node ops/clean_tmp_cache.mjs --older-than 24 --apply
 */
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const TMP = path.join(REPO, ".tmp");

const apply = process.argv.includes("--apply");
const hoursArg = process.argv.indexOf("--older-than");
const olderThanHours = hoursArg > -1 ? Number(process.argv[hoursArg + 1]) : 48;
if (!Number.isFinite(olderThanHours) || olderThanHours <= 0) {
  console.error("--older-than 必须是正数（小时）");
  process.exit(2);
}

// 正在进行中的工作目录：即使陈旧也不删（这些是本轮还在用的）
const KEEP = new Set(["dcm_bench", "node-compile-cache", "mutation_gate"]);

if (!fs.existsSync(TMP)) {
  console.log("[clean_tmp] .tmp/ 不存在，无需清理");
  process.exit(0);
}

const cutoff = Date.now() - olderThanHours * 3600 * 1000;
const candidates = [];
let kept = 0;

for (const entry of fs.readdirSync(TMP, { withFileTypes: true })) {
  if (KEEP.has(entry.name)) { kept += 1; continue; }
  const full = path.join(TMP, entry.name);
  let stat;
  try { stat = fs.lstatSync(full); } catch { continue; }
  // 符号链接一律不跟随也不删：删链接本身安全，但跟随会越界
  if (stat.isSymbolicLink()) continue;
  if (stat.mtimeMs >= cutoff) { kept += 1; continue; }
  const count = entry.isDirectory()
    ? (() => { try { return fs.readdirSync(full, { recursive: true }).length; } catch { return 0; } })()
    : 1;
  candidates.push({ name: entry.name, full, isDir: entry.isDirectory(), count, mtime: stat.mtime });
}

const totalFiles = candidates.reduce((a, c) => a + c.count, 0);
console.log("[clean_tmp] 阈值 " + olderThanHours + " 小时；候选 " + candidates.length
  + " 项 / 约 " + totalFiles + " 个文件；保留（白名单或未过期） " + kept + " 项");

if (candidates.length === 0) {
  console.log("CLEAN_TMP_NOOP 没有可清理项");
  process.exit(0);
}

for (const c of candidates.slice(0, 10)) {
  console.log("  " + (c.isDir ? "[dir] " : "[file]") + c.name + "  files=" + c.count
    + "  mtime=" + c.mtime.toISOString().slice(0, 16));
}
if (candidates.length > 10) console.log("  ... 另有 " + (candidates.length - 10) + " 项");

if (!apply) {
  console.log("CLEAN_TMP_DRY_RUN 未删除任何东西；加 --apply 执行");
  process.exit(0);
}

let removed = 0;
let failed = 0;
for (const c of candidates) {
  try {
    fs.rmSync(c.full, { recursive: true, force: true });
    removed += 1;
  } catch (exc) {
    failed += 1;
    console.log("[WARN] 删除失败 " + c.name + ": " + String(exc.message || exc).slice(0, 80));
  }
}

console.log("[clean_tmp] 已删除 " + removed + " 项" + (failed ? "，失败 " + failed + " 项" : ""));
if (failed > 0) {
  console.log("CLEAN_TMP_PARTIAL");
  process.exit(1);
}
console.log("CLEAN_TMP_OK");