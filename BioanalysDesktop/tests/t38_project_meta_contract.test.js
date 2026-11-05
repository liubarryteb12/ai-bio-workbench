/**
 * T3-8 契约：GET /api/projects/meta 的状态码与载荷（第 41 轮，Argon 第 40 轮判据）。
 *
 * 病灶（第 31 轮第四节实测）：磁盘上 local_projects/default/project.json 真实存在，
 * 但前端首屏请求 meta?project=default 时拿到 404，首屏因此拿不到项目元数据。
 *
 * 本文件钉死三条：
 *   正向：project.json 存在 -> 200，且载荷含 projectId / datasets / groupingDesign / analysisCutoffs；
 *   负向：项目不存在 -> 404；
 *   边界：含路径穿越的 id -> 400（由 sanitizeProjectId 拦截）。
 *
 * 载荷里的空值必须是 null/[]，不能是编出来的默认值：否则「没配」与「配了空」不可区分。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { handleProjectRoutes } from "../server/routes/projects.routes.js";

function makeDeps({ repoRoot, runRemote } = {}) {
  const seen = { json: [], remote: [] };
  const deps = {
    PORTAL_INBOX: "",
    deployDataFiles: () => {},
    isSafeManifestName: () => true,
    json: (res, status, payload) => { seen.json.push({ status, payload }); },
    lineFromPipeline: () => null,
    listInboxManifests: () => [],
    listProjectsWithMeta: () => [],
    readPackageManifest: () => null,
    runRemote: (cmd) => {
      seen.remote.push(cmd);
      return runRemote ? runRemote(cmd) : "";
    },
    runRemoteRaw: () => "",
    uploadPreparedFigureScripts: () => {},
    REPO_ROOT: repoRoot,
  };
  return { deps, seen };
}

function tmpRepoWithProject(id, payload) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t38meta-"));
  if (payload !== null) {
    const dir = path.join(root, "local_projects", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(payload, null, 2));
  }
  return root;
}

const FULL_META = {
  schema_version: 1,
  project_id: "demo",
  name: "演示项目",
  data_source: {
    data_source_mode: "PUBLIC_DB",
    datasets: [{ gse: "GSE245825", gpl: "GPL24676", role: "train" }],
  },
  grouping_design: {
    mode: "two_group",
    groups: [{ name: "DCM", n: 58 }, { name: "Ctrl", n: 12 }],
    contrasts: [{ case: "DCM", ctrl: "Ctrl", isPrimary: true }],
  },
  analysis_cutoffs: { log2fc: 1.0, padj: 0.05 },
  plot_layout_config: { width: 8 },
  pipeline_dag: [{ id: "s1" }, { id: "s2" }],
};

async function callMeta(query, deps) {
  await handleProjectRoutes({}, {}, new URL("http://x/api/projects/meta" + query), deps);
}

test("T3-8 正向：project.json 存在时回 200 且载荷含核心元数据", async () => {
  const root = tmpRepoWithProject("demo", FULL_META);
  const { deps, seen } = makeDeps({ repoRoot: root });
  await callMeta("?project=demo", deps);
  assert.equal(seen.json.length, 1, "必须恰好写一次响应");
  const { status, payload } = seen.json[0];
  assert.equal(status, 200, "项目存在时必须 200，不是 404");
  assert.equal(payload.projectId, "demo");
  assert.equal(payload.projectName, "演示项目");
  assert.equal(payload.schemaVersion, 1);
  assert.deepEqual(payload.datasets, FULL_META.data_source.datasets);
  assert.deepEqual(payload.groupingDesign, FULL_META.grouping_design);
  assert.deepEqual(payload.analysisCutoffs, FULL_META.analysis_cutoffs);
  assert.equal(payload.dataSourceMode, "PUBLIC_DB");
  assert.equal(payload.stepCount, 2);
});

test("T3-8 负向：项目不存在必须回 404", async () => {
  const root = tmpRepoWithProject("demo", FULL_META);
  const { deps, seen } = makeDeps({ repoRoot: root });
  await callMeta("?project=absent", deps);
  assert.equal(seen.json.length, 1);
  assert.equal(seen.json[0].status, 404, "不存在的项目必须 404，不能回 200 空对象");
});

test("T3-8 边界：路径穿越 id 由 sanitizeProjectId 拦成 400", async () => {
  for (const bad of ["../etc", "..", ".", "a/b", ""]) {
    const root = tmpRepoWithProject("demo", FULL_META);
    const { deps, seen } = makeDeps({ repoRoot: root });
    await callMeta("?project=" + encodeURIComponent(bad), deps);
    assert.equal(seen.json[0]?.status, 400, "非法 id " + JSON.stringify(bad) + " 必须 400");
    // 关键：400 不能被降级成 404。删掉 sanitize 的 400 分支后，null 会一路走到
    // "项目不存在" 分支回 404，此时只看「非 200」会漏判，所以两条都要钉死。
    assert.notEqual(seen.json[0]?.status, 404, "非法 id 是参数错误（400），不是项目不存在（404）");
    assert.equal(seen.remote.length, 0, "非法 id 不该下到远端（先消毒再执行）");
  }
});

test("T3-8 缺字段：没有 grouping_design 时给 null，不编默认值", async () => {
  const bare = { schema_version: 1, project_id: "bare", name: "裸项目" };
  const root = tmpRepoWithProject("bare", bare);
  const { deps, seen } = makeDeps({ repoRoot: root });
  await callMeta("?project=bare", deps);
  const { status, payload } = seen.json[0];
  assert.equal(status, 200);
  assert.equal(payload.groupingDesign, null, "没配就是 null，不能编一个空对象");
  assert.equal(payload.analysisCutoffs, null);
  assert.deepEqual(payload.datasets, [], "没有 datasets 给空数组，不是 undefined");
});

test("T3-8 优先级：远端有内容时以远端为准，本地不覆盖", async () => {
  const root = tmpRepoWithProject("demo", FULL_META);
  const remoteMeta = Buffer.from(JSON.stringify({
    ...FULL_META, name: "远端项目", plot_layout_config: { width: 99 },
  }), "utf8").toString("base64");
  const { deps, seen } = makeDeps({ repoRoot: root, runRemote: () => remoteMeta });
  await callMeta("?project=demo", deps);
  const { payload } = seen.json[0];
  assert.equal(payload.projectName, "远端项目", "远端是真源，本地只兜底");
  assert.deepEqual(payload.plotLayoutConfig, { width: 99 });
});