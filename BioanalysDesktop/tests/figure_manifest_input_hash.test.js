/**
 * figures_manifest.txt 输入数据溯源（B4，Argon 第 65 轮梯队 1）。
 *
 * 病灶：manifest 只记 step/seed/out/count/elapsed 与产物清单，没有输入文件哈希。
 * 「这张图由哪份数据渲染」因此不可证，无法排除「换了数据但复用了旧图」。
 *
 * Argon 加固要求（第 65 轮第二节 2）：
 *   - 三线统一写入 input_sha256: <filename>=<sha256>；
 *   - 超 500MB 的 .h5ad 记录 size + 首尾 1MB 的 sha256，或复用上游 receipt 哈希，
 *     防 K40 上对大文件全量读哈希造成 I/O 阻塞；
 *   - 配「缺 input_sha256 字段即判红」的契约断言。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 写 manifest 的出图母版（三线各至少一份）。 */
const MANIFEST_WRITERS = [
  "line1_bulk/bulk_figures",
  "line1_bulk/enrichment_figures",
  "line2_scrna/enrichment_figures",
  "line2_scrna/scenic_figures",
  "line2_scrna/scrna_figures",
];

function readMaster(rel) {
  const [line, name] = rel.split("/");
  return fs.readFileSync(path.join(REPO, "src", line, "scripts", name), "utf8");
}

/** 只保留可执行代码行，剔除注释（防注释里的字样喂饱判据）。 */
function codeOnly(text) {
  return text.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith("#");
  }).join(String.fromCharCode(10));
}

test("写 manifest 的母版必须写入 input_sha256 字段", () => {
  const missing = [];
  for (const rel of MANIFEST_WRITERS) {
    const code = codeOnly(readMaster(rel));
    if (!/figures_manifest\.txt/.test(code)) continue;
    if (!/input_sha256/.test(code)) missing.push(rel);
  }
  assert.deepEqual(missing, [], "以下母版写 manifest 但缺 input_sha256：" + missing.join(", "));
});

test("大文件分级哈希：500MB 阈值与首尾 1MB 采样必须显式存在", () => {
  const code = codeOnly(readMaster("line1_bulk/bulk_figures"));
  assert.match(code, /500\s*\*\s*1024\s*\*\s*1024|500\s*<\s*1024\s*\*\s*1024|LARGE_FILE_BYTES/,
    "必须显式声明 500MB 阈值常量");
  assert.match(code, /1024\s*\*\s*1024/, "必须显式声明 1MB 采样窗口");
  assert.match(code, /seek\s*\(/, "大文件采样必须用 seek，不能全量读入内存");
});

test("input_sha256 的格式与可解析性（filename=sha256 一行一条）", () => {
  const code = codeOnly(readMaster("line1_bulk/bulk_figures"));
  // 写入格式必须是 键=值，且键名固定
  assert.match(code, /input_sha256=/, "必须以 input_sha256= 前缀写入");
  // 必须遍历输入文件而不是写死一个
  assert.match(code, /for\s+\w+\s+in/, "必须遍历输入集合生成多行");
});
