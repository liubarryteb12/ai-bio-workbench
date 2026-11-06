/**
 * 全视图三态契约（梯队 3 P1/P2，Argon 第 65 轮 Q5 + 第 71 轮第 1 顺位）。
 *
 * 原契约硬编码四个视图，靠人工维护白名单。后果：
 *   - FigureGalleryView / ResultStudioView 虽已实现三态锚点，但从未被断言覆盖；
 *   - 将来新增第七个视图，只要没人记得往数组里加一行，它就永远裸奔。
 * 本契约改为**动态发现** src/views/*View.tsx，任何新视图自动入网。
 *
 * 判据（每个视图三条）：
 *   1. loading-state 锚点
 *   2. error-state 锚点 + data-error-kind 归类
 *   3. empty-state 锚点 + data-empty-kind 归类
 * 豁免必须显式登记理由，不允许静默跳过。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VIEWS_DIR = path.join(REPO, "BioanalysDesktop", "src", "views");

/**
 * 显式豁免：本文件不承载异步数据，没有三态可言。
 * 新增豁免必须写清理由，且理由会被打印出来供人复核。
 */
const EXEMPT = new Map([
  // 目前没有需要豁免的视图。如确有纯静态视图，在此登记 [文件名, 理由]。
]);

function discoverViews() {
  return fs
    .readdirSync(VIEWS_DIR)
    .filter((n) => n.endsWith("View.tsx"))
    .sort();
}

test("视图目录必须可发现且数量合理", () => {
  const views = discoverViews();
  assert.ok(views.length >= 6,
    "视图数量异常少（" + views.length + "），疑似目录读错：" + views.join(", "));
});

for (const name of discoverViews()) {
  const rel = path.join("BioanalysDesktop", "src", "views", name);
  const short = name.replace(/\.tsx$/, "");
  if (EXEMPT.has(name)) {
    test(short + "：豁免三态（理由：" + EXEMPT.get(name) + "）", () => {
      assert.ok(true);
    });
    continue;
  }

  test(short + "：加载态有 loading-state 锚点", () => {
    const src = fs.readFileSync(path.join(REPO, rel), "utf8");
    assert.match(src, /data-testid="loading-state"/,
      short + ' 缺 data-testid="loading-state"');
  });

  test(short + "：错误态有 error-state 锚点并带归类", () => {
    const src = fs.readFileSync(path.join(REPO, rel), "utf8");
    assert.match(src, /data-testid="error-state"/,
      short + " 缺 error-state 锚点");
    assert.match(src, /data-error-kind="[a-z-]+"/,
      short + " 的错误态缺 data-error-kind 归类");
  });

  test(short + "：空态有 empty-state 锚点并带归类", () => {
    const src = fs.readFileSync(path.join(REPO, rel), "utf8");
    assert.match(src, /data-testid="empty-state"/,
      short + " 缺 empty-state 锚点");
    assert.match(src, /data-empty-kind="[a-z-]+"/,
      short + " 的空态缺 data-empty-kind 归类");
  });
}

test("所有视图的 data-testid 三态命名必须一致（不得自创别名）", () => {
  const bad = [];
  for (const name of discoverViews()) {
    if (EXEMPT.has(name)) continue;
    const src = fs.readFileSync(path.join(REPO, "BioanalysDesktop", "src", "views", name), "utf8");
    const ids = [...src.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
    const suspect = ids.filter((id) => /state/i.test(id) && !/^(loading|empty|error)-state$/.test(id));
    if (suspect.length) bad.push(name + ": " + suspect.join(", "));
  }
  assert.deepEqual(bad, [], "存在自创的三态 testid 别名：\n" + bad.join("\n"));
});
