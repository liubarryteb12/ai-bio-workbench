#!/usr/bin/env node
/**
 * k40_script_parity 的变异反证（Argon 第 39 轮要求）。
 *
 * 判据：在模拟的远端集合里多塞一个野生文件名，门禁必须 exit 1；
 * 少一个文件（只在仓库）也必须 exit 1；内容改一个字节同样 exit 1。
 * 三条都变红才算门禁真的焊死了同源性，而不是永远绿灯。
 *
 * 做法：不碰真机，把 manifest 写成临时文件喂给 --offline，逐条验证退出码。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(REPO, "ops", "k40_script_parity.mjs");
const REAL_MANIFEST = path.join(REPO, ".ops_state", "k40_script_manifest.json");
const LINES = ["line1_bulk", "line2_scrna", "line3_spatial"];

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function localHashes() {
  const out = {};
  for (const line of LINES) {
    const dir = path.join(REPO, "src", line, "scripts");
    out[line] = {};
    for (const name of fs.readdirSync(dir)) {
      if (name === "README.md") continue;
      const full = path.join(dir, name);
      if (!fs.statSync(full).isFile()) continue;
      out[line][name] = sha256File(full);
    }
  }
  return out;
}

function runWith(manifest) {
  const tmp = path.join(os.tmpdir(), "k40_parity_" + Date.now() + "_" + Math.random().toString(36).slice(2) + ".json");
  fs.writeFileSync(tmp, JSON.stringify(manifest));
  try {
    // 用环境变量替代硬编码路径，避免碰真 manifest
    const out = execFileSync(process.execPath, [SCRIPT, "--offline"], {
      cwd: REPO, encoding: "utf8", stdio: "pipe",
      env: { ...process.env, K40_PARITY_MANIFEST: tmp },
    });
    return { code: 0, out };
  } catch (exc) {
    return { code: exc.status ?? 1, out: (exc.stdout || "") + (exc.stderr || "") };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const base = { remote: localHashes() };
// 前置校验：三个被变异引用的键必须真的存在，否则"删掉/改掉"会静默变成空操作
for (const [line, name] of [["line2_scrna", "h5_rows.py"], ["line3_spatial", "spatial_stats.py"]]) {
  assert.ok(base.remote[line] && base.remote[line][name], "测试前置：缺 " + line + "/" + name);
}
const results = [];

// 基线：完全一致必须 exit 0
const clean = runWith(base);
results.push(["基线与远端完全一致 -> exit 0", clean.code === 0, "exit=" + clean.code]);

// 变异 1：远端多塞一个野生文件 -> 必须 exit 1
const extra = JSON.parse(JSON.stringify(base));
extra.remote.line1_bulk.__wild_probe = "0".repeat(64);
const r1 = runWith(extra);
results.push(["远端多一个野生文件 -> exit 1", r1.code === 1, "exit=" + r1.code]);

// 变异 2：远端少一个文件（只在仓库） -> 必须 exit 1
const missing = JSON.parse(JSON.stringify(base));
delete missing.remote["line2_scrna"]["h5_rows.py"];
const r2 = runWith(missing);
results.push(["远端少一个文件 -> exit 1", r2.code === 1, "exit=" + r2.code]);

// 变异 3：内容改一字节 -> 必须 exit 1
const changed = JSON.parse(JSON.stringify(base));
changed.remote["line3_spatial"]["spatial_stats.py"] = "f".repeat(64);
const r3 = runWith(changed);
results.push(["内容哈希不同 -> exit 1", r3.code === 1, "exit=" + r3.code]);

let failed = 0;
for (const [name, ok, detail] of results) {
  console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + detail));
  if (!ok) failed += 1;
}
if (failed) {
  console.log("\n失败 " + failed + " 项");
  process.exit(1);
}
console.log("\n全部通过");