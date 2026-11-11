/**
 * 四视图三态契约（梯队 3 P2，Argon 第 65 轮 Q5 裁定）。
 *
 * 裁定：趁 941e92e 刚打通 FigureGalleryView 三态锚点，把其余四视图
 * （LedgerAuditView / OnboardingView / SelfCheckAdminView）的
 * Loading / Empty / Error data-testid 与 CSS 变量收齐，可测性强且零业务破坏风险。
 *
 * 判据：每个视图必须给出三态各自独立的锚点，并带归类属性，
 * 让 E2E 靠锚点判定而非靠中文文案猜。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 四视图 + 各自的空态归类键（data-empty-kind）。 */
const VIEWS = [
  { rel: "BioanalysDesktop/src/views/LedgerAuditView.tsx", kind: "ledger" },
  { rel: "BioanalysDesktop/src/views/OnboardingView.tsx", kind: "projects" },
  { rel: "BioanalysDesktop/src/views/SelfCheckAdminView.tsx", kind: "selfcheck" },
];

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

for (const v of VIEWS) {
  const name = path.basename(v.rel, ".tsx");

  test(name + "：加载态有 loading-state 锚点", () => {
    const src = read(v.rel);
    assert.ok(
      /data-testid="loading-state"/.test(src),
      name + " 缺 data-testid=\"loading-state\"",
    );
  });

  test(name + "：错误态有 error-state 锚点并带归类", () => {
    const src = read(v.rel);
    assert.ok(/data-testid="error-state"/.test(src), name + " 缺 error-state 锚点");
    assert.ok(
      new RegExp('data-error-kind="[a-z-]+"').test(src),
      name + " 的错误态缺 data-error-kind 归类",
    );
  });

  test(name + "：空态有 empty-state 锚点并带归类 " + v.kind, () => {
    const src = read(v.rel);
    assert.ok(/data-testid="empty-state"/.test(src), name + " 缺 empty-state 锚点");
    assert.ok(
      new RegExp('data-empty-kind="' + v.kind + '"').test(src),
      name + " 的空态缺 data-empty-kind=\"" + v.kind + "\"",
    );
  });
}

test("三态锚点互斥：loading / error / empty 不共用同一个 data-testid", () => {
  for (const v of VIEWS) {
    const src = read(v.rel);
    const ids = [...src.matchAll(/data-testid="([a-z-]+-state)"/g)].map((m) => m[1]);
    const unique = new Set(ids);
    assert.equal(
      unique.size,
      ids.length,
      path.basename(v.rel) + " 三态锚点重复，无法区分状态：" + ids.join(","),
    );
  }
});

test("app.css 已建立 :root 变量底座（P1）", () => {
  const css = read("BioanalysDesktop/src/app.css");
  assert.ok(/:root\s*\{/.test(css), "app.css 缺 :root 变量块");
  const varCount = (css.match(/--[a-z0-9-]+\s*:/g) || []).length;
  assert.ok(varCount >= 12, "CSS 变量应至少 12 个，实际 " + varCount);
});

test("app.css 高频色已变量化：色值字面量不得再重复出现 10 次以上", () => {
  const css = read("BioanalysDesktop/src/app.css");
  const counts = new Map();
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const k = m[0].toLowerCase();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const offenders = [...counts.entries()].filter(([, n]) => n >= 10)
    .map(([c, n]) => c + " x" + n);
  assert.deepEqual(offenders, [], "以下色值字面量仍高频重复（应改用变量）：" + offenders.join(", "));
});
