/**
 * line3 单物种数据集契约（GSE233814 立项前置，第二批）。
 *
 * 病灶：line3 的 9 个母版把「必须有小鼠**和**人两份输入」写成无条件硬要求：
 *   dim_reduce / spatial_autocorr / spatial_communication / spatial_composition /
 *   spatial_cooccurrence / spatial_domains / spatial_knockout / spatial_localization /
 *   spatial_markers
 * 对单物种数据集（GSE233814 只有小鼠 GPL24247），这些步骤会在参数解析阶段直接 exit 2。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = path.join(REPO, "src/line3_spatial/scripts");

const DUAL_SPECIES_STEPS = [
  "dim_reduce", "spatial_autocorr", "spatial_communication", "spatial_composition",
  "spatial_cooccurrence", "spatial_domains", "spatial_knockout", "spatial_localization",
  "spatial_markers",
];

function read(name) {
  return fs.readFileSync(path.join(DIR, name), "utf8");
}

/** 取可执行行（剔整行注释），避免注释里的字样喂饱判据。 */
function codeOnly(text) {
  return text.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
}

test("9 个步骤都不再把双物种输入写成硬性条件", () => {
  const offenders = [];
  for (const name of DUAL_SPECIES_STEPS) {
    const code = codeOnly(read(name));
    // 旧式：if [ -z "$mouseX" ] || [ -z "$humanX" ]
    if (/if\s+\[\s+-z\s+"\$mouse[^"]*"\s+\]\s*\|\|\s*\[\s+-z\s+"\$human[^"]*"\s+\]/.test(code)) {
      offenders.push(name);
    }
  }
  assert.deepEqual(offenders, [], "以下步骤仍硬性要求双物种输入：" + offenders.join(", "));
});

test("9 个步骤都改为「至少一份」判据", () => {
  const missing = [];
  for (const name of DUAL_SPECIES_STEPS) {
    const code = codeOnly(read(name));
    if (!/if\s+\[\s+-z\s+"\$mouse[^"]*"\s+\]\s*&&\s*\[\s+-z\s+"\$human[^"]*"\s+\]/.test(code)) {
      missing.push(name);
    }
  }
  assert.deepEqual(missing, [], "以下步骤缺「至少一份物种输入」判据：" + missing.join(", "));
});

test("单物种输入不得进入「两份都必需」的装配循环", () => {
  const offenders = [];
  for (const name of DUAL_SPECIES_STEPS) {
    const code = codeOnly(read(name));
    // 坏形态：for path in "$mouse..." "$human..."; do  [ -f "$path" ] || exit
    if (/for\s+path\s+in\s+"\$mouse[^"]*"\s+"\$human[^"]*"\s*;\s*do/.test(code)
        && !/[\s\S]{0,200}?\[\s+-n\s+"\$path"\s+\]\s*\|\|\s*continue/.test(code)) {
      offenders.push(name);
    }
  }
  assert.deepEqual(offenders, [], "以下步骤的路径循环仍按「两份都必需」：" + offenders.join(", "));
});

test("空路径在循环里被跳过（逐步骤独立取证）", () => {
  // 关键：必须在「该步骤自己的 for 循环体内」找到跳过语句。
  // 首版只对整个文件做 assert.match，删掉某一处仍被别的循环喂饱（MUT-J 存活）。
  const missing = [];
  for (const name of DUAL_SPECIES_STEPS) {
    const code = codeOnly(read(name));
    const loopStart = code.search(/for\s+path\s+in\s+"\$mouse[^"]*"\s+"\$human[^"]*"\s*;\s*do/);
    if (loopStart < 0) { missing.push(name + "(无物种路径循环)"); continue; }
    const loopBody = code.slice(loopStart, loopStart + 400);
    const doneAt = loopBody.indexOf("done");
    const body = doneAt > 0 ? loopBody.slice(0, doneAt) : loopBody;
    if (!/\[\s+-n\s+"\$path"\s+\]\s*\|\|\s*continue/.test(body)) {
      missing.push(name);
    }
  }
  assert.deepEqual(missing, [], "以下步骤的循环体缺空路径跳过：" + missing.join(", "));
});
