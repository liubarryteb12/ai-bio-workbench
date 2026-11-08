/**
 * 空间标定与表达矩阵守卫的真机行为回归（第 69 轮三审收敛项）。
 *
 * 静态契约（spatial_calibration_contract / matrix_guard_contract）只证明代码写了，
 * 本用例证明代码在真实数据上有效：
 *   A. 五张真实切片双口径比值落在 [0.90, 1.10]；
 *   B. 缩放级别错配（hires 直径配 fullres 坐标）必须 fail-closed；
 *   C. 破碎组织必须 fail-closed；
 *   D. 指纹稳定、对未改动无误报、对就地缩放/微幅平滑/列切片三类污染全部敏感。
 *
 * 远端不可达时按 HOST_UNREACHABLE_K40 跳过（口径与 preview_mods.test.js 一致）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSync, sshArgv, scpArgv } from "../server/proc.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const FILES = ["spatial_calibration.py", "matrix_guard.py", "spatial_guards_behavior.py"];
const SSH_TARGET = "k40-ubuntu";

function pushToRemote(t) {
  for (const f of FILES) {
    const local = path.join(REPO, "ops", f);
    assert.ok(fs.existsSync(local), "缺本地文件 ops/" + f);
    const r = runSync(scpArgv(local, path.posix.join("/tmp", f)), { timeoutMs: 60000 });
    if (r.code !== 0) {
      t.skip("HOST_UNREACHABLE_K40: scp 上传失败（" + f + "）：" + String(r.stderr || r.error || "").slice(0, 120));
      return false;
    }
  }
  const fix = runSync(sshArgv(SSH_TARGET,
    "sed -i 's/\\r$//' " + FILES.map((f) => "/tmp/" + f).join(" ")), { timeoutMs: 60000 });
  if (fix.code !== 0) {
    t.skip("HOST_UNREACHABLE_K40: 远端行尾修正失败：" + String(fix.stderr || "").slice(0, 120));
    return false;
  }
  return true;
}

test("真机行为：标定 fail-closed 与指纹守卫对污染敏感", (t) => {
  if (!pushToRemote(t)) return;
  const r = runSync(sshArgv(SSH_TARGET,
    "LANG=C.UTF-8 /root/venvs/bio-py/bin/python3 /tmp/spatial_guards_behavior.py 2>&1 | tail -20"),
    { timeoutMs: 180000 });
  const text = String(r.stdout || "") + String(r.stderr || "");
  assert.equal(r.code, 0, "行为脚本非零退出：\n" + text);
  assert.match(text, /BEHAVIOR_OK/, "未打印 BEHAVIOR_OK：\n" + text);
  for (const tag of ["A.", "B.", "C.", "D."]) {
    const line = text.split("\n").find((l) => l.startsWith(tag));
    assert.ok(line, "缺少行为断言段落 " + tag);
    assert.match(line, /PASS/, tag + " 未通过：" + line);
  }
});

test("标定比值带必须是 [0.90, 1.10]（收紧自 [0.7,1.3]）", () => {
  const src = fs.readFileSync(path.join(REPO, "tools/reporting/spatial_calibration.py"), "utf8");
  assert.match(src, /RATIO_LOW\s*=\s*0\.90/);
  assert.match(src, /RATIO_HIGH\s*=\s*1\.10/);
});
