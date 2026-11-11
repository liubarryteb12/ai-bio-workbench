/**
 * T7 工单队列契约：磁盘 meta 派生队列、单并发 FIFO、审核即入队、重启恢复。
 *
 * 判据：
 *   1. 列表按 created_at 升序，待执行队列只含 approved 且 queued 的作业。
 *   2. 泵按 created_at 顺序逐个执行，单并发不重叠。
 *   3. 重复确认幂等，running 返回执行中，终态返回 409。
 *   4. 单个作业失败后泵继续取下一个。
 *   5. 启动时把无 inflight 的 running 作业标 failed，并写 recovery_reason。
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createWorkOrder,
  enqueueWorkOrder,
  getWorkOrderMeta,
  listQueue,
  listWorkOrders,
  startQueue,
  stopQueue,
} from "../server/services/work_order.service.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "work-orders-queue-"));
}

function draft(workOrderId, projectId) {
  return {
    schema_version: "work_order/v2",
    work_order_id: workOrderId,
    project_id: projectId,
    source_package: {
      package_dir: "PKG_20261110_120000_queue",
      requirement_path: "PKG_20261110_120000_queue/requirement.json",
      manifest_path: "PKG_20261110_120000_queue/package_manifest.json",
    },
    requirement: {
      basicInfo: {
        name: "队列契约项目",
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
  };
}

function metaFile(root, projectId, workOrderId) {
  return path.join(
    root,
    "workspace",
    "projects",
    projectId,
    "work_orders",
    `${workOrderId}.meta.json`,
  );
}

function patchMeta(root, projectId, workOrderId, patch) {
  const file = metaFile(root, projectId, workOrderId);
  const meta = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, `${JSON.stringify({ ...meta, ...patch }, null, 2)}\n`, "utf8");
}

async function waitFor(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`等待超时：${label}`);
}

function createThree(root) {
  createWorkOrder(draft("WO-Q-A", "PRJ_Q_A"), root);
  createWorkOrder(draft("WO-Q-B", "PRJ_Q_B"), root);
  createWorkOrder(draft("WO-Q-C", "PRJ_Q_C"), root);
  patchMeta(root, "PRJ_Q_A", "WO-Q-A", { created_at: "2026-11-10T00:00:01.000Z" });
  patchMeta(root, "PRJ_Q_B", "WO-Q-B", { created_at: "2026-11-10T00:00:02.000Z" });
  patchMeta(root, "PRJ_Q_C", "WO-Q-C", { created_at: "2026-11-10T00:00:03.000Z" });
}

afterEach(async () => {
  await stopQueue();
});

test("列表与队列按 created_at 升序，队列只含 approved 且 queued", () => {
  const root = tempRoot();
  createThree(root);

  const rows = listWorkOrders(root);
  assert.deepEqual(rows.map((row) => row.work_order_id), ["WO-Q-A", "WO-Q-B", "WO-Q-C"]);

  enqueueWorkOrder("WO-Q-C", root, { approved: true });
  enqueueWorkOrder("WO-Q-A", root, { approved: true });
  enqueueWorkOrder("WO-Q-B", root, { approved: true });

  const queue = listQueue(root);
  assert.deepEqual(queue.map((row) => row.work_order_id), ["WO-Q-A", "WO-Q-B", "WO-Q-C"]);
  assert.deepEqual(queue.map((row) => row.position), [1, 2, 3]);
  assert.ok(queue.every((row) => row.status === "queued"));
});

test("泵按 FIFO 逐个执行，完成后自动接下一个", async () => {
  const root = tempRoot();
  createThree(root);
  const seen = [];

  startQueue(root, {
    idlePollMs: 10,
    runWorkOrderFn: async (order) => {
      seen.push(order.workOrderId);
      return { ok: true, status: "completed" };
    },
  });

  enqueueWorkOrder("WO-Q-C", root, { approved: true });
  enqueueWorkOrder("WO-Q-A", root, { approved: true });
  enqueueWorkOrder("WO-Q-B", root, { approved: true });

  await waitFor(
    () => listWorkOrders(root).every((row) => row.status === "completed"),
    "三个作业全部完成",
  );
  assert.deepEqual(seen, ["WO-Q-A", "WO-Q-B", "WO-Q-C"]);
  assert.equal(listQueue(root).length, 0);
});

test("单并发：前一个未完成时后一个保持 queued，且执行不重叠", async () => {
  const root = tempRoot();
  createWorkOrder(draft("WO-Q-A", "PRJ_Q_A"), root);
  createWorkOrder(draft("WO-Q-B", "PRJ_Q_B"), root);
  patchMeta(root, "PRJ_Q_A", "WO-Q-A", { created_at: "2026-11-10T00:00:01.000Z" });
  patchMeta(root, "PRJ_Q_B", "WO-Q-B", { created_at: "2026-11-10T00:00:02.000Z" });

  let active = 0;
  let maxActive = 0;
  const started = [];
  const gates = new Map();

  startQueue(root, {
    idlePollMs: 10,
    runWorkOrderFn: async (order) => {
      const id = order.workOrderId;
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(id);
      await new Promise((resolve) => gates.set(id, resolve));
      active -= 1;
      return { ok: true, status: "completed" };
    },
  });

  enqueueWorkOrder("WO-Q-A", root, { approved: true });
  enqueueWorkOrder("WO-Q-B", root, { approved: true });

  await waitFor(() => started.length === 1, "第一个作业开始执行");
  assert.equal(started[0], "WO-Q-A");
  assert.equal(getWorkOrderMeta("WO-Q-A", root).status, "running");
  assert.equal(getWorkOrderMeta("WO-Q-B", root).status, "queued");

  gates.get("WO-Q-A")();
  await waitFor(() => started.length === 2, "第二个作业开始执行");
  assert.equal(started[1], "WO-Q-B");

  gates.get("WO-Q-B")();
  await waitFor(
    () => listWorkOrders(root).every((row) => row.status === "completed"),
    "两个作业全部完成",
  );
  assert.equal(maxActive, 1);
});

test("重复确认幂等：queued 返回同一位置，running 返回执行中，终态 409", async () => {
  const root = tempRoot();
  createWorkOrder(draft("WO-Q-A", "PRJ_Q_A"), root);

  const first = enqueueWorkOrder("WO-Q-A", root, { approved: true });
  const second = enqueueWorkOrder("WO-Q-A", root, { approved: true });
  assert.equal(first.status, "queued");
  assert.equal(first.position, 1);
  assert.equal(second.status, "queued");
  assert.equal(second.position, 1);
  assert.equal(second.meta.approved_at, first.meta.approved_at);

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  startQueue(root, {
    idlePollMs: 10,
    runWorkOrderFn: async () => {
      await gate;
      return { ok: true, status: "completed" };
    },
  });

  await waitFor(() => getWorkOrderMeta("WO-Q-A", root).status === "running", "作业进入 running");
  const during = enqueueWorkOrder("WO-Q-A", root, { approved: true });
  assert.equal(during.status, "running");
  assert.equal(during.position, 0);

  release();
  await waitFor(() => getWorkOrderMeta("WO-Q-A", root).status === "completed", "作业完成");
  assert.throws(
    () => enqueueWorkOrder("WO-Q-A", root, { approved: true }),
    (cause) => cause.code === "ERR_WORK_ORDER_STATE" && cause.status === 409,
  );
});

test("单个作业失败后泵继续执行下一个", async () => {
  const root = tempRoot();
  createWorkOrder(draft("WO-Q-A", "PRJ_Q_A"), root);
  createWorkOrder(draft("WO-Q-B", "PRJ_Q_B"), root);
  patchMeta(root, "PRJ_Q_A", "WO-Q-A", { created_at: "2026-11-10T00:00:01.000Z" });
  patchMeta(root, "PRJ_Q_B", "WO-Q-B", { created_at: "2026-11-10T00:00:02.000Z" });

  const seen = [];
  startQueue(root, {
    idlePollMs: 10,
    runWorkOrderFn: async (order) => {
      seen.push(order.workOrderId);
      if (order.workOrderId === "WO-Q-A") return { ok: false, status: "failed" };
      return { ok: true, status: "completed" };
    },
  });

  enqueueWorkOrder("WO-Q-A", root, { approved: true });
  enqueueWorkOrder("WO-Q-B", root, { approved: true });

  await waitFor(
    () => getWorkOrderMeta("WO-Q-B", root).status === "completed",
    "失败后第二个作业仍被执行",
  );
  assert.deepEqual(seen, ["WO-Q-A", "WO-Q-B"]);
  assert.equal(getWorkOrderMeta("WO-Q-A", root).status, "failed");
});

test("启动恢复：running 无 inflight 标 failed 并写 recovery_reason，随后排空队列", async () => {
  const root = tempRoot();
  createWorkOrder(draft("WO-Q-OLD", "PRJ_Q_OLD"), root);
  createWorkOrder(draft("WO-Q-NEW", "PRJ_Q_NEW"), root);
  patchMeta(root, "PRJ_Q_OLD", "WO-Q-OLD", {
    status: "running",
    created_at: "2026-11-10T00:00:01.000Z",
  });
  patchMeta(root, "PRJ_Q_NEW", "WO-Q-NEW", { created_at: "2026-11-10T00:00:02.000Z" });
  enqueueWorkOrder("WO-Q-NEW", root, { approved: true });

  const seen = [];
  startQueue(root, {
    idlePollMs: 10,
    runWorkOrderFn: async (order) => {
      seen.push(order.workOrderId);
      return { ok: true, status: "completed" };
    },
  });

  const old = getWorkOrderMeta("WO-Q-OLD", root);
  assert.equal(old.status, "failed");
  assert.equal(old.recovery_reason, "server_restart");

  await waitFor(
    () => getWorkOrderMeta("WO-Q-NEW", root).status === "completed",
    "恢复后队列继续执行",
  );
  assert.deepEqual(seen, ["WO-Q-NEW"]);
});

test("工单文件损坏：泵把作业标 failed 并继续执行下一个", async () => {
  const root = tempRoot();
  createWorkOrder(draft("WO-Q-BAD", "PRJ_Q_BAD"), root);
  createWorkOrder(draft("WO-Q-GOOD", "PRJ_Q_GOOD"), root);
  patchMeta(root, "PRJ_Q_BAD", "WO-Q-BAD", { created_at: "2026-11-10T00:00:01.000Z" });
  patchMeta(root, "PRJ_Q_GOOD", "WO-Q-GOOD", { created_at: "2026-11-10T00:00:02.000Z" });
  fs.writeFileSync(
    path.join(root, "workspace", "projects", "PRJ_Q_BAD", "work_orders", "WO-Q-BAD.json"),
    "{ not json",
    "utf8",
  );
  enqueueWorkOrder("WO-Q-BAD", root, { approved: true });
  enqueueWorkOrder("WO-Q-GOOD", root, { approved: true });

  startQueue(root, {
    idlePollMs: 10,
    runWorkOrderFn: async () => ({ ok: true, status: "completed" }),
  });

  await waitFor(
    () => getWorkOrderMeta("WO-Q-GOOD", root).status === "completed",
    "损坏作业之后的作业仍被执行",
  );
  const bad = getWorkOrderMeta("WO-Q-BAD", root);
  assert.equal(bad.status, "failed");
  assert.equal(bad.error.code, "ERR_WORK_ORDER_READ");
});
