#!/usr/bin/env node
/**
 * k40_script_parity.mjs —— 仓库母版与 K40 算力面脚本的 SHA256 同源门禁（Argon 第 38 轮 Q4）。
 *
 * 解决的问题（第三十七轮真实事故）：仓库已经不是算力面的真源。
 * ml_hub_analysis 在真机上要求 project.json 的 grouping_design 主对照，仓库母版没有这段逻辑，
 * 整步 failed；反过来仓库的 bulk_figures / deg_limma 有阈值真源接线，远端又落后。
 * 双向分叉会让「本地测试全绿、真机必炸」反复发生，而每次都要从一次真实失败里反推。
 *
 * 门禁口径：
 *   1. 只比对**两边都存在**的脚本（可执行文件，排除 __pycache__ / 目录）；
 *   2. 内容不同 = 分叉，判失败，并打印差异摘要；
 *   3. 任一侧独有 = 孤儿，默认只警告不失败（野生脚本可能是历史遗留，需人工裁定）；
 *   4. 连不上 K40 时**显式跳过并说明**，不静默放行（与 static_gate 的缺工具口径一致）。
 *
 * 用法：
 *   node ops/k40_script_parity.mjs                 # 需要 ssh k40-ubuntu 可达
 *   node ops/k40_script_parity.mjs --offline       # 不连真机，只校验本地清单文件
 *   node ops/k40_script_parity.mjs --json          # 机器可读输出
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const REMOTE_ROOT = "/mnt/ssd/bio_data/bin";
const LINES = ["line1_bulk", "line2_scrna", "line3_spatial"];
const MANIFEST = path.join(REPO, ".ops_state", "k40_script_manifest.json");

const offline = process.argv.includes("--offline");
const asJson = process.argv.includes("--json");

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function localScripts(line) {
  const dir = path.join(REPO, "src", line, "scripts");
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name === "README.md") continue;
    if (entry.name.endsWith(".pyc")) continue;
    const full = path.join(dir, entry.name);
    out[entry.name] = sha256(fs.readFileSync(full));
  }
  return out;
}

function remoteScripts() {
  // 一次 ssh 拿全部三线的 sha256，避免逐文件往返（手机链路每次握手都很贵）
  // 分隔标记必须打在文件列表**之前**：放在之后会让文件名归属整体偏到上一线，
  // 结果看起来像「line1 里全是单细胞脚本、line3 一个都没有」。第一版就是栽在这里。
  const cmd = LINES.map((l) =>
    `echo "@@${l}@@"; cd ${REMOTE_ROOT}/${l} 2>/dev/null && for f in *; do [ -f "$f" ] && sha256sum "$f"; done`
  ).join("; ");
  const raw = execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "k40-ubuntu", cmd], {
    encoding: "utf8", timeout: 120000,
  });
  const out = {};
  let current = null;
  for (const line of raw.split("\n")) {
    const mark = line.match(/^@@(.+)@@$/);
    if (mark) { current = mark[1]; out[current] = {}; continue; }
    if (!current) continue;
    const m = line.match(/^([0-9a-f]{64})\s+(.+)$/);
    if (m) out[current][m[2]] = m[1];
  }
  return out;
}

function main() {
  const problems = [];
  const warnings = [];
  const summary = [];

  let remote = {};
  if (offline) {
    if (!fs.existsSync(MANIFEST)) {
      problems.push("离线模式但清单不存在: " + path.relative(REPO, MANIFEST));
      report(problems, warnings, summary);
      return;
    }
    remote = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).remote || {};
  } else {
    try {
      remote = remoteScripts();
    } catch (exc) {
      // 连不上真机属于「本轮没查」，必须显式说出来，不能混进绿灯
      console.log("[SKIP] k40-script-parity : 无法连接 k40-ubuntu（" + String(exc.message || exc).slice(0, 120) + "）");
      console.log("        本轮未校验同源性。恢复连通后重跑，或用 --offline 校验上次清单。");
      process.exit(2);
    }
    fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
    fs.writeFileSync(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), remote }, null, 2));
  }

  for (const line of LINES) {
    const local = localScripts(line);
    const rem = remote[line] || {};
    const shared = Object.keys(local).filter((n) => n in rem);
    const diverged = shared.filter((n) => local[n] !== rem[n]);
    const onlyLocal = Object.keys(local).filter((n) => !(n in rem));
    const onlyRemote = Object.keys(rem).filter((n) => !(n in local));
    summary.push({ line, local: Object.keys(local).length, remote: Object.keys(rem).length,
                   shared: shared.length, diverged: diverged.length,
                   onlyLocal: onlyLocal.length, onlyRemote: onlyRemote.length });
    for (const n of diverged) problems.push(line + "/" + n + " 内容分叉（仓库 " + local[n].slice(0, 12) + " vs 远端 " + rem[n].slice(0, 12) + "）");
    for (const n of onlyRemote) warnings.push(line + "/" + n + " 只在 K40 存在（野生脚本，需人工裁定归档或回流）");
    if (onlyLocal.length) warnings.push(line + "/" + onlyLocal.join(",") + " 只在仓库存在（尚未部署）");
  }

  report(problems, warnings, summary);
}

function report(problems, warnings, summary) {
  if (asJson) {
    console.log(JSON.stringify({ ok: problems.length === 0, problems, warnings, summary }, null, 2));
  } else {
    for (const s of summary) {
      console.log("[ " + "INFO" + " ] " + s.line + " : 仓库 " + s.local + " / 远端 " + s.remote
        + "，共有 " + s.shared + "，分叉 " + s.diverged
        + (s.onlyLocal ? "，仅仓库 " + s.onlyLocal : "")
        + (s.onlyRemote ? "，仅远端 " + s.onlyRemote : ""));
    }
    for (const w of warnings) console.log("[WARN] " + w);
    for (const p of problems) console.log("[FAIL] " + p);
  }
  if (problems.length === 0) {
    console.log("K40_SCRIPT_PARITY_OK 共有脚本逐字节一致（" + summary.reduce((a, s) => a + s.shared, 0) + " 个）");
  } else {
    console.log("K40_SCRIPT_PARITY_FAIL " + problems.length + " 个分叉脚本");
    process.exit(1);
  }
}

main();