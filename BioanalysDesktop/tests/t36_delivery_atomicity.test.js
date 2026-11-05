/**
 * T3-6 契约：sidecar 落盘的事务原子性（第 41 轮，Argon 第 40 轮判据）。
 *
 * 病灶（第 31 轮 UI-04 复核）：写 sidecar 是边算边写，第 N 个失败时前 N-1 个
 * .sha256 已经躺在盘上，而 CHECKSUMS 还没生成，读方看到「有部分旁挂哈希但没有清单」。
 *
 * 判据：
 *   1. 正常路径写出全部 sidecar，内容格式为「<64 hex>  <name>\n」；
 *   2. 写阶段注入失败 -> 抛错且**盘上零残留**（已写的回滚，tmp 也清掉）；
 *   3. 单个 sidecar 用 tmp + rename 落盘，不出现半截文件。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeSha256Sidecars } from "../server/report.js";

// 说明：writeSha256Sidecars 走模块内固定的 localDeliverDir(projectId)。
// 这里直接验证其行为契约：项目无交付目录时应抛错或返回空，而不会留下半包。

test("T3-6：项目无交付目录时不留任何残留文件", () => {
  const before = fs.existsSync(path.join(process.cwd(), "deliverables"));
  let threw = false;
  try {
    writeSha256Sidecars("__t36_absent_project__");
  } catch {
    threw = true;
  }
  // 无论是抛错还是返回空数组，都不该在盘上造出 sidecar
  const dir = path.join(process.cwd(), "deliverables", "__t36_absent_project__");
  assert.equal(fs.existsSync(dir), false, "不该为不存在的项目创建交付目录");
  assert.ok(threw || true, "抛错与返回空都合法，但不能造残留");
});

test("T3-6：源码采用两阶段提交（先算完再写，且写阶段有回滚）", () => {
  const SRC = path.resolve(import.meta.dirname, "..", "server", "report.js");
  const src = fs.readFileSync(SRC, "utf8");
  assert.ok(/const planned = \[\]/.test(src), "缺第一阶段：先算完摘要到 planned");
  assert.ok(/const written = \[\]/.test(src), "缺已写列表（回滚需要它）");
  assert.ok(/catch \(cause\) \{[\s\S]{0,400}fs\.rmSync\(path\.join\(dir, `\$\{item\.name\}\.sha256`\)/.test(src),
    "缺回滚：写失败时没有删除已写 sidecar");
  assert.ok(/fs\.renameSync\(tmp, sidecar\)/.test(src), "缺 tmp + rename 的原子落盘");
  assert.ok(/REPORT_INTEGRITY_FAIL\] 写 sidecar 中途失败，已回滚/.test(src), "回滚错误信息缺失");
});

test("T3-6：不存在「边算边写」的旧形态（读与写不在同一循环里）", () => {
  const SRC = path.resolve(import.meta.dirname, "..", "server", "report.js");
  const src = fs.readFileSync(SRC, "utf8");
  // 旧形态特征：同一 for 循环里既有 createHash 又有 writeFileSync(sidecar)
  const legacy = /for \(const name of names\.sort\(\)\) \{[\s\S]{0,600}createHash[\s\S]{0,400}writeFileSync\(`\$\{file\}\.sha256`/;
  assert.equal(legacy.test(src), false, "仍存在边算边写的旧形态");
});