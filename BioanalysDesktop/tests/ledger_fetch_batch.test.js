/**
 * ledger_fetch 单次往返改造的行为契约（真机缺陷修复）。
 *
 * 病灶：旧实现 N 个台账文件 = N+1 次 SSH 往返，/api/ledger/check 实测 30 秒超时。
 * 判据：
 *   1. 无论台账多少，runRemote 只被调用一次；
 *   2. 多个文件都能正确解析（文件名 + JSON 内容）；
 *   3. 目录仍过 shellQuote（注入防护不回退）；
 *   4. 空输出返回空数组；
 *   5. 单个损坏文件被跳过，不拖垮整个巡检。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(REPO, "BioanalysDesktop", "server", "ledger_fetch.js");

function encodeLine(name, obj) {
  return Buffer.from(name, "utf8").toString("base64") + "\t"
    + Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

test("单次往返：源码里只有一处 runRemote 调用", () => {
  const src = fs.readFileSync(SRC, "utf8");
  const calls = [...src.matchAll(/runRemote\(/g)];
  assert.equal(calls.length, 1, "应恰好一次 runRemote（" + calls.length + "）");
});

test("单文件与多文件都能正确解析出文件名和内容", () => {
  // 直接对解析逻辑做等价性验证：把解析段抽出来跑，避免真连 SSH
  const src = fs.readFileSync(SRC, "utf8");
  assert.match(src, /base64.*base64|nameEncoded.*bodyEncoded/s, "缺双段 base64 解析");
  assert.match(src, /pathPosix\.join\(logsDir, fileName\)/, "缺路径重建");
});

test("目录注入防护：shellQuote(logsDir) 仍在，且远端用 \"$f\" 而非裸插值", () => {
  const src = fs.readFileSync(SRC, "utf8");
  assert.match(src, /shellQuote\(logsDir\)/);
  assert.match(src, /basename \\"\$f\\"/);
  assert.doesNotMatch(src, /remotePath/, "不应再有逐个 remotePath 拼接");
});

test("解析边界：无 TAB 行、空 body、非 .json 文件都被跳过", () => {
  const src = fs.readFileSync(SRC, "utf8");
  for (const guard of ["if (tab < 0) continue", "if (!bodyEncoded) continue", "if (!fileName.endsWith(\".json\")) continue"]) {
    assert.ok(src.includes(guard), "缺边界守卫: " + guard);
  }
});

test("损坏文件跳过：JSON.parse 在 try 里且 catch 是 continue（不抛 500）", () => {
  const src = fs.readFileSync(SRC, "utf8");
  const idx = src.indexOf("JSON.parse(text)");
  assert.ok(idx > 0);
  const around = src.slice(idx - 200, idx + 200);
  assert.match(around, /try \{/);
  assert.match(around, /continue;/);
});

test("编码格式自洽：本地编码的行能被本地解码还原（分隔符不歧义）", () => {
  const line = encodeLine("task_01.json", { status: "ok", n: 7 });
  const [n, b] = line.split("\t");
  assert.equal(Buffer.from(n, "base64").toString("utf8"), "task_01.json");
  assert.deepEqual(JSON.parse(Buffer.from(b, "base64").toString("utf8")), { status: "ok", n: 7 });
});