/**
 * ledger_fetch 真实解析行为测试（不是静态断言）。
 * 用 node:module 拦截 ./remote_exec.js 的 runRemote，喂入构造的批量输出，
 * 验证 fetchLedgerFromServer 真的能一次解析出多个台账文件。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVER = path.join(REPO, "BioanalysDesktop", "server");

function line(name, obj) {
  return Buffer.from(name, "utf8").toString("base64") + "\t"
    + Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

// 用 loader 把 runRemote 换成返回固定批量输出的桩
const fixtures = { batch: "" };
register(pathToFileURL(path.join(REPO, ".tmp", "ledger_mock_loader.mjs")), pathToFileURL(REPO));

test("一次 runRemote 解析出 3 个台账文件，且文件名/内容都还原", async () => {
  fixtures.batch = [
    line("a.json", { status: "ok", n: 1 }),
    line("b.json", { status: "failed", n: 2 }),
    line("c.json", { status: "interrupted", n: 3 }),
  ].join("\n");
  // 让 loader 能读到当前 fixtures
  globalThis.__LEDGER_FIXTURE__ = fixtures.batch;
  const mod = await import(pathToFileURL(path.join(SERVER, "ledger_fetch.js")).href + "?t=" + Date.now());
  const out = await mod.fetchLedgerFromServer("/mnt/ssd/bio_data/system_logs");
  assert.equal(out.entries.length, 3);
  assert.deepEqual(out.names, ["a.json", "b.json", "c.json"]);
  assert.equal(out.entries[0].data.status, "ok");
  assert.equal(out.entries[1].data.n, 2);
  assert.equal(out.entries[2].data.status, "interrupted");
  assert.ok(out.entries[0].path.endsWith("/a.json"));
});

test("空输出返回空数组（链路抖动时不误报违规）", async () => {
  globalThis.__LEDGER_FIXTURE__ = "";
  const mod = await import(pathToFileURL(path.join(SERVER, "ledger_fetch.js")).href + "?t=" + Date.now());
  const out = await mod.fetchLedgerFromServer("/mnt/ssd/bio_data/system_logs");
  assert.deepEqual(out.entries, []);
  assert.deepEqual(out.names, []);
});

test("损坏的 JSON 行被跳过，其余文件照常返回", async () => {
  const bad = Buffer.from("broken.json", "utf8").toString("base64") + "\t"
    + Buffer.from("{not json", "utf8").toString("base64");
  globalThis.__LEDGER_FIXTURE__ = [
    line("good.json", { status: "ok" }),
    bad,
    line("also_good.json", { status: "failed" }),
  ].join("\n");
  const mod = await import(pathToFileURL(path.join(SERVER, "ledger_fetch.js")).href + "?t=" + Date.now());
  const out = await mod.fetchLedgerFromServer("/mnt/ssd/bio_data/system_logs");
  assert.deepEqual(out.names, ["good.json", "also_good.json"]);
});