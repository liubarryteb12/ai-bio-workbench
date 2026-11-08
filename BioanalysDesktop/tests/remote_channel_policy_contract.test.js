/**
 * 远程通道策略契约（2026-11-06 用户要求：adb 为主，sshd 备用）。
 *
 * 只做静态校验（真机连通性由 ops/adb_exec.ps1 自己保证）：
 *   1. 辅助脚本存在，且确实实现了 adb 与 ssh 两条通道；
 *   2. 默认通道是 adb，adb 失败即报错，ssh 只在显式选择时使用；
 *   3. 显式 ssh 特殊开关必须能自愈端口转发（adb server 重启会清空转发）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HELPER = path.join(REPO, "ops/adb_exec.ps1");

test("存在 adb 执行辅助脚本，且实现 adb 与 ssh 两条通道", () => {
  assert.ok(fs.existsSync(HELPER), "必须存在 ops/adb_exec.ps1");
  const src = fs.readFileSync(HELPER, "utf8");
  assert.match(src, /run-as com\.termux/, "adb 通道必须用 run-as 进 Termux");
  assert.match(src, /proot-distro login ubuntu/, "adb 通道必须能进 ubuntu 容器");
  assert.match(src, /ssh\.exe/, "必须保留 ssh 备用通道");
});

test("默认走 adb，ssh 只在显式选择时使用，不保留 auto 回落", () => {
  const src = fs.readFileSync(HELPER, "utf8");
  assert.match(src, /\[ValidateSet\('adb', 'ssh'\)\]\[string\]\$Transport = 'adb'/,
    "Transport 默认必须是 adb，且只接受 adb/ssh");
  assert.equal(src.includes("'auto'"), false, "不得保留 auto 回落档位");
  // 只看默认分支内部（} else { 之后）：必须只调用 adb，不得再调用 ssh。
  const dispatchAt = src.indexOf("if ($Transport -eq 'ssh')");
  assert.ok(dispatchAt > 0, "必须有通道分派段落");
  const elseAt = src.indexOf("} else {", dispatchAt);
  assert.ok(elseAt > dispatchAt, "分派段落里必须有默认 adb 分支");
  const defaultBlock = src.slice(elseAt);
  assert.ok(defaultBlock.indexOf("Invoke-ViaAdb $payload") > 0, "默认分支必须走 adb");
  assert.equal(defaultBlock.includes("Invoke-ViaSsh $payload"), false,
    "默认分支不得回落 ssh；ssh 只能由显式 -Transport ssh 进入");
});

test("备用通道必须能自愈 adb 端口转发", () => {
  const src = fs.readFileSync(HELPER, "utf8");
  assert.match(src, /function Repair-Forwards/, "必须有 Repair-Forwards");
  assert.match(src, /adb.*forward --list|forward --list/, "必须检查现有转发");
  assert.match(src, /8022/, "必须覆盖 Termux 侧端口");
  assert.match(src, /10022/, "必须覆盖 ubuntu 侧端口");
});

test("必须提供无 root 下的内存护栏参数", () => {
  const src = fs.readFileSync(HELPER, "utf8");
  assert.match(src, /\[int\]\$MemLimitMB/, "必须有 -MemLimitMB 参数");
  // 锚到赋值语句本身：注释里也会出现 ulimit -v 字样，全文匹配会被注释作证
  // （本测试首版就因此让 MUT-B 存活）。
  assert.match(src, /\$limitLine\s*=\s*"ulimit -v "/, "必须真的把 ulimit -v 拼进注入行");
  // 默认不注入，避免改变既有行为
  assert.match(src, /\$MemLimitMB -gt 0/, "只有显式给值时才注入上限");
});

test("策略文档记录了 adb 优先的理由与实测故障", () => {
  const doc = path.join(REPO, "docs/remote_channel_policy.md");
  assert.ok(fs.existsSync(doc), "必须有 docs/remote_channel_policy.md");
  const t = fs.readFileSync(doc, "utf8");
  assert.match(t, /adb/, "必须写明 adb 为主");
  assert.match(t, /备用/, "必须写明 ssh 为备用");
  assert.match(t, /run-as/, "必须写明权限边界");
  assert.match(t, /不回落/, "必须写明默认不回落 ssh");
});
