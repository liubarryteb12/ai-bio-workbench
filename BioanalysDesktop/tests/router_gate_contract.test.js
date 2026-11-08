/**
 * 路由门禁契约：正向放行 + 四类负向必须报红。
 *
 * 隔离要求（REJ-010）：所有改动都发生在 mkdtemp 出来的临时树里，
 * 真实仓库文件一个字节都不动，因此可以并发跑。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkRouterAndScope } from "../../tools/dev/router_gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "router-gate-" + process.pid + "-"));
  fs.mkdirSync(path.join(root, "tools", "ops"), { recursive: true });
  fs.mkdirSync(path.join(root, "tools", "bio"), { recursive: true });
  fs.mkdirSync(path.join(root, "tools", "dev"), { recursive: true });
  fs.mkdirSync(path.join(root, "tools", "reporting"), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, "tools", "ops"))) {
    if (f.endsWith(".mjs")) {
      fs.copyFileSync(path.join(REPO, "tools", "ops", f), path.join(root, "tools", "ops", f));
    }
  }
  for (const f of fs.readdirSync(path.join(REPO, "tools", "dev"))) {
    if (f.endsWith(".mjs")) {
      fs.copyFileSync(path.join(REPO, "tools", "dev", f), path.join(root, "tools", "dev", f));
    }
  }
  for (const f of fs.readdirSync(path.join(REPO, "tools", "reporting"))) {
    if (f.endsWith(".mjs")) {
      fs.copyFileSync(path.join(REPO, "tools", "reporting", f), path.join(root, "tools", "reporting", f));
    }
  }
  fs.copyFileSync(path.join(REPO, "ROUTER.yaml"), path.join(root, "ROUTER.yaml"));
  fs.copyFileSync(path.join(REPO, "SCOPE.md"), path.join(root, "SCOPE.md"));
  fs.copyFileSync(path.join(REPO, "tools/bio/workflows.json"), path.join(root, "tools", "bio", "workflows.json"));
  return root;
}

test("真实仓库必须通过", () => {
  const { errs } = checkRouterAndScope(REPO);
  assert.deepEqual(errs, [], "真实仓库不该有错：" + errs.join("; "));
});

test("负向：enforced_by 指向不存在的门禁必须报红", (t) => {
  const root = makeTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = path.join(root, "SCOPE.md");
  const md = fs.readFileSync(p, "utf8").replace(
    "enforced_by: tools/dev/mutation_gate.mjs",
    "enforced_by: tools/dev/this_gate_does_not_exist.mjs"
  );
  fs.writeFileSync(p, md, "utf8");
  const { errs } = checkRouterAndScope(root);
  assert.ok(
    errs.some((e) => e.includes("this_gate_does_not_exist")),
    "必须点名不存在的门禁，实际：" + errs.join("; ")
  );
});

test("负向：allowed_scripts 引用不存在的脚本必须报红", (t) => {
  const root = makeTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = path.join(root, "ROUTER.yaml");
  fs.writeFileSync(
    p,
    fs.readFileSync(p, "utf8").replace(
      '      - "l3_branches_celltype"',
      '      - "l3_branches_celltype"\n      - "l3_ghost_mod"'
    ),
    "utf8"
  );
  const { errs } = checkRouterAndScope(root);
  assert.ok(errs.some((e) => e.includes("l3_ghost_mod")), "必须点名不存在的 Mod");
});

test("负向：target_line_or_gate 指向不存在的线必须报红", (t) => {
  const root = makeTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = path.join(root, "ROUTER.yaml");
  fs.writeFileSync(
    p,
    fs.readFileSync(p, "utf8").replace(
      '    target_line_or_gate: "line3_spatial"',
      '    target_line_or_gate: "line9_ghost"'
    ),
    "utf8"
  );
  const { errs } = checkRouterAndScope(root);
  assert.ok(errs.some((e) => e.includes("line9_ghost")), "必须点名不存在的线");
});

test("负向：路由 id 重复必须报红", (t) => {
  const root = makeTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = path.join(root, "ROUTER.yaml");
  fs.writeFileSync(
    p,
    fs.readFileSync(p, "utf8").replace('id: "route-l3-deconv"', 'id: "route-l3-domains"'),
    "utf8"
  );
  const { errs } = checkRouterAndScope(root);
  assert.ok(errs.some((e) => e.includes("id 重复")), "必须报 id 重复");
});
test("负向：YAML 标量陷阱必须被交叉校验抓到（NO 被官方解析器转成布尔）", (t) => {
  const root = makeTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = path.join(root, "ROUTER.yaml");
  // 故意不加引号：自写解析器保持字符串 "NO"，PyYAML 会转成 False
  fs.writeFileSync(
    p,
    fs.readFileSync(p, "utf8").replace('      - "解卷积"', "      - NO"),
    "utf8"
  );
  const { errs } = checkRouterAndScope(root);
  assert.ok(
    errs.some((e) => e.includes("标量陷阱")),
    "必须报出标量陷阱，实际：" + errs.join("; ")
  );
});
test("负向：REJ 的 status 非法必须报红", (t) => {
  const root = makeTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = path.join(root, "SCOPE.md");
  fs.writeFileSync(
    p,
    fs.readFileSync(p, "utf8").replace("| 生效 | Argon 第 41 轮 |", "| 也许生效 | Argon 第 41 轮 |"),
    "utf8"
  );
  const { errs } = checkRouterAndScope(root);
  assert.ok(errs.some((e) => e.includes("status 非法")), "必须报 status 非法：" + errs.join("; "));
});

test("负向：已撤销但不写被替代者必须报红", (t) => {
  const root = makeTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = path.join(root, "SCOPE.md");
  fs.writeFileSync(
    p,
    fs.readFileSync(p, "utf8").replace("| 生效 | Argon 第 41 轮 | 无 |", "| 已撤销 | Argon 第 41 轮 | 无 |"),
    "utf8"
  );
  const { errs } = checkRouterAndScope(root);
  assert.ok(errs.some((e) => e.includes("未写明被替代者")), "必须报未写被替代者：" + errs.join("; "));
});

test("负向：REJ 缺 expires_at 必须报红", (t) => {
  const root = makeTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = path.join(root, "SCOPE.md");
  fs.writeFileSync(
    p,
    fs.readFileSync(p, "utf8").replace("| 2027-05-01 |", "| |"),
    "utf8"
  );
  const { errs } = checkRouterAndScope(root);
  assert.ok(errs.some((e) => e.includes("缺 expires_at")), "必须报缺 expires_at：" + errs.join("; "));
});

test("负向 (MUT-P0-A)：REJ 的 expires_at 超过 180 天上限必须报红", (t) => {
  const root = makeTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = path.join(root, "SCOPE.md");
  fs.writeFileSync(
    p,
    fs.readFileSync(p, "utf8").replace("| 2027-05-01 |", "| 2029-01-01 |"),
    "utf8"
  );
  const { errs } = checkRouterAndScope(root);
  assert.ok(
    errs.some((e) => e.includes("超过 180 天上限")),
    "必须报超过 180 天上限：" + errs.join("; ")
  );
});

test("负向：REJ 的 expires_at 已过期必须报红", (t) => {
  const root = makeTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = path.join(root, "SCOPE.md");
  fs.writeFileSync(
    p,
    fs.readFileSync(p, "utf8").replace("| 2027-05-01 |", "| 2020-01-01 |"),
    "utf8"
  );
  const { errs } = checkRouterAndScope(root);
  assert.ok(errs.some((e) => e.includes("已过期")), "必须报已过期：" + errs.join("; "));
});
