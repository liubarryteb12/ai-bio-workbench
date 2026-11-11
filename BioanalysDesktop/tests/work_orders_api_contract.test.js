/**
 * T4 作业 API 契约：service 层状态机、落盘布局与路由描述符。
 *
 * 判据：
 *   1. 创建作业只写 queued 工单与元数据，目录固定。
 *   2. 执行只允许 queued 进入 running，终态与并发重入均拒。
 *   3. 列表只回安全字段，不泄漏绝对路径。
 *   4. 回执缺失给出稳定错误码。
 *   5. 重启恢复只把 running 标记为 failed。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import {
  createWorkOrder,
  enqueueWorkOrder,
  getReceipt,
  getWorkOrder,
  listWorkOrders,
  listQueue,
  markStaleRunning,
  runWorkOrderById,
} from "../server/services/work_order.service.js";
import {
  WORK_ORDER_ROUTES,
  handleWorkOrdersRoutes,
} from "../server/routes/work_orders.routes.js";
import { validateRouteTable } from "../server/route_dispatcher.js";
import { acquireAuthority, closeAuthorityDatabase } from "../server/services/authority.service.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "work-orders-api-"));
}

/** 状态变更端点需要有效租约：给每个用例发一张本地租约，测完关库。 */
function leaseFor(root) {
  const authorityFile = path.join(root, "authority.sqlite");
  const actor = { kind: "local_dev", id: "test", role: "admin" };
  const { lease_id: leaseId } = acquireAuthority(actor, { file: authorityFile });
  return { authorityFile, actor, headers: { "x-bio-lease-id": leaseId } };
}

function draft(overrides = {}) {
  return {
    schema_version: "work_order/v2",
    work_order_id: "WO-T4-001",
    project_id: "PRJ_T4_ALPHA",
    source_package: {
      package_dir: "PKG_20261110_120000_t4",
      requirement_path: "PKG_20261110_120000_t4/requirement.json",
      manifest_path: "PKG_20261110_120000_t4/package_manifest.json",
    },
    requirement: {
      basicInfo: {
        name: "T4 契约项目",
        species: "Homo sapiens",
        domain: "cardiovascular",
        dataType: "microarray",
      },
      dataSource: {
        source: "GEO",
        dataType: "microarray",
        sampleCount: 10,
        tissue: "blood",
        datasets: [{
          gse: "GSE000000",
          gpl: "GPL0000",
          role: "train",
          sampleCount: 10,
          tissue: "blood",
        }],
      },
      groupingDesign: {
        mode: "two_group",
        groups: [
          { groupName: "Control", role: "reference", sampleIds: ["GSM000001"] },
          { groupName: "Disease", role: "disease_stage", sampleIds: ["GSM000002"] },
        ],
        contrasts: [
          { name: "Disease_vs_Control", case: "Disease", ctrl: "Control", isPrimary: true },
        ],
      },
      analysisCutoffs: {
        profile: "standard",
        use_adj_p: true,
        log2fc_threshold: 1,
        adj_p_threshold: 0.05,
      },
      figure_templates: [],
    },
    inputs: [],
    execution: {
      line_id: "line1_bulk",
      mod_ids: ["l1_ingest_prep"],
      figure_selections: [],
      seed: 20261013,
      compute_adapter: "adb",
      allow_ssh: false,
      species_scope: ["Homo sapiens"],
    },
    delivery: {
      profile: "client_standard",
      report_md: "Analysis_Report.md",
      report_html: "Analysis_Report.html",
      delivery_tar_pattern: "Client_Delivery.tar.gz",
    },
    controls: {
      require_admin_review: true,
      resume: false,
      resume_since: null,
      force_report_build: false,
    },
    ...overrides,
  };
}

function workOrderDir(root, projectId) {
  return path.join(root, "workspace", "projects", projectId, "work_orders");
}

function receiptDir(root, projectId) {
  return path.join(root, "workspace", "projects", projectId, "report");
}

function writeReceipt(root, projectId, status = "completed") {
  const file = path.join(receiptDir(root, projectId), "receipt.v1.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const receipt = {
    schema_version: "receipt/v1",
    receipt_id: "0123456789abcdef01234567",
    work_order_digest: "0".repeat(64),
    work_order_id: "WO-T4-001",
    project_id: projectId,
    line_id: "line1_bulk",
    status,
    started_at: "2026-11-10T00:00:00.000Z",
    finished_at: "2026-11-10T00:01:00.000Z",
    failure_stage: status === "completed" ? null : "task_dispatch",
    source_schema_version: "work_order/v2",
    seed: 20261013,
    compute_adapter: "adb",
    dag: [],
    stages: [{ name: "validate", status: "passed", at: "2026-11-10T00:00:01.000Z" }],
    upload_receipts: [],
    task_receipts: [],
    acceptance: null,
    delivery: null,
    artifacts: [],
    summary: null,
    error: status === "completed" ? null : { code: "ERR_TASK_RECEIPT", message: "任务回执缺失" },
    sentinel: status === "completed" ? "PRODUCTIZATION_RECEIPT_OK" : null,
    producer: { name: "work_order_orchestrator", version: "1.0.0" },
  };
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2), "utf8");
  return { file, receipt };
}

test("创建作业：写 queued 工单与元数据，目录与字段固定", () => {
  const root = tempRoot();
  const result = createWorkOrder(draft(), root);

  assert.equal(result.meta.status, "queued");
  assert.equal(result.meta.work_order_id, "WO-T4-001");
  assert.equal(result.meta.project_id, "PRJ_T4_ALPHA");
  assert.equal(result.meta.line_id, "line1_bulk");
  assert.equal(
    result.meta.receipt_path,
    "workspace/projects/PRJ_T4_ALPHA/report/receipt.v1.json",
  );
  assert.match(result.meta.created_at, /^\d{4}-\d{2}-\d{2}T/);

  const orderFile = path.join(workOrderDir(root, "PRJ_T4_ALPHA"), "WO-T4-001.json");
  const metaFile = path.join(workOrderDir(root, "PRJ_T4_ALPHA"), "WO-T4-001.meta.json");
  assert.ok(fs.existsSync(orderFile), "工单文件必须落盘");
  assert.ok(fs.existsSync(metaFile), "元数据文件必须落盘");
  assert.deepEqual(JSON.parse(fs.readFileSync(orderFile, "utf8")), draft());
});

test("创建作业：非法版本与重复工单号均拒", () => {
  const root = tempRoot();
  assert.throws(
    () => createWorkOrder(draft({ schema_version: "work_order/v1" }), root),
    (cause) => cause.code === "ERR_WORK_ORDER_INVALID",
  );

  createWorkOrder(draft(), root);
  assert.throws(
    () => createWorkOrder(draft(), root),
    (cause) => cause.code === "ERR_WORK_ORDER_EXISTS",
  );
});

test("列表与读取：安全字段、项目过滤、原始工单可读", () => {
  const root = tempRoot();
  createWorkOrder(draft(), root);
  createWorkOrder(draft({
    work_order_id: "WO-T4-002",
    project_id: "PRJ_T4_BETA",
  }), root);

  const all = listWorkOrders(root);
  assert.equal(all.length, 2);
  for (const item of all) {
    assert.deepEqual(
      Object.keys(item).sort(),
      ["created_at", "line_id", "project_id", "status", "work_order_id"],
    );
    assert.equal(JSON.stringify(item).includes(root), false, "列表不得泄漏绝对路径");
  }

  const filtered = listWorkOrders(root, "PRJ_T4_BETA");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].work_order_id, "WO-T4-002");

  const loaded = getWorkOrder("WO-T4-001", root);
  assert.equal(loaded.project_id, "PRJ_T4_ALPHA");
  assert.equal(loaded.schema_version, "work_order/v2");
});

test("回执读取：缺失给稳定错误码", () => {
  const root = tempRoot();
  createWorkOrder(draft(), root);
  assert.throws(
    () => getReceipt("WO-T4-001", root),
    (cause) => cause.code === "ERR_RECEIPT_NOT_FOUND",
  );
});

test("执行状态机：未审核拒、queued 到 completed、重复执行拒", async () => {
  const root = tempRoot();
  createWorkOrder(draft(), root);

  await assert.rejects(
    () => runWorkOrderById("WO-T4-001", root, {
      runWorkOrderFn: async () => {
        throw new Error("未审核不应进入编排器");
      },
    }),
    (cause) => cause.code === "ERR_ADMIN_REVIEW_REQUIRED",
  );

  let received = null;
  const result = await runWorkOrderById("WO-T4-001", root, {
    approved: true,
    runWorkOrderFn: async (order) => {
      received = order;
      const { receipt } = writeReceipt(root, "PRJ_T4_ALPHA", "completed");
      return { ok: true, status: "completed", receiptV1: receipt };
    },
  });

  assert.equal(received.schema_version, "work_order/v1");
  assert.equal(received.sourceSchemaVersion, "work_order/v2");
  assert.equal(result.meta.status, "completed");
  assert.equal(result.meta.receipt_path, "workspace/projects/PRJ_T4_ALPHA/report/receipt.v1.json");
  assert.equal(getReceipt("WO-T4-001", root).status, "completed");

  await assert.rejects(
    () => runWorkOrderById("WO-T4-001", root, { approved: true }),
    (cause) => cause.code === "ERR_WORK_ORDER_STATE",
  );
});

test("审核即入队：approved 落盘，重复确认幂等，列表按 created_at 升序", () => {
  const root = tempRoot();
  createWorkOrder(draft(), root);
  createWorkOrder(draft({
    work_order_id: "WO-T4-002",
    project_id: "PRJ_T4_BETA",
  }), root);

  const first = enqueueWorkOrder("WO-T4-001", root, { approved: true });
  assert.equal(first.status, "queued");
  assert.equal(first.position, 1);
  assert.equal(first.meta.approved, true);
  assert.match(first.meta.approved_at, /^\d{4}-\d{2}-\d{2}T/);

  const again = enqueueWorkOrder("WO-T4-001", root, { approved: true });
  assert.equal(again.status, "queued");
  assert.equal(again.position, 1);
  assert.equal(again.meta.approved_at, first.meta.approved_at);

  assert.equal(listQueue(root).length, 1);
  const ids = listWorkOrders(root).map((row) => row.work_order_id);
  assert.deepEqual(ids, ["WO-T4-001", "WO-T4-002"]);
  assert.ok(listWorkOrders(root)[0].created_at <= listWorkOrders(root)[1].created_at);

  assert.throws(
    () => enqueueWorkOrder("WO-T4-002", root, { approved: false }),
    (cause) => cause.code === "ERR_ADMIN_REVIEW_REQUIRED",
  );
});

test("执行状态机：并发重入拒，失败与阻塞同步到元数据", async () => {
  const root = tempRoot();
  createWorkOrder(draft(), root);

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = runWorkOrderById("WO-T4-001", root, {
    approved: true,
    runWorkOrderFn: async () => {
      await gate;
      const { receipt } = writeReceipt(root, "PRJ_T4_ALPHA", "failed");
      return { ok: false, status: "failed", receiptV1: receipt };
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    () => runWorkOrderById("WO-T4-001", root, { approved: true }),
    (cause) => cause.code === "ERR_WORK_ORDER_STATE",
  );
  release();
  const result = await first;
  assert.equal(result.meta.status, "failed");

  createWorkOrder(draft({
    work_order_id: "WO-T4-003",
    project_id: "PRJ_T4_GAMMA",
    controls: { require_admin_review: false, resume: false, resume_since: null, force_report_build: false },
  }), root);
  const blocked = await runWorkOrderById("WO-T4-003", root, {
    runWorkOrderFn: async () => {
      const { receipt } = writeReceipt(root, "PRJ_T4_GAMMA", "blocked");
      return { ok: false, status: "blocked", receiptV1: receipt };
    },
  });
  assert.equal(blocked.meta.status, "blocked");
});

test("重启恢复：只把 running 标记为 failed，重复调用幂等", () => {
  const root = tempRoot();
  const { meta } = createWorkOrder(draft(), root);
  const metaFile = path.join(workOrderDir(root, meta.project_id), `${meta.work_order_id}.meta.json`);
  fs.writeFileSync(metaFile, JSON.stringify({ ...meta, status: "running" }, null, 2), "utf8");

  const first = markStaleRunning("WO-T4-001", "服务重启", root);
  assert.equal(first.status, "failed");
  assert.equal(first.stale_reason, "服务重启");

  const second = markStaleRunning("WO-T4-001", "再次调用", root);
  assert.equal(second.status, "failed");
  assert.equal(second.stale_reason, "服务重启");
});

test("路由描述符：静态表可校验，POST 声明 1MB 上限", () => {
  assert.equal(validateRouteTable(WORK_ORDER_ROUTES), true);
  const create = WORK_ORDER_ROUTES.find((route) => route.method === "POST" && route.path === "/api/work-orders");
  assert.ok(create, "缺少创建作业路由");
  assert.equal(create.bodyLimit, 1024 * 1024);
});

function fakeResponse() {
  const state = { status: null, payload: null, headersSent: false };
  const res = {
    get headersSent() { return state.headersSent; },
    set headersSent(value) { state.headersSent = value; },
    writeHead(status) { state.status = status; state.headersSent = true; },
    end() { state.headersSent = true; },
  };
  const json = (_res, status, payload) => {
    state.status = status;
    state.payload = payload;
    state.headersSent = true;
  };
  return { res, state, json };
}

test("路由冒烟：创建、列表、详情、回执与原始工单经 dispatcher 可达", async () => {
  const root = tempRoot();
  const lease = leaseFor(root);

  const createRes = fakeResponse();
  const createReq = Readable.from([Buffer.from(JSON.stringify(draft()), "utf8")]);
  createReq.method = "POST";
  createReq.headers = lease.headers;
  assert.equal(
    await handleWorkOrdersRoutes(
      createReq,
      createRes.res,
      new URL("http://x/api/work-orders"),
      { json: createRes.json, REPO_ROOT: root, authorityFile: lease.authorityFile, actor: lease.actor },
    ),
    true,
  );
  assert.equal(createRes.state.status, 201);
  assert.equal(createRes.state.payload.work_order.work_order_id, "WO-T4-001");

  const listRes = fakeResponse();
  assert.equal(
    await handleWorkOrdersRoutes(
      { method: "GET" },
      listRes.res,
      new URL("http://x/api/work-orders?project=PRJ_T4_ALPHA"),
      { json: listRes.json, REPO_ROOT: root },
    ),
    true,
  );
  assert.equal(listRes.state.payload.work_orders.length, 1);

  const detailRes = fakeResponse();
  assert.equal(
    await handleWorkOrdersRoutes(
      { method: "GET" },
      detailRes.res,
      new URL("http://x/api/work-orders/WO-T4-001"),
      { json: detailRes.json, REPO_ROOT: root },
    ),
    true,
  );
  assert.equal(detailRes.state.payload.work_order.status, "queued");
  assert.equal(detailRes.state.payload.queue_position, 0);

  const queueRes = fakeResponse();
  assert.equal(
    await handleWorkOrdersRoutes(
      { method: "GET" },
      queueRes.res,
      new URL("http://x/api/work-orders/queue"),
      { json: queueRes.json, REPO_ROOT: root },
    ),
    true,
  );
  assert.deepEqual(queueRes.state.payload.queue, []);

  enqueueWorkOrder("WO-T4-001", root, { approved: true });
  const queuedRes = fakeResponse();
  assert.equal(
    await handleWorkOrdersRoutes(
      { method: "GET" },
      queuedRes.res,
      new URL("http://x/api/work-orders/queue"),
      { json: queuedRes.json, REPO_ROOT: root },
    ),
    true,
  );
  assert.equal(queuedRes.state.payload.queue.length, 1);
  assert.equal(queuedRes.state.payload.queue[0].position, 1);

  const orderRes = fakeResponse();
  assert.equal(
    await handleWorkOrdersRoutes(
      { method: "GET" },
      orderRes.res,
      new URL("http://x/api/work-orders/WO-T4-001/work-order"),
      { json: orderRes.json, REPO_ROOT: root },
    ),
    true,
  );
  assert.equal(orderRes.state.payload.work_order.schema_version, "work_order/v2");

  writeReceipt(root, "PRJ_T4_ALPHA", "completed");
  const receiptRes = fakeResponse();
  assert.equal(
    await handleWorkOrdersRoutes(
      { method: "GET" },
      receiptRes.res,
      new URL("http://x/api/work-orders/WO-T4-001/receipt"),
      { json: receiptRes.json, REPO_ROOT: root },
    ),
    true,
  );
  assert.equal(receiptRes.state.payload.receipt.status, "completed");
});

test("路由冒烟：执行端点拒未确认，确认后进入队列", async () => {
  const root = tempRoot();
  const lease = leaseFor(root);
  createWorkOrder(draft(), root);

  const denied = fakeResponse();
  const deniedReq = Readable.from([Buffer.from(JSON.stringify({}), "utf8")]);
  deniedReq.method = "POST";
  deniedReq.headers = lease.headers;
  assert.equal(
    await handleWorkOrdersRoutes(
      deniedReq,
      denied.res,
      new URL("http://x/api/work-orders/WO-T4-001/run"),
      { json: denied.json, REPO_ROOT: root, authorityFile: lease.authorityFile, actor: lease.actor },
    ),
    true,
  );
  assert.equal(denied.state.status, 409);
  assert.equal(denied.state.payload.code, "ERR_ADMIN_REVIEW_REQUIRED");

  const confirmed = fakeResponse();
  const confirmedReq = Readable.from([Buffer.from(JSON.stringify({ confirm: true }), "utf8")]);
  confirmedReq.method = "POST";
  confirmedReq.headers = lease.headers;
  assert.equal(
    await handleWorkOrdersRoutes(
      confirmedReq,
      confirmed.res,
      new URL("http://x/api/work-orders/WO-T4-001/run"),
      { json: confirmed.json, REPO_ROOT: root, authorityFile: lease.authorityFile, actor: lease.actor },
    ),
    true,
  );
  assert.equal(confirmed.state.status, 202);
  assert.equal(confirmed.state.payload.status, "queued");
  assert.equal(confirmed.state.payload.position, 1);
  assert.equal(confirmed.state.payload.work_order.approved, true);
});

test("租约准入：缺 X-Bio-Lease-Id 的状态变更端点一律 409", async () => {
  const root = tempRoot();
  const lease = leaseFor(root);
  createWorkOrder(draft(), root);

  const cases = [
    { path: "/api/work-orders", body: draft() },
    { path: "/api/work-orders/WO-T4-001/run", body: { confirm: true } },
  ];
  for (const item of cases) {
    const response = fakeResponse();
    const request = Readable.from([Buffer.from(JSON.stringify(item.body), "utf8")]);
    request.method = "POST";
    const handled = await handleWorkOrdersRoutes(
      request,
      response.res,
      new URL(`http://x${item.path}`),
      { json: response.json, REPO_ROOT: root, authorityFile: lease.authorityFile, actor: lease.actor },
    );
    assert.equal(handled, true);
    assert.equal(response.state.status, 409, item.path);
    assert.equal(response.state.payload.code, "ERR_AUTHORITY_REQUIRED", item.path);
  }

  // 读接口不受租约约束
  const readRes = fakeResponse();
  assert.equal(
    await handleWorkOrdersRoutes(
      { method: "GET" },
      readRes.res,
      new URL("http://x/api/work-orders"),
      { json: readRes.json, REPO_ROOT: root, authorityFile: lease.authorityFile, actor: lease.actor },
    ),
    true,
  );
  assert.equal(readRes.state.status, 200);
});
