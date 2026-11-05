#!/usr/bin/env node
/**
 * project_script_gate.mjs —— 项目层脚本边界门禁（Q1，第 41 轮，抄 nf-core/modules）。
 *
 * 对标：nf-core 严禁在项目目录放工具脚本副本，项目定制只准通过 conf/modules.config
 * 注入 ext.args；代码是 100% 不可变的只读母版。
 *
 * 本仓库实情（审计 6 个 local_projects/ 后确认）：只有 PRJ_DCM_BENCH_20261105 有
 * scripts/（31 个文件），且**没有一个是母版同名副本**，全部是数据形态适配层
 * （10x 混合压缩读取、Visium 三切片对齐、L2/L3 流程编排）。所以这里要防的不是
 * "已经发生的副本"，而是"未来有人把母版整份拷进项目目录调参"这条漂移老路。
 *
 * 判据：
 *   1. 项目 scripts/ 下出现与 src/<line>/scripts/ 同名的文件 -> FAIL（完整副本）；
 *   2. 项目 scripts/ 下出现可执行入口（shebang + 未知步骤名）而未登记 -> FAIL；
 *   3. 每个有 scripts/ 的项目必须有 scripts_manifest.json，逐条声明每个脚本的用途与母版来源；
 *   4. 没有 scripts/ 的项目直接通过（参数化项目是推荐形态）。
 *
 * 用法：node ops/project_script_gate.mjs
 */
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const PROJECTS = path.join(REPO, "local_projects");
const LINES = ["line1_bulk", "line2_scrna", "line3_spatial"];

const problems = [];
const warnings = [];

const masterNames = new Set();
for (const line of LINES) {
  const dir = path.join(REPO, "src", line, "scripts");
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) masterNames.add(f);
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let checked = 0;
for (const proj of fs.readdirSync(PROJECTS, { withFileTypes: true })) {
  if (!proj.isDirectory()) continue;
  const scriptsDir = path.join(PROJECTS, proj.name, "scripts");
  if (!fs.existsSync(scriptsDir)) continue;
  checked += 1;
  const files = walk(scriptsDir).filter((f) => !f.endsWith("scripts_manifest.json"))
    .filter((f) => !f.endsWith(".pyc"))
    .filter((f) => path.basename(path.dirname(f)) !== "__pycache__");

  // 判据 1：同名副本
  for (const f of files) {
    if (masterNames.has(path.basename(f))) {
      problems.push(proj.name + "/" + path.relative(path.join(PROJECTS, proj.name), f)
        + " 与母版同名，禁止在项目目录放完整脚本副本（应改 step_overrides.json 参数覆盖）");
    }
  }

  // 判据 3：必须有清单，且逐条登记
  const manifestPath = path.join(scriptsDir, "scripts_manifest.json");
  if (!fs.existsSync(manifestPath)) {
    problems.push(proj.name + " 有 scripts/ 但缺 scripts_manifest.json（适配脚本必须逐条声明用途与母版来源）");
  } else {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
    catch (exc) { problems.push(proj.name + " scripts_manifest.json 不是合法 JSON: " + exc.message); continue; }
    const declared = new Set((manifest.scripts || []).map((s) => s.file));
    for (const f of files) {
      const rel = path.relative(scriptsDir, f).split(path.sep).join("/");
      if (!declared.has(rel)) {
        problems.push(proj.name + "/scripts/" + rel + " 未在 scripts_manifest.json 登记");
      }
    }
  }
}

if (checked === 0) {
  console.log("[project_script_gate] 没有项目含 scripts/（全参数化，推荐形态）");
} else {
  console.log("[project_script_gate] 检查 " + checked + " 个含 scripts/ 的项目");
}
for (const w of warnings) console.log("[WARN] " + w);
for (const p of problems) console.log("[FAIL] " + p);

if (problems.length > 0) {
  console.log("PROJECT_SCRIPT_GATE_FAIL " + problems.length + " 处越界");
  process.exit(1);
}
console.log("PROJECT_SCRIPT_GATE_OK 项目层无母版副本，适配脚本全部登记");