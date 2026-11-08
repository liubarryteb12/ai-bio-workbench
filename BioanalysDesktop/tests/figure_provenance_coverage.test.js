/**
 * 出图溯源门禁的覆盖面契约（Argon 第 65 轮 Q2 改判口径）。
 *
 * 病灶：tools/dev/figure_source_provenance.mjs 的 FIGURE_SCRIPTS 是手写白名单，只登记 6 份。
 * 实际含产图落盘调用（savefig / ggsave / png( / pdf(）的母版有 22 份，其中 16 份既没登记
 * 也没有 # PROVENANCE: 声明，却仍让门禁输出「全部出图脚本均有诚实溯源声明」。
 * 这是「按名字信人」而不是「按行为管人」：ml_hub_analysis / ppi_string / key_genes
 * 这类名字不带 figures 却实打实产图的母版，合法地游离在审查之外。
 *
 * 本契约把「登记集合」锚到「实际产图行为」：
 *   1. 凡源码含产图调用且非注释行的母版，必须出现在 FIGURE_SCRIPTS 中；
 *   2. 上述母版必须声明 # PROVENANCE: DERIVED|INSPIRED|INDEPENDENT；
 *   3. 集合双向恒等（既不漏登记，也不留过期条目）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIGURE_SCRIPTS, discoverFigureProducers, parseProvenance,
} from "../../tools/dev/figure_source_provenance.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("登记集合与「实际产图母版」双向恒等（不漏登记、不留过期项）", () => {
  const discovered = discoverFigureProducers().map((r) => r.rel).sort();
  const registered = [...FIGURE_SCRIPTS].sort();
  assert.deepEqual(
    registered,
    discovered,
    "FIGURE_SCRIPTS 必须与按产图调用动态发现的集合完全一致；"
      + "缺登记=" + discovered.filter((x) => !registered.includes(x)).join(",")
      + " 过期项=" + registered.filter((x) => !discovered.includes(x)).join(","),
  );
});

test("每个产图母版都有 PROVENANCE 声明", () => {
  const missing = [];
  for (const { rel, abs } of discoverFigureProducers()) {
    const text = fs.readFileSync(abs, "utf8");
    if (!parseProvenance(text)) missing.push(rel);
  }
  assert.deepEqual(missing, [], "以下产图母版缺 # PROVENANCE: 声明：" + missing.join(", "));
});

test("动态发现能认出非 *figures* 命名的产图母版（防回归到手写白名单）", () => {
  const discovered = discoverFigureProducers().map((r) => r.rel);
  // 这三份名字里不带 figures，但真实调用 savefig / png( 产图
  for (const rel of ["line1_bulk/ml_hub_analysis", "line1_bulk/ppi_string", "line1_bulk/key_genes"]) {
    assert.ok(discovered.includes(rel), rel + " 应被动态发现纳管，实际未发现");
  }
});

test("注释行里的产图调用不算产图（避免注释假阳性）", () => {
  const tmp = fs.mkdtempSync(path.join(REPO, ".tmp", "prov-probe-"));
  const line = "# fig.savefig(x)" + String.fromCharCode(10) + "y <- 1";
  fs.writeFileSync(path.join(tmp, "probe"), line);
  // 直接验证判据函数对单行文本的行为
  assert.equal(
    discoverFigureProducers({ roots: [tmp] }).length,
    0,
    "纯注释里的 savefig 不应被判成产图母版",
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("门禁输出不再声称「全部」却漏审（覆盖率口径）", () => {
  const discovered = discoverFigureProducers();
  assert.ok(discovered.length >= 22, "当前仓库实测产图母版 >= 22，实际 " + discovered.length);
  assert.equal(
    FIGURE_SCRIPTS.length,
    discovered.length,
    "登记数必须等于实测产图母版数",
  );
});
