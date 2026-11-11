/**
 * T5 门户提交包到工单契约测试
 *
 * 守五件事：
 *   1. 合法提交包生成可过 work_order/v2 校验的草稿，inputs 覆盖数据文件与参考文献。
 *   2. 包路径、需求单、清单、数据文件任一不合规都 fail closed，并给出稳定错误码。
 *   3. manifest 声明的 size 与 sha256 必须和磁盘实际文件一致。
 *   4. dataType 到分析线的映射复用服务端唯一真源。
 *   5. service 与路由层都能从 PKG_ 包创建 queued 作业，越界路径在入口被拒。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { buildWorkOrderDraftFromPackage } from "../server/services/package_to_work_order.js";
import { createWorkOrderFromPackage } from "../server/services/work_order.service.js";
import { handleWorkOrdersRoutes } from "../server/routes/work_orders.routes.js";
import { acquireAuthority, closeAuthorityDatabase } from "../server/services/authority.service.js";
import { normalizeWorkOrderV2 } from "../../shared/work_order_v2.mjs";

const PKG = "PKG_2026-11-10_231500_测试项目";

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function baseRequirement(dataType = "microarray") {
  return {
    basicInfo: {
      name: "测试项目",
      species: "Homo sapiens",
      domain: "心脑血管",
      dataType,
    },
    dataSource: {
      source: "GEO",
      dataType,
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
  };
}

function makePackage(t, {
  dataType = "microarray",
  requirement = null,
  files = null,
  refs = null,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-to-wo-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inbox = path.join(root, "portal", "inbox");
  const pkgDir = path.join(inbox, PKG);
  fs.mkdirSync(path.join(pkgDir, "raw_data"), { recursive: true });
  fs.mkdirSync(path.join(pkgDir, "references"), { recursive: true });

  const requirementPayload = requirement || baseRequirement(dataType);
  fs.writeFileSync(
    path.join(pkgDir, "requirement.json"),
    JSON.stringify(requirementPayload, null, 2),
    "utf8",
  );

  const dataInputs = files || [
    { role: "train_matrix", name: "matrix.tsv", body: "gene\ts1\nA\t1\n" },
  ];
  const dataFiles = dataInputs.map((file) => {
    const archiveName = `${file.role}__${file.name}`;
    const to = `${PKG}/raw_data/${archiveName}`;
    const buffer = Buffer.from(file.body ?? `content-${file.name}`);
    fs.writeFileSync(path.join(pkgDir, "raw_data", archiveName), buffer);
    return {
      role: file.role,
      bind: file.bind || "",
      original_name: file.name,
      archive_name: archiveName,
      size: buffer.length,
      from: `uploads/sid/${file.name}`,
      to,
      sha256: sha256(buffer),
    };
  });

  const refInputs = refs || [{ name: "paper.pdf", body: "%PDF-1.4 test" }];
  const references = refInputs.map((ref, index) => {
    const archiveName = `${String(index + 1).padStart(2, "0")}_${ref.name}`;
    const to = `${PKG}/references/${archiveName}`;
    const buffer = Buffer.from(ref.body ?? `ref-${ref.name}`);
    fs.writeFileSync(path.join(pkgDir, "references", archiveName), buffer);
    return {
      from: `refs/sid/${ref.name}`,
      to,
      archiveName,
      originalName: ref.name,
      size: buffer.length,
      sha256: sha256(buffer),
    };
  });

  const manifest = {
    package_dir: PKG,
    created_at: new Date().toISOString(),
    requirement: `${PKG}/requirement.json`,
    counts: { data_files: dataFiles.length, references: references.length },
    data_files: dataFiles,
    references,
  };
  fs.writeFileSync(
    path.join(pkgDir, "package_manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  return { root, inbox, pkgDir, requirement: requirementPayload, manifest, dataFiles, references };
}

function buildOptions(fixture, overrides = {}) {
  return {
    repoRoot: fixture.root,
    inboxRoot: fixture.inbox,
    modIds: ["l1_ingest_prep"],
    ...overrides,
  };
}

test("合法提交包生成 v2 草稿，inputs 覆盖数据文件与参考文献", (t) => {
  const fixture = makePackage(t);
  const result = buildWorkOrderDraftFromPackage(fixture.pkgDir, buildOptions(fixture));

  assert.equal(result.ok, true, (result.errors || []).join("；"));
  const draft = result.draft;
  assert.equal(draft.schema_version, "work_order/v2");
  assert.equal(draft.project_id, "PRJ_20261110_231500");
  assert.equal(draft.work_order_id, "WO_20261110_231500");
  assert.equal(draft.execution.line_id, "line1_bulk");
  assert.equal(draft.execution.seed, 20261013);
  assert.equal(draft.execution.compute_adapter, "adb");
  assert.equal(draft.controls.require_admin_review, true);

  assert.equal(draft.inputs.length, 2);
  const dataInput = draft.inputs.find((item) => item.role === "train_matrix");
  assert.ok(dataInput, "缺少数据文件输入");
  assert.ok(dataInput.path.endsWith(fixture.manifest.data_files[0].to));
  assert.equal(dataInput.filename, fixture.manifest.data_files[0].archive_name);
  assert.equal(dataInput.size, fixture.manifest.data_files[0].size);
  assert.equal(dataInput.sha256, fixture.manifest.data_files[0].sha256);
  assert.equal(dataInput.format, "tsv");

  const refInput = draft.inputs.find((item) => item.role === "other");
  assert.ok(refInput, "缺少参考文献输入");
  assert.ok(refInput.path.endsWith(fixture.manifest.references[0].to));
  assert.equal(refInput.filename, fixture.manifest.references[0].archiveName);
  assert.equal(refInput.sha256, fixture.manifest.references[0].sha256);
  assert.equal(refInput.format, "pdf");

  assert.equal(draft.source_package.package_dir, PKG);
  assert.equal(draft.source_package.requirement_path, `${PKG}/requirement.json`);
  assert.equal(draft.source_package.manifest_path, `${PKG}/package_manifest.json`);
  assert.equal(
    draft.source_package.requirement_sha256,
    sha256(fs.readFileSync(path.join(fixture.pkgDir, "requirement.json"))),
  );
  assert.equal(
    draft.source_package.manifest_sha256,
    sha256(fs.readFileSync(path.join(fixture.pkgDir, "package_manifest.json"))),
  );

  const checked = normalizeWorkOrderV2(draft);
  assert.equal(checked.ok, true, checked.errors.join("；"));
});

test("缺 requirement.json 或 package_manifest.json 都按 ERR_PACKAGE_SHAPE 拒", (t) => {
  const missingRequirement = makePackage(t);
  fs.rmSync(path.join(missingRequirement.pkgDir, "requirement.json"));
  const first = buildWorkOrderDraftFromPackage(missingRequirement.pkgDir, buildOptions(missingRequirement));
  assert.equal(first.ok, false);
  assert.ok(first.codes.includes("ERR_PACKAGE_SHAPE"));

  const missingManifest = makePackage(t);
  fs.rmSync(path.join(missingManifest.pkgDir, "package_manifest.json"));
  const second = buildWorkOrderDraftFromPackage(missingManifest.pkgDir, buildOptions(missingManifest));
  assert.equal(second.ok, false);
  assert.ok(second.codes.includes("ERR_PACKAGE_SHAPE"));
});

test("需求单不合法按 ERR_PACKAGE_REQUIREMENT 拒", (t) => {
  const fixture = makePackage(t);
  const broken = baseRequirement();
  delete broken.basicInfo.name;
  fs.writeFileSync(
    path.join(fixture.pkgDir, "requirement.json"),
    JSON.stringify(broken, null, 2),
    "utf8",
  );

  const result = buildWorkOrderDraftFromPackage(fixture.pkgDir, buildOptions(fixture));
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes("ERR_PACKAGE_REQUIREMENT"));
  assert.ok(result.errors.some((line) => line.includes("basicInfo.name")));
});

test("manifest 哈希与磁盘不一致按 ERR_PACKAGE_HASH 拒", (t) => {
  const fixture = makePackage(t);
  const file = path.join(fixture.pkgDir, "raw_data", fixture.dataFiles[0].archive_name);
  const bytes = fs.readFileSync(file);
  bytes[0] = bytes[0] === 0x41 ? 0x42 : 0x41;
  fs.writeFileSync(file, bytes);

  const result = buildWorkOrderDraftFromPackage(fixture.pkgDir, buildOptions(fixture));
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes("ERR_PACKAGE_HASH"));
});

test("manifest 指向的数据文件缺失按 ERR_PACKAGE_FILE 拒", (t) => {
  const fixture = makePackage(t);
  fs.rmSync(path.join(fixture.pkgDir, "raw_data", fixture.dataFiles[0].archive_name));

  const result = buildWorkOrderDraftFromPackage(fixture.pkgDir, buildOptions(fixture));
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes("ERR_PACKAGE_FILE"));
});

test("dataType 映射到固定分析线", (t) => {
  const cases = [
    ["microarray", "line1_bulk"],
    ["bulk_rnaseq", "line1_bulk"],
    ["scrna", "line2_scrna"],
    ["spatial", "line3_spatial"],
  ];
  for (const [dataType, lineId] of cases) {
    const fixture = makePackage(t, { dataType });
    const result = buildWorkOrderDraftFromPackage(
      fixture.pkgDir,
      buildOptions(fixture, { modIds: ["line_probe_mod"] }),
    );
    assert.equal(result.ok, true, `${dataType}: ${(result.errors || []).join("；")}`);
    assert.equal(result.draft.execution.line_id, lineId, dataType);
  }
});

test("显式 line_id 与 dataType 映射不一致按 ERR_PACKAGE_LINE_MISMATCH 拒", (t) => {
  const fixture = makePackage(t, { dataType: "microarray" });
  const result = buildWorkOrderDraftFromPackage(
    fixture.pkgDir,
    buildOptions(fixture, { lineId: "line2_scrna" }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes("ERR_PACKAGE_LINE_MISMATCH"));
});

test("未显式给 mod_ids 按 ERR_PACKAGE_OPTIONS 拒", (t) => {
  const fixture = makePackage(t);
  const result = buildWorkOrderDraftFromPackage(fixture.pkgDir, {
    repoRoot: fixture.root,
    inboxRoot: fixture.inbox,
  });
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes("ERR_PACKAGE_OPTIONS"));

  const mixed = buildWorkOrderDraftFromPackage(fixture.pkgDir, buildOptions(fixture, {
    modIds: ["l1_ingest_prep", 42],
  }));
  assert.equal(mixed.ok, false);
  assert.ok(mixed.codes.includes("ERR_PACKAGE_OPTIONS"));
});

test("非 Ready 图件按 ERR_PACKAGE_FIGURE_NOT_READY 拒", (t) => {
  const requirement = baseRequirement();
  requirement.figure_templates = [{ template_id: "fig_not_ready_probe", adapt_vars: {} }];
  const fixture = makePackage(t, { requirement });

  const result = buildWorkOrderDraftFromPackage(fixture.pkgDir, buildOptions(fixture));
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes("ERR_PACKAGE_FIGURE_NOT_READY"));
});

test("包目录名不以 PKG_ 开头按 ERR_PACKAGE_SHAPE 拒", (t) => {
  const fixture = makePackage(t);
  const other = path.join(fixture.inbox, "not-a-package");
  fs.cpSync(fixture.pkgDir, other, { recursive: true });

  const result = buildWorkOrderDraftFromPackage(other, buildOptions(fixture));
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes("ERR_PACKAGE_SHAPE"));
});

test("service 从包创建 queued 作业，越界 package_dir 在入口拒", (t) => {
  const fixture = makePackage(t);
  const created = createWorkOrderFromPackage(PKG, fixture.root, {
    inboxRoot: fixture.inbox,
    modIds: ["l1_ingest_prep"],
  });

  assert.equal(created.meta.status, "queued");
  assert.equal(created.meta.work_order_id, "WO_20261110_231500");
  assert.equal(created.meta.project_id, "PRJ_20261110_231500");
  assert.equal(created.draft.inputs.length, 2);

  const orderFile = path.join(
    fixture.root,
    "workspace",
    "projects",
    created.meta.project_id,
    "work_orders",
    `${created.meta.work_order_id}.json`,
  );
  assert.ok(fs.existsSync(orderFile), "工单必须落盘");
  assert.deepEqual(JSON.parse(fs.readFileSync(orderFile, "utf8")), created.draft);

  assert.throws(
    () => createWorkOrderFromPackage("../PKG_evil", fixture.root, {
      inboxRoot: fixture.inbox,
      modIds: ["l1_ingest_prep"],
    }),
    (cause) => cause.code === "ERR_PACKAGE_DIR",
  );
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

test("路由 POST /api/work-orders/from-package 创建作业并回草稿", async (t) => {
  const fixture = makePackage(t);
  // 租约库放独立临时目录：SQLite 打开期间会锁住宿主目录，混在 fixture 里会让清理 EPERM。
  const authorityDir = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-lease-"));
  const authorityFile = path.join(authorityDir, "authority.sqlite");
  const actor = { kind: "local_dev", id: "test", role: "admin" };
  const { lease_id: leaseId } = acquireAuthority(actor, { file: authorityFile });
  t.after(() => {
    closeAuthorityDatabase(authorityFile);
    fs.rmSync(authorityDir, { recursive: true, force: true });
  });
  const response = fakeResponse();
  const request = Readable.from([Buffer.from(JSON.stringify({
    package_dir: PKG,
    mod_ids: ["l1_ingest_prep"],
  }), "utf8")]);
  request.method = "POST";
  request.headers = { "x-bio-lease-id": leaseId };

  const handled = await handleWorkOrdersRoutes(
    request,
    response.res,
    new URL("http://x/api/work-orders/from-package"),
    {
      json: response.json,
      REPO_ROOT: fixture.root,
      PORTAL_INBOX: fixture.inbox,
      authorityFile,
      actor,
    },
  );

  assert.equal(handled, true);
  assert.equal(response.state.status, 201);
  assert.equal(response.state.payload.ok, true);
  assert.equal(response.state.payload.work_order.status, "queued");
  assert.equal(response.state.payload.draft.execution.line_id, "line1_bulk");
});

test("路由拒绝越界 package_dir", async (t) => {
  const authorityDir = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-lease-"));
  const authorityFile = path.join(authorityDir, "authority.sqlite");
  const actor = { kind: "local_dev", id: "test", role: "admin" };
  const { lease_id: leaseId } = acquireAuthority(actor, { file: authorityFile });
  t.after(() => {
    closeAuthorityDatabase(authorityFile);
    fs.rmSync(authorityDir, { recursive: true, force: true });
  });
  const response = fakeResponse();
  const request = Readable.from([Buffer.from(JSON.stringify({
    package_dir: "../PKG_evil",
    mod_ids: ["l1_ingest_prep"],
  }), "utf8")]);
  request.method = "POST";
  request.headers = { "x-bio-lease-id": leaseId };

  const handled = await handleWorkOrdersRoutes(
    request,
    response.res,
    new URL("http://x/api/work-orders/from-package"),
    { json: response.json, REPO_ROOT: os.tmpdir(), authorityFile, actor },
  );

  assert.equal(handled, true);
  assert.equal(response.state.status, 400);
  assert.equal(response.state.payload.code, "ERR_PACKAGE_DIR");
});
