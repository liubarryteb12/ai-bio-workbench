/**
 * B1 产图脚本溯源集合恒等契约（Argon 第 71 轮清单）。
 *
 * 判据（Argon 原文）："在契约测试中动态扫描 src/line/scripts/*，
 * 凡含非注释产图落盘调用（savefig / gb_save / ggsave / R pdf(|png(|svg(）的脚本集合，
 * 必须与 ops/figure_source_provenance.mjs 的 FIGURE_SCRIPTS 双向集合恒等"。
 *
 * 为什么必须「双向」：
 *   - 扫描有、注册表无 => 有新产图脚本没登记溯源，门禁看不见它；
 *   - 注册表有、扫描无 => 注册表残留死条目，门禁在检查一个不存在的文件。
 * 两个方向任一不满足都说明门禁与真实产图面脱节。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIGURE_SCRIPTS, SCRIPT_LINES, FIGURE_CALL_RE } from "../../ops/figure_source_provenance.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function independentScan() {
  const found = [];
  for (const line of SCRIPT_LINES) {
    const dir = path.join(REPO, "tools", "bio", line, "scripts");
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name === "README.md") continue;
      if (/\.(py|R|sh|md|json|tsv|csv)$/i.test(e.name)) continue;
      const text = fs.readFileSync(path.join(dir, e.name), "utf8");
      const produces = text.split(/\r?\n/).some((raw) => {
        const hashAt = raw.indexOf("#");
        const code = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
        return FIGURE_CALL_RE.test(code);
      });
      if (produces) found.push(line + "/" + e.name);
    }
  }
  return found.sort();
}

test("产图脚本集合必须与溯源注册表双向恒等", () => {
  const scanned = independentScan();
  const registry = [...FIGURE_SCRIPTS].sort();
  const missingInRegistry = scanned.filter((x) => !registry.includes(x));
  const missingOnDisk = registry.filter((x) => !scanned.includes(x));
  assert.deepEqual(missingInRegistry, [],
    "这些脚本真的在产图，但没登记进 FIGURE_SCRIPTS（门禁看不见它们）：" + missingInRegistry.join(", "));
  assert.deepEqual(missingOnDisk, [],
    "注册表里有这些条目，但扫不到对应产图脚本（死条目）：" + missingOnDisk.join(", "));
  assert.ok(scanned.length >= 20, "产图母版数量异常少：" + scanned.length);
});

test("每个产图脚本都必须有诚实溯源声明", () => {
  const bad = [];
  for (const rel of FIGURE_SCRIPTS) {
    // FIGURE_SCRIPTS 的 rel 形如 "line3_spatial/spatial_figures"，
    // 实际文件在 src/<line>/scripts/<script>，中间那层 scripts 必须补上。
    const [line, name] = rel.split("/");
    const text = fs.readFileSync(path.join(REPO, "tools", "bio", line, "scripts", name), "utf8");
    if (!/^\s*#\s*PROVENANCE:\s*(DERIVED|INSPIRED|INDEPENDENT)\b/m.test(text)) {
      bad.push(rel);
    }
  }
  assert.deepEqual(bad, [], "以下脚本缺 # PROVENANCE: 声明：" + bad.join(", "));
});
