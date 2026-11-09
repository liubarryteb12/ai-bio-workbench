import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO, "tools", "bio", "line1_bulk", "scripts", "prep_matrix");
const src = fs.readFileSync(SCRIPT, "utf8");

test("prep_matrix 包含 safe_fread 规避 R.utils 依赖", () => {
  assert.match(src, /safe_fread\s*<-\s*function/);
  assert.match(src, /gzip\s+-dc/);
});

test("prep_matrix 在 counts 与 microarray 路径均使用 safe_fread", () => {
  assert.match(src, /counts_table\s*<-\s*safe_fread\(count_file/);
  assert.match(src, /gpl_table\s*<-\s*safe_fread\(gpl_file/);
});

test("prep_matrix 探针合并前显式强制字符类型对齐", () => {
  assert.match(src, /expr\[,\s*ID_REF\s*:=\s*as\.character\(ID_REF\)\]/);
  assert.match(src, /gpl_table\[,\s*ID_REF\s*:=\s*as\.character\(ID\)\]/);
  assert.match(src, /merge\(as\.data\.table\(expr\),\s*gpl_table\[,\s*\.\(ID_REF,\s*gene\)\],\s*by\s*=\s*"ID_REF"\)/);
});

test("prep_matrix 探针注释过滤掉 NA 与空字符串 symbol", () => {
  assert.match(src, /merged\s*<-\s*merged\[!is\.na\(gene\)\s*&\s*nzchar\(gene\)\]/);
});

test("真实 GSE42955 与 GPL6244 契约存在性核验", (t) => {
  const gseDir = path.join(REPO, "references", "06.测试用原始数据", "L1_Microarray_GSE42955");
  if (!fs.existsSync(gseDir)) {
    t.skip("HOST_MISSING_LOCAL_DATA: L1_Microarray_GSE42955 不在位");
    return;
  }
  const sm = path.join(gseDir, "GSE42955_series_matrix.txt.gz");
  const gpl = path.join(gseDir, "GPL6244_table.txt.gz");
  const grp = path.join(gseDir, "grouping.txt");
  assert.ok(fs.existsSync(sm), "缺 GSE42955_series_matrix.txt.gz");
  assert.ok(fs.existsSync(gpl), "缺 GPL6244_table.txt.gz");
  assert.ok(fs.existsSync(grp), "缺 grouping.txt");

  const groupingText = fs.readFileSync(grp, "utf8");
  assert.match(groupingText, /GSM1053915\s+DCM/);
  assert.match(groupingText, /GSM1053922\s+Control/);
});
