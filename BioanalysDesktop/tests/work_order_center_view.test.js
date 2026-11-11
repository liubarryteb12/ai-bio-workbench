/**
 * T4 作业中心视图最小契约。
 *
 * 判据：
 *   1. 视图文件存在且可被 esbuild 打包。
 *   2. 五态、加载态、错误态、空态锚点齐全。
 *   3. App 外壳挂载视图与导航项。
 *   4. 创建、执行、回执三个动作都有对应接口调用。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const VIEW = path.join(ROOT, "src", "views", "WorkOrderCenterView.tsx");
const APP = path.join(ROOT, "src", "App.tsx");
const OUT_DIR = path.join(ROOT, ".tmp", "work-order-center-view");

test("视图文件存在且包含五态与三态锚点", () => {
  assert.ok(fs.existsSync(VIEW), "缺少 WorkOrderCenterView.tsx");
  const src = fs.readFileSync(VIEW, "utf8");
  for (const status of ["queued", "running", "completed", "failed", "blocked"]) {
    assert.ok(src.includes(status), `视图缺少状态 ${status}`);
  }
  assert.match(src, /data-testid="loading-state"/);
  assert.match(src, /data-testid="error-state"/);
  assert.match(src, /data-error-kind="[a-z-]+"/);
  assert.match(src, /data-testid="empty-state"/);
  assert.match(src, /data-empty-kind="[a-z-]+"/);
  assert.match(src, /data-testid="work-order-status"/);
  assert.match(src, /data-testid="stage-timeline"/);
});

test("视图调用创建、执行、回执三个接口", () => {
  const src = fs.readFileSync(VIEW, "utf8");
  assert.ok(src.includes("/api/work-orders"), "缺少作业列表或创建接口");
  assert.ok(src.includes("/api/work-orders/queue"), "缺少队列接口");
  assert.ok(src.includes("/run"), "缺少执行接口");
  assert.ok(src.includes("/receipt"), "缺少回执接口");
  assert.match(src, /method:\s*'POST'/);
});

test("视图展示确认排队、队列位置与 3 秒轮询", () => {
  const src = fs.readFileSync(VIEW, "utf8");
  assert.ok(src.includes("确认并排队"), "执行按钮未改为确认并排队");
  assert.match(src, /setInterval\([\s\S]*?3000/);
  assert.match(src, /data-testid="queue-panel"/);
  assert.match(src, /data-testid="empty-state"[\s\S]*?data-empty-kind="queue"/);
  assert.ok(src.includes("queue_position"), "详情未展示队列位置");
});

test("App 外壳挂载作业中心导航与视图", () => {
  const src = fs.readFileSync(APP, "utf8");
  assert.ok(src.includes("WorkOrderCenterView"), "App 未导入作业中心视图");
  assert.ok(src.includes("作业中心"), "App 未加入作业中心导航项");
  assert.match(src, /view === 'work-orders'/);
});

test("视图可被 esbuild 打包（语法与导入闭合）", async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const entry = path.join(OUT_DIR, "entry.tsx");
  fs.writeFileSync(entry, [
    "import { WorkOrderCenterView } from '../../src/views/WorkOrderCenterView';",
    "export { WorkOrderCenterView };",
    "",
  ].join("\n"), "utf8");
  const outfile = path.join(OUT_DIR, "bundle.mjs");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(outfile).href);
  assert.equal(typeof mod.WorkOrderCenterView, "function");
});
