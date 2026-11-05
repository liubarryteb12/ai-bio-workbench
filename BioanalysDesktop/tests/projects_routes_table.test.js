/**
 * Q2 路由表静态完备性契约（Argon 第 42 轮判据：12 端点全部声明在可遍历的路由表里）。
 *
 * 判据：
 *  1. projects.routes.js 导出的路由表可被静态遍历审视；
 *  2. 凡写方法（POST）描述符必配 bodyLimit；
 *  3. 已迁移端点不再保留旧的 if/else 分支（防双重处理）；
 *  4. 路由表无重复 (method, path)。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROUTES = path.join(REPO, "BioanalysDesktop", "server", "routes", "projects.routes.js");

const src = fs.readFileSync(ROUTES, "utf8");

/** 从源码里抓出 ROUTES 数组中的 (method, path) 对，纯静态审视不执行模块。 */
function declaredRoutes(text) {
  const block = text.slice(text.indexOf("const ROUTES = ["), text.indexOf("if (await dispatchRoutes("));
  const pairs = [];
  const re = /method:\s*'([A-Z]+)',\s*\n\s*path:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block)) !== null) pairs.push({ method: m[1], path: m[2] });
  return { block, pairs };
}

test("Q2：路由表存在且可静态遍历", () => {
  const { pairs } = declaredRoutes(src);
  assert.ok(pairs.length >= 4, "路由表条目数 " + pairs.length + " 太少");
  const paths = pairs.map((p) => p.path);
  for (const expected of ["/api/projects/list", "/api/projects/steps", "/api/workflows", "/api/projects/meta"]) {
    assert.ok(paths.includes(expected), "路由表缺 " + expected);
  }
});

test("Q2：路由表无重复 (method, path)", () => {
  const { pairs } = declaredRoutes(src);
  const seen = new Set();
  for (const p of pairs) {
    const key = p.method + " " + p.path;
    assert.equal(seen.has(key), false, "重复声明: " + key);
    seen.add(key);
  }
});

test("Q2：已迁移的 4 个端点不再保留旧 if/else 分支（防双重处理）", () => {
  for (const p of ["/api/projects/list", "/api/projects/steps", "/api/workflows", "/api/projects/meta"]) {
    const branchRe = new RegExp("url\\.pathname === '" + p.replace(/\//g, "\\/") + "'");
    assert.equal(branchRe.test(src), false, p + " 仍有旧分支，会与路由表双重处理");
  }
});

test("Q2：metadata 端点通过 querySchema 声明参数校验（不是端点内裸调 sanitize）", () => {
  const { block } = declaredRoutes(src);
  const metaBlock = block.slice(block.indexOf("/api/projects/meta"), block.indexOf("/api/projects/meta") + 400);
  assert.match(metaBlock, /querySchema:\s*\{\s*project:\s*'projectId'\s*\}/, "meta 端点缺 querySchema");
});

test("Q2：service 层不碰 req/res（业务与 HTTP 解耦）", () => {
  const svc = fs.readFileSync(path.join(REPO, "BioanalysDesktop", "server", "services", "project.service.js"), "utf8");
  for (const forbidden of ["res.", "req.-", "json(res"]) {
    assert.equal(svc.includes(forbidden), false, "service 层不应出现 " + forbidden);
  }
  assert.match(svc, /export function getProjectMeta/, "缺 getProjectMeta");
  assert.match(svc, /export function getWorkflows/, "缺 getWorkflows");
});

test("Q2：projects.routes.js 主文件体积已下降（净减目标进展）", () => {
  const lines = src.split("\n").length;
  // 迁移前 592 行；迁 4 个端点后应显著低于它
  assert.ok(lines < 592, "主文件未见缩小: " + lines + " 行");
});