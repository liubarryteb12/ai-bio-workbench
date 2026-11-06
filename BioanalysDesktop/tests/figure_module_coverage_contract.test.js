/**
 * line3 模块配图完整性契约（2026-11-06 用户指出「出图少一部分」）。
 *
 * 实测缺口：4 个分析模块跑了、表也落了，但没有配图。
 *   celltype_annotation  -> celltype_scores/annotation_mouse.tsv    无图
 *   spatial_cooccurrence -> domain_cooccurrence_mouse.tsv            无图
 *   spatial_communication-> sample_communication_mouse.tsv           无图
 *   spatial_localization -> gene_localization_mouse.tsv              无图
 * 规范（docs/figure_spec.md）要求每个分析模块都有可读图件，不能只落表。
 *
 * 判据：spatial_figures 必须为这 4 个模块产出对应图件，
 * 且图名带可识别的语义键（celltype / cooccur / comm / localization）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SF = path.join(REPO, "src/line3_spatial/scripts/spatial_figures");

function read() {
  return fs.readFileSync(SF, "utf8");
}

test("celltype_annotation 必须有配图", () => {
  const src = read();
  assert.match(src, /celltype/i, "spatial_figures 必须读 celltype 产物");
  assert.match(src, /save\(fig,\s*[^)]*celltype/i, "必须为 celltype 落一张图");
});

test("spatial_cooccurrence 必须有配图", () => {
  const src = read();
  assert.match(src, /cooccur/i, "spatial_figures 必须读 domain_cooccurrence 产物");
  assert.match(src, /save\(fig,\s*[^)]*cooccur/i, "必须为 cooccurrence 落一张图");
});

test("spatial_communication 必须有配图", () => {
  const src = read();
  assert.match(src, /communication|comm_/i, "spatial_figures 必须读 communication 产物");
  assert.match(src, /save\(fig,\s*[^)]*comm/i, "必须为 communication 落一张图");
});

test("spatial_localization 必须有配图", () => {
  const src = read();
  assert.match(src, /localization/i, "spatial_figures 必须读 gene_localization 产物");
  assert.match(src, /save\(fig,\s*[^)]*localization/i, "必须为 localization 落一张图");
});

test("新增图沿用既有编号体系，不与之冲突", () => {
  const src = read();
  const nums = [...src.matchAll(/(?:%s_)?"?_?(\d{2})_[a-z]/g)].map((m) => m[1]);
  const uniq = [...new Set(nums)].filter((n) => Number(n) >= 17);
  assert.ok(uniq.length >= 1, "新增图应使用 17 及以后的编号，避免与既有 01-16 冲突");
});
