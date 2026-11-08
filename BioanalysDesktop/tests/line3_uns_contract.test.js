/**
 * line3 uns 键生产契约（GSE233814 真机 step6 暴露的缺陷）。
 *
 * 病灶：spatial_markers 把 uns["warnings"] 列为 REQUIRED_UNS（9 个下游母版同款检查），
 * 但 ingest_spatial 只在 warnings_list 非空时才写该键。GSE233814 全链无警告，
 * 于是 counts h5ad 根本没有这个键，链到 step6 才炸：
 *   spatial_domains_mouse.h5ad 缺少 uns 键 [warnings]（不是 spatial_domains 产物？）
 * 「没有警告」与「生产者忘了写」必须可区分，所以空列表也要落键。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const INGEST = path.join(REPO, "tools/bio/line3_spatial/scripts/ingest_spatial");

const WRITE_RE = /^[ ]*adata\.uns\["warnings"\][ ]*=[ ]*list\(warnings_list\)/;
const COND_RE = /^if[ ]+warnings_list[ ]*:/;

test("ingest 无条件写 uns warnings 键（空列表照写）", () => {
  const text = fs.readFileSync(INGEST, "utf8");
  const lines = text.split(/\r?\n/);
  const writeIdx = lines.findIndex((l) => WRITE_RE.test(l));
  assert.ok(writeIdx >= 0, "ingest 必须含无条件赋值行 adata.uns warnings = list(warnings_list)");
  const prev = (lines[writeIdx - 1] || "").trim();
  assert.equal(COND_RE.test(prev), false, "warnings 键不得条件省略：空警告也要落键");
});

test("warnings 赋值在 h5ad 落盘之前", () => {
  // WRITE_RE 带 ^ 锚，全文 match 必须开 m 标志，否则永远 null（首版踩过）
  const text = fs.readFileSync(INGEST, "utf8");
  const m = text.match(new RegExp(WRITE_RE.source, "m"));
  assert.ok(m, "写入行必须存在");
  const writeAt = m.index;
  const saveAt = text.indexOf("write_h5ad");
  assert.ok(saveAt > writeAt, "必须在 h5ad 落盘之前赋值");
});
