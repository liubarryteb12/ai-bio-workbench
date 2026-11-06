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
import { checkRouterAndScope } from "../../ops/router_gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "router-gate-" + process.pid + "-"));
  fs.mkdirSync(path.join(root, "ops"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, "ops"))) {
    if (f.endsWith(".mjs")) {
      fs.copyFileSync(path.join(REPO, "ops", f), path.join(root, "ops", f));
    }
  }
  fs.copyFileSync(path.join(REPO, "ops/router.yaml"), path.join(root, "ops/router.yaml"));
  fs.copyFileSync(path.join(REPO, "docs/SCOPE.md"), path.join(root, "docs/SCOPE.md"));
  fs.copyFileSync(path.join(REPO, "src/workflows.json"), path.join(root, "src/workflows.json"));
  return root;
}

test("真实仓库必须通过", () => {
  const { errs } = checkRouterAndScope(REPO);
  assert.deepEqual(errs, [], "真实仓库不该有错：" + errs.join("; "));
});

test("负向：enforced_by 指向不存在的门禁必须报红", (t) => {
  const root = makeTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = path.join(root, "docs/SCOPE.md");
  const md = fs.readFileSync(p, "utf8").replace(
    "enforced_by: ops/mutation_gate.mjs",
    "enforced_by: ops/this_gate_does_not_exist.mjs"
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
  const p = path.join(root, "ops/router.yaml");
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
  const p = path.join(root, "ops/router.yaml");
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
  const p = path.join(root, "ops/router.yaml");
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
  const p = path.join(root, "ops/router.yaml");
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
  const p = path.join(root, "docs/SCOPE.md");
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
  const p = path.join(root, "docs/SCOPE.md");
  fs.writeFileSync(
    p,
    fs.readFileSync(p, "utf8").replace("| 生效 | Argon 第 41 轮 | 无 |", "| 已撤销 | Argon 第 41 轮 | 无 |"),
    "utf8"
  );
  const { errs } = checkRouterAndScope(root);
  assert.ok(errs.some((e) => e.includes("未写明被替代者")), "必须报未写被替代者：" + errs.join("; "));
});
