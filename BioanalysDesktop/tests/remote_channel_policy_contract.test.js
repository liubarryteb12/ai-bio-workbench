/**
 * 远程通道策略契约（2026-11-06 用户要求：adb 为主，sshd 备用）。
 *
 * 只做静态校验（真机连通性由 ops/adb_exec.ps1 自己保证）：
 *   1. 辅助脚本存在，且确实实现了 adb 与 ssh 两条通道；
 *   2. 默认通道是 adb（auto 且先试 adb），ssh 只在失败后使用；
 *   3. 备用通道必须能自愈端口转发（adb server 重启会清空转发）。
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

test("默认先走 adb，ssh 只在 adb 失败后使用", () => {
  const src = fs.readFileSync(HELPER, "utf8");
  assert.match(src, /\[string\]\$Transport = 'auto'/, "Transport 默认必须是 auto");
  // 只看 auto 分支内部（} else { 之后）：
  // 文件里还有一个「显式 -Transport ssh」分支在更前面，
  // 用全文 indexOf 会把它误当成回落分支（本测试首版就这么假红过）。
  // 注意：文件里另有 "} else { ... }"（ssh 目标三元表达式），
  // 必须从 dispatch 段落的 "if ($Transport -eq 'ssh')" 之后开始找，否则锚点会偏。
  const dispatchAt = src.indexOf("if ($Transport -eq 'ssh')");
  assert.ok(dispatchAt > 0, "必须有通道分派段落");
  const elseAt = src.indexOf("} else {", dispatchAt);
  assert.ok(elseAt > dispatchAt, "分派段落里必须有 auto 分支");
  const autoBlock = src.slice(elseAt);
  const adbAt = autoBlock.indexOf("Invoke-ViaAdb $payload");
  const sshAt = autoBlock.indexOf("Invoke-ViaSsh $payload");
  assert.ok(adbAt > 0, "auto 分支必须先尝试 adb");
  assert.ok(sshAt > adbAt, "auto 分支必须在 adb 失败后才回落 ssh");
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
});
