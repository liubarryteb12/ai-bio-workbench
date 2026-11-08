/**
 * line3 单物种下游契约（第三批：物种循环不再硬性要求两份）。
 *
 * 病灶：上一批把 bash 段的双物种硬要求改掉了，但 4 个母版的 Python 段仍写
 *   for species in ["mouse", "human"]:
 *       if not os.path.exists(f): fail("缺少输入 %s")
 * 单物种数据集跑到这里会 fail() 退出。5 步链路（12→13→14→15→17）全部阻断。
 *
 * 例外：enrichment_figures 已有 \`rd()\` 返回 None 的容错，但它仍按双物种循环，
 * 对缺席物种只跳过不报错 —— 需固定这个「跳过」语义，防以后改成 fail。
 *
 * 判据：物种循环必须按「实际存在的文件」推导，而不是写死 ["mouse", "human"]；
 * 缺席物种要么跳过、要么明确报错说「本数据集没有该物种」，不能当作缺文件失败。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = path.join(REPO, "tools/bio/line3_spatial/scripts");

/** 实测含硬性物种循环的步骤。 */
const LOOP_STEPS = ["celltype_annotation", "dr_post_analysis", "enrichment", "enrichment_figures"];

function read(name) {
  return fs.readFileSync(path.join(DIR, name), "utf8");
}

test("物种循环不再写死 [\"mouse\", \"human\"]", () => {
  const offenders = [];
  for (const name of LOOP_STEPS) {
    if (/for\s+species\s+in\s+\["mouse"\s*,\s*"human"\]/.test(read(name))) offenders.push(name);
  }
  assert.deepEqual(offenders, [], "以下步骤仍写死双物种循环：" + offenders.join(", "));
});

test("物种集合由实际存在的文件推导", () => {
  const missing = [];
  for (const name of LOOP_STEPS) {
    const src = read(name);
    // 必须有一段「探测哪些物种产物在位」的逻辑
    const hasDetect = /SPECIES_CANDIDATES|species_present|os\.path\.exists\(.*%s.*\)/s.test(src)
      || /present\s*=\s*\[/.test(src)
      || /for\s+species\s+in\s+present/.test(src);
    if (!hasDetect) missing.push(name);
  }
  assert.deepEqual(missing, [], "以下步骤缺「按实际文件推导物种集合」逻辑：" + missing.join(", "));
});

test("缺席物种不得被判成「缺文件失败」", () => {
  const offenders = [];
  for (const name of LOOP_STEPS) {
    // 坏形态专指「写死双物种的 for 循环体内直接 fail」。
    // 注意不能写成 /for species in.../ 泛匹配：新实现里探测循环（for sp in SPECIES_CANDIDATES）
    // 之后紧跟的就是 fail，会被误判成「循环内硬失败」。
    const src = read(name);
    const literalLoop = src.search(/for\s+species\s+in\s+\["mouse"\s*,\s*"human"\]/);
    if (literalLoop < 0) continue;   // 已改为 species_present，不算违规
    const body = src.slice(literalLoop, literalLoop + 600);
    if (/fail\(/.test(body)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], "以下步骤在写死的双物种循环内硬失败：" + offenders.join(", "));
});

test("探测循环后的 fail 是「全部缺席」而非「缺某个物种」（允许）", () => {
  // 正对照：确认新形态是有意义的判据，不是把检查改没了
  for (const name of LOOP_STEPS) {
    const src = read(name);
    assert.match(src, /if\s+not\s+species_present:\s*\n\s*fail\(/, name + " 必须有「全部缺席」判据");
  }
});

test("若提供了物种但文件确实缺失，仍要报错（不能静默放过残缺输入）", () => {
  // 反向锚定：改宽不等于改成「什么都不检查」
  for (const name of ["celltype_annotation", "dr_post_analysis", "enrichment"]) {
    const src = read(name);
    assert.match(src, /fail\(/, name + " 仍需保留失败路径（输入残缺要报错）");
  }
});
