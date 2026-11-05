/**
 * route_dispatcher 契约单测（Q2，Argon 第 42 轮判据）。
 *
 * 对应三条变异反证：
 *   MUT-Q2-A：去掉写端点的 bodyLimit -> 路由表静态契约必须红
 *   MUT-Q2-B：跳过 querySchema 的 sanitize -> 路径穿越必须红（400 而非流入 service）
 *   MUT-Q2-C：路由表重复声明 -> 初始化自检必须当场抛错
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  validateRouteTable, validateQuery, dispatchRoutes, WRITE_METHODS,
} from "../server/route_dispatcher.js";

function makeCtx(pathname, { method = "GET", search = "", json, authRequired = false, isAuthorized } = {}) {
  const calls = [];
  const ctx = {
    req: { method },
    res: { headersSent: false },
    url: new URL("http://x" + pathname + search),
    json: json || ((res, status, payload) => { calls.push({ status, payload }); res.headersSent = true; }),
    authRequired,
    isAuthorized,
    runJsonRoute: (fn) => fn(),
  };
  return { ctx, calls };
}

const OK = [{ method: "GET", path: "/api/demo", handler: async () => {} }];

test("MUT-Q2-C：路由表重复声明在初始化时当场抛错", () => {
  assert.throws(
    () => validateRouteTable([...OK, { method: "GET", path: "/api/demo", handler: async () => {} }]),
    /路由重复声明/,
  );
});

test("MUT-Q2-A：写方法缺 bodyLimit 必须抛错（防绕过 1MB 上限）", () => {
  for (const m of WRITE_METHODS) {
    assert.throws(
      () => validateRouteTable([{ method: m, path: "/api/demo", handler: async () => {} }]),
      /必须显式声明 bodyLimit/,
      m + " 缺 bodyLimit 未被拦截",
    );
  }
  // 声明了就通过
  assert.equal(validateRouteTable([{ method: "POST", path: "/api/demo", bodyLimit: 1024, handler: async () => {} }]), true);
});

test("路由表基本校验：缺 method / path 非 /api 前缀 / 缺 handler 都抛", () => {
  assert.throws(() => validateRouteTable([{ path: "/api/x", handler: async () => {} }]), /缺 method/);
  assert.throws(() => validateRouteTable([{ method: "GET", path: "/other", handler: async () => {} }]), /必须以 \/api\/ 开头/);
  assert.throws(() => validateRouteTable([{ method: "GET", path: "/api/x" }]), /缺 handler/);
  assert.throws(() => validateRouteTable("nope"), /必须是数组/);
});

test("MUT-Q2-B：querySchema 的 projectId 必须过 sanitize，路径穿越回 400", () => {
  for (const bad of ["../etc", "..", ".", "a/b", "", "x".repeat(65)]) {
    const r = validateQuery(new URLSearchParams("project=" + encodeURIComponent(bad)), { project: "projectId" });
    assert.equal(r.ok, false, JSON.stringify(bad) + " 应被 sanitize 拦截");
    assert.equal(r.field, "project");
  }
  const good = validateQuery(new URLSearchParams("project=demo"), { project: "projectId" });
  assert.equal(good.ok, true);
  assert.equal(good.values.project, "demo");
});

test("分发器：未命中路径返回 false，不写响应", async () => {
  const { ctx, calls } = makeCtx("/api/absent");
  assert.equal(await dispatchRoutes(ctx, OK), false);
  assert.equal(calls.length, 0);
});

test("分发器：method 不匹配也返回 false", async () => {
  const { ctx, calls } = makeCtx("/api/demo", { method: "POST" });
  assert.equal(await dispatchRoutes(ctx, OK), false);
  assert.equal(calls.length, 0);
});

test("分发器：auth 层在参数校验之前（未认证先 401，不泄露参数错）", async () => {
  const routes = [{ method: "GET", path: "/api/demo", querySchema: { project: "projectId" }, handler: async () => {} }];
  const { ctx, calls } = makeCtx("/api/demo", {
    search: "?project=../etc", authRequired: true, isAuthorized: () => false,
  });
  assert.equal(await dispatchRoutes(ctx, routes), true);
  assert.equal(calls[0].status, 401, "未认证应 401 而不是先暴露 400 参数错");
});

test("分发器：参数非法回 400 且 handler 不被调用", async () => {
  let called = false;
  const routes = [{ method: "GET", path: "/api/demo", querySchema: { project: "projectId" },
    handler: async () => { called = true; } }];
  const { ctx, calls } = makeCtx("/api/demo", { search: "?project=../etc" });
  await dispatchRoutes(ctx, routes);
  assert.equal(calls[0].status, 400);
  assert.equal(called, false, "参数非法时 handler 不得执行");
});

test("分发器：handler 抛错收敛成 500，不让请求悬挂", async () => {
  const routes = [{ method: "GET", path: "/api/demo", handler: async () => { throw new Error("boom"); } }];
  const { ctx, calls } = makeCtx("/api/demo");
  await dispatchRoutes(ctx, routes);
  assert.equal(calls[0].status, 500);
  assert.match(calls[0].payload.error, /boom/);
});

test("MUT-Q2-A 运行时面：写端点必须真的走 collectJsonBody（body 被采集）", async () => {
  // 静态校验只证明表里写了 bodyLimit；这里验证分发器运行时真的用它采集请求体。
  // 若分发器跳过 bodyLimit 分支，handler 拿到的 body 会是 null，本断言即红。
  let gotBody = "NOT_CALLED";
  const routes = [{
    method: "POST", path: "/api/demo", bodyLimit: 1024,
    handler: async (c) => { gotBody = c.body; },
  }];
  const { ctx } = makeCtx("/api/demo", { method: "POST" });
  ctx.req = {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "9" },
    on: (event, fn) => {
      if (event === "data") fn(Buffer.from('{"a":1}'));
      if (event === "end") fn();
      return ctx.req;
    },
    destroy: () => {},
  };
  await dispatchRoutes(ctx, routes);
  assert.equal(gotBody, '{"a":1}', "写端点未经 collectJsonBody 采集请求体");
});

test("分发器：正常命中把 query 与 body 交给 handler", async () => {
  let got = null;
  const routes = [{ method: "GET", path: "/api/demo", querySchema: { project: "projectId" },
    handler: async (c) => { got = c.query; } }];
  const { ctx } = makeCtx("/api/demo", { search: "?project=demo" });
  await dispatchRoutes(ctx, routes);
  assert.deepEqual(got, { project: "demo" });
});