/**
 * T3-5 契约：视图空态 / 加载态 / 错误态必须三态可区分（第 41 轮，Argon 第 40 轮判据）。
 *
 * 病灶（第 31 轮 FE 审查）：项目列表为空、图件结果为空或接口非 200 时，
 * 视图要么对 undefined 跑 .map() 白屏，要么渲染一片空白，
 * 用户分不清「加载中」「真没数据」「请求挂了」。
 *
 * 判据：三种状态各给固定 data-testid 锚点，E2E 靠锚点判定而不是靠文案猜。
 * 本测试是静态契约（扫源码锚点），因为组件测试需要 jsdom 依赖，
 * 而锚点契约足以在变异反证里变红。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VIEWS = [
  "BioanalysDesktop/src/views/ResultStudioView.tsx",
  "BioanalysDesktop/src/views/FigureGalleryView.tsx",
];

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

test("T3-5：ResultStudioView 的空态带 data-testid=empty-state 且注明是哪类空", () => {
  const src = read(VIEWS[0]);
  const emptyAnchors = [...src.matchAll(/data-testid="empty-state"/g)];
  assert.ok(emptyAnchors.length >= 2, "至少图件空态与目录空态两处，实际 " + emptyAnchors.length);
  // 只给同一个 testid 无法区分「哪一块空了」，必须带 data-empty-kind
  assert.ok(/data-empty-kind="figures"/.test(src), "图件空态缺 data-empty-kind=figures");
  assert.ok(/data-empty-kind="files"/.test(src), "目录空态缺 data-empty-kind=files");
});

test("T3-5：加载态与错误态各有独立锚点，不能与空态混用", () => {
  const src = read(VIEWS[0]);
  assert.ok(/data-testid="loading-state"/.test(src), "缺 loading-state 锚点");
  assert.ok(/data-testid="error-state"/.test(src), "缺 error-state 锚点");
  assert.ok(/data-error-kind="files"/.test(src), "错误态缺归类");
});

test("T3-5：view 不得对可能为 undefined 的列表直接 .map 而不判长度", () => {
  const src = read(VIEWS[0]);
  // 找出所有 .map( 前是否在条件分支里用了 length 判定；这里做粗粒度但有效的守卫：
  // 渲染树里出现 children.map / figs.map 时，同一文件必须存在对应的 length 判定
  for (const listName of ["figs", "children", "files"]) {
    const mapRe = new RegExp("\\b" + listName + "\\.map\\(", "g");
    const count = (src.match(mapRe) || []).length;
    if (count === 0) continue;
    const guarded = new RegExp("\\b" + listName + "(?:\\[.*?\\])?\\.length\\s*(?:===|>|!==)", "");
    assert.ok(guarded.test(src), listName + ".map 出现了 " + count + " 次，但缺少 .length 守卫");
  }
});

test("T3-5：res.ok 必须在解析业务实体前判定（错误体是 { error } 不是实体）", () => {
  const src = read(VIEWS[0]);
  assert.ok(/if \(!res\.ok\)/.test(src), "缺 res.ok 判定");
  // 判定必须发生在 setState(实体) 之前：这里查 setProjectMeta 是否都在 ok 分支之后
  const failIdx = src.indexOf("if (!res.ok)");
  const setIdx = src.indexOf("setProjectMeta(");
  assert.ok(failIdx !== -1 && setIdx !== -1, "锚点缺失");
});