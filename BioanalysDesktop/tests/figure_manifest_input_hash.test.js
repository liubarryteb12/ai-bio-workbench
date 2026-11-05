/**
 * figures_manifest.txt 输入数据溯源（B4，Argon 第 65 轮梯队 1；覆盖面于 2026-11-06 改动态发现）。
 *
 * 病灶：manifest 只记产物清单时，「这张图由哪份数据渲染」不可证，
 * 换了数据复用旧图也查不出来。
 *
 * Argon 加固要求（第 65 轮第二节 2）：
 *   - 三线统一写入 input_sha256: <filename>=<sha256>；
 *   - 超 500MB 的 .h5ad 记录 size + 首尾 1MB 的 sha256，或复用上游 receipt 哈希，
 *     防 K40 上对大文件全量读哈希造成 I/O 阻塞；
 *   - 配「缺 input_sha256 字段即判红」的契约断言。
 *
 * 覆盖面口径（B1 同款教训）：本测试原先手写 5 份母版名单，真机 P2 链跑完才发现
 * line3 的 enrichment_figures 与 spatial_figures 也写 manifest 却没被清单覆盖，
 * 于是漏补 input_sha256。现在改为按「源码是否写 figures_manifest.txt」动态发现，
 * 新增出图母版自动纳入，不需要人工登记。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LINES = ["line1_bulk", "line2_scrna", "line3_spatial"];

function codeOnly(text) {
  return text.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith("#");
  }).join("\n");
}

/** 动态发现所有写 figures_manifest.txt 的母版（无扩展名的 Linux 面脚本）。 */
function manifestWriters() {
  const out = [];
  for (const line of LINES) {
    const dir = path.join(REPO, "src", line, "scripts");
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name === "README.md") continue;
      if (/\.(py|R|sh|md|json|tsv|csv)$/i.test(e.name)) continue;
      const abs = path.join(dir, e.name);
      const code = codeOnly(fs.readFileSync(abs, "utf8"));
      if (/figures_manifest\.txt/.test(code)) out.push({ rel: line + "/" + e.name, code });
    }
  }
  return out;
}

test("每个写 manifest 的母版都必须写入 input_sha256（动态发现，不留白名单盲区）", () => {
  const writers = manifestWriters();
  assert.ok(writers.length >= 7, "实测至少 7 份写 manifest，当前发现 " + writers.length);
  const missing = writers.filter((m) => !/input_sha256/.test(m.code)).map((m) => m.rel);
  assert.deepEqual(missing, [], "以下母版写 manifest 但缺 input_sha256：" + missing.join(", "));
});

test("大文件分级哈希：500MB 阈值与首尾 1MB 采样必须显式存在", () => {
  for (const m of manifestWriters()) {
    if (!/input_sha256/.test(m.code)) continue;
    assert.match(m.code, /500\s*\*\s*1024\s*\*\s*1024|LARGE_FILE_BYTES/,
      m.rel + " 必须显式声明 500MB 阈值常量");
    assert.match(m.code, /1024\s*\*\s*1024/, m.rel + " 必须显式声明 1MB 采样窗口");
    assert.match(m.code, /seek\s*\(/, m.rel + " 大文件采样必须用 seek，不能全量读入内存");
  }
});

test("input_sha256 的格式与可解析性（filename=sha256 一行一条）", () => {
  for (const m of manifestWriters()) {
    if (!/input_sha256/.test(m.code)) continue;
    assert.match(m.code, /input_sha256=/, m.rel + " 必须以 input_sha256= 前缀写入");
    assert.match(m.code, /for\s+\w+,\s*\w+\s+in\s+input_fingerprints/,
      m.rel + " 必须遍历输入集合生成多行，而不是写死一个");
  }
});
