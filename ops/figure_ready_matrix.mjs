#!/usr/bin/env node
/**
 * figure_ready_matrix.mjs —— Ready 模板的实证矩阵（当前基线 39 条）。
 *
 * 为什么需要它：白名单只证明「这 30 个 ID 被封板了」，不证明它们的源码与预览图
 * 还和登记时的哈希一致。文件被悄悄改动、预览被重新渲染覆盖，白名单全都看不出来。
 * 这里对每条 ready 模板做真实的 sha256 比对，产出可审计的矩阵。
 *
 * 判据（任一不满足即 exit 1）：
 *   1. ready 集合与 ops/figure_ready_allowlist.json 恒等（条数由白名单决定）；
 *   2. 每条 ready 的 source / preview 文件真实存在；
 *   3. 两者的实测 sha256 与注册表登记值逐字节相同；
 *   4. verified 必须为真（未真机验证的不能算 ready）。
 *
 * 用法：
 *   node ops/figure_ready_matrix.mjs            # 校验，不写文件
 *   node ops/figure_ready_matrix.mjs --write     # 校验并写 ops/figure_ready_matrix.json
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const REGISTRY = path.join(REPO, "src", "figure_templates.json");
const ALLOWLIST = path.join(REPO, "ops", "figure_ready_allowlist.json");
const OUT = path.join(REPO, "ops", "figure_ready_matrix.json");

const write = process.argv.includes("--write");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const registry = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST, "utf8"));
const ready = registry.templates.filter((t) => t.deps_status === "ready");
const problems = [];

// REJ-012（Argon 第 75 轮）：producing_mod_id 必须命中 workflows.json 的真实 Mod，
// data_contract.input_artifact 必须非空。这是 MUT-FIG-A 的常驻防线。
const workflows = JSON.parse(fs.readFileSync(path.join(REPO, "src", "workflows.json"), "utf8"));
const modIds = new Set();
for (const series of workflows.series || []) {
  for (const stage of series.stages || []) {
    for (const mod of stage.mods || []) modIds.add(mod.id);
  }
}
const READY_BASELINE = allowlist.ready_baseline || 39;
if (ready.length < READY_BASELINE) {
  problems.push(`ready 数 ${ready.length} 低于 REJ-012 棘轮基线 ${READY_BASELINE}（只升不降）`);
}

// 1. 集合恒等
const readyIds = ready.map((t) => t.id).sort();
const allowIds = [...allowlist.ids].sort();
if (JSON.stringify(readyIds) !== JSON.stringify(allowIds)) {
  const onlyReady = readyIds.filter((id) => !allowIds.includes(id));
  const onlyAllow = allowIds.filter((id) => !readyIds.includes(id));
  problems.push("ready 集合与白名单不恒等：仅注册表 " + onlyReady.join(",") + "；仅白名单 " + onlyAllow.join(","));
}

// 2/3/4. 逐条核验
const rows = [];
for (const t of ready) {
  const row = { id: t.id, level: t.level, language: t.language, verified: Boolean(t.verified) };
  if (!t.verified) problems.push(t.id + ": verified=false，未真机验证不能算 ready");
  if (!t.producing_mod_id || !modIds.has(t.producing_mod_id)) {
    problems.push(t.id + ": producing_mod_id 缺失或不在 workflows.json（幽灵外键）: " + t.producing_mod_id);
  }
  if (!t.data_contract || !t.data_contract.input_artifact) {
    problems.push(t.id + ": data_contract.input_artifact 为空（数据契约缺失）");
  }
  for (const [kind, rel, want] of [["source", t.source, t.source_sha256], ["preview", t.preview, t.preview_sha256]]) {
    const abs = path.isAbsolute(rel) ? rel : path.join(REPO, rel);
    if (!fs.existsSync(abs)) {
      problems.push(t.id + " " + kind + ": 文件不存在 " + rel);
      row[kind + "_sha_match"] = false;
      continue;
    }
    const got = sha256(abs);
    const match = got === want;
    row[kind + "_sha_match"] = match;
    row[kind + "_path"] = rel;
    if (!match) problems.push(t.id + " " + kind + ": sha256 与登记值不符（实测 " + got.slice(0, 12) + " vs 登记 " + String(want).slice(0, 12) + "）");
  }
  rows.push(row);
}

const byLevel = {};
const byLang = {};
for (const r of rows) {
  byLevel[r.level] = (byLevel[r.level] || 0) + 1;
  byLang[r.language] = (byLang[r.language] || 0) + 1;
}

const summary = {
  generatedAt: new Date().toISOString(),
  total_ready: rows.length,
  source_sha_match: rows.filter((r) => r.source_sha_match).length,
  preview_sha_match: rows.filter((r) => r.preview_sha_match).length,
  verified_true: rows.filter((r) => r.verified).length,
  by_level: byLevel,
  by_language: byLang,
  rows,
};

if (write && problems.length === 0) {
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2) + "\n");
  console.log("[figure_ready_matrix] 已写入 " + path.relative(REPO, OUT));
}

console.log("[figure_ready_matrix] ready=" + summary.total_ready
  + " source_sha_match=" + summary.source_sha_match + "/" + summary.total_ready
  + " preview_sha_match=" + summary.preview_sha_match + "/" + summary.total_ready
  + " verified=" + summary.verified_true + "/" + summary.total_ready);
if (problems.length > 0) {
  for (const p of problems.slice(0, 20)) console.log("[FAIL] " + p);
  console.log("FIGURE_READY_MATRIX_FAIL " + problems.length + " 处不满足");
  process.exit(1);
}
console.log("FIGURE_READY_MATRIX_OK " + rows.length + " 条 Ready 证据链完整（源码+预览哈希逐字节一致，producing_mod_id 外键闭合，全部真机验证）");
