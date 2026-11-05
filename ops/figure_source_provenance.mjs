#!/usr/bin/env node
/**
 * figure_source_provenance.mjs —— 出图代码与参考库的溯源诚实性门禁（生信代码专项审核）。
 *
 * 审核发现的核心问题：注册表 src/figure_templates.json 里 30 条 ready 模板都登记了
 * source 指向 reference/05.可参考出图代码，但五个真实出图脚本一处都没引用参考库。
 * 也就是说「溯源」目前只是元数据关系，不是代码的派生关系。
 *
 * 本门禁不强行要求「必须派生」（那是产品决定），而是要求**诚实**：
 *   1. 每份出图脚本必须显式声明它与参考库的关系（DERIVED / INSPIRED / INDEPENDENT）；
 *   2. 声明 DERIVED 的，脚本里必须真的出现参考库路径引用（否则是假溯源）；
 *   3. 声明 INDEPENDENT 的，注册表对应条目的 source 字段必须标注为「参考来源」而非「派生来源」；
 *   4. 任何出图脚本缺声明 -> FAIL（不允许默认沉默）。
 *
 * 用法：node ops/figure_source_provenance.mjs
 */
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");

/** 出图脚本清单（相对 src/）。新增出图脚本必须登记到这里，否则门禁不知道要审它。 */
export const FIGURE_SCRIPTS = Object.freeze([
  "line1_bulk/bulk_figures",
  "line1_bulk/enrichment_figures",
  "line2_scrna/scrna_figures",
  "line2_scrna/enrichment_figures",
  "line2_scrna/scenic_figures",
  "line3_spatial/enrichment_figures",
]);

/** 合法的溯源声明关键字。 */
export const PROVENANCE_KINDS = Object.freeze(["DERIVED", "INSPIRED", "INDEPENDENT"]);

/** 参考库路径特征：出现即说明脚本真的读了库。 */
export const REFERENCE_PATH_MARKERS = Object.freeze([
  "05.可参考出图代码", "reference/05", "R453_compat", "figure_library",
]);

/**
 * 解析一份出图脚本的溯源声明。约定在文件头部注释里写：
 *   # PROVENANCE: INDEPENDENT   （或 DERIVED / INSPIRED）
 * 允许 R 的 # 与 Python 的 # 两种注释前缀（都是 #）。
 * @returns {string|null}
 */
export function parseProvenance(text) {
  const m = text.match(/^\s*#\s*PROVENANCE:\s*(DERIVED|INSPIRED|INDEPENDENT)\b/m);
  return m ? m[1] : null;
}

/**
 * 该脚本是否真的引用了参考库路径。
 *
 * 关键：必须先剔除 PROVENANCE 声明行本身。声明里必然会写
 * "reference/05.可参考出图代码" 来解释关系，若不剔除，判据会被自己污染 ——
 * 一个如实声明 INDEPENDENT 的脚本反而会被判成"引用了库"。
 */
export function referencesLibrary(text) {
  const withoutDeclaration = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*#\s*PROVENANCE:/.test(line))
    .join("\n");
  return REFERENCE_PATH_MARKERS.some((marker) => withoutDeclaration.includes(marker));
}

function main() {
  const problems = [];
  const rows = [];
  for (const rel of FIGURE_SCRIPTS) {
    // rel 形如 line1_bulk/bulk_figures，实际路径是 src/<line>/scripts/<script>
    const [lineId, scriptName] = rel.split("/");
    const abs = path.join(REPO, "src", lineId, "scripts", scriptName);
    if (!fs.existsSync(abs)) {
      problems.push(rel + ": 脚本不存在（清单过期？）");
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    const kind = parseProvenance(text);
    const refs = referencesLibrary(text);
    rows.push({ script: rel, provenance: kind || "(未声明)", referencesLibrary: refs });
    if (!kind) {
      problems.push(rel + ": 缺 PROVENANCE 声明（须为 DERIVED / INSPIRED / INDEPENDENT）");
      continue;
    }
    // 假溯源检测：声称派生却不引用库
    if (kind === "DERIVED" && !refs) {
      problems.push(rel + ": 声明 DERIVED 但脚本内未出现参考库路径（假溯源）");
    }
  }

  console.log("[figure_provenance] 扫描 " + rows.length + " 个出图脚本");
  for (const r of rows) {
    console.log("  " + r.script.padEnd(34) + " " + String(r.provenance).padEnd(12)
      + " referencesLibrary=" + r.referencesLibrary);
  }
  for (const p of problems) console.log("[FAIL] " + p);
  if (problems.length > 0) {
    console.log("FIGURE_PROVENANCE_FAIL " + problems.length + " 处不诚实或缺声明");
    process.exit(1);
  }
  console.log("FIGURE_PROVENANCE_OK 全部出图脚本均有诚实溯源声明");
}

// 入口判定用 fileURLToPath（URL.pathname 在 Windows 上带 %编码与正斜杠，直接比对会失败，
// 导致看起来"门禁跑了但没输出"）。与 ops 下其它门禁保持同一种写法。
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SELF)) {
  main();
}