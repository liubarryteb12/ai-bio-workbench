/**
 * 远程通道策略契约（2026-11-11 用户要求：封存 SSH，ADB 单通道）。
 *
 * 只做静态校验（真机连通性由 tools/ops/adb_exec.ps1 自己保证）：
 *   1. 辅助脚本存在，且只实现 adb 通道；
 *   2. 默认通道是 adb，adb 失败即报错，脚本不含 ssh 调用；
 *   3. 恢复手册存在，记录封存范围与恢复步骤。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HELPER = path.join(REPO, "tools/ops/adb_exec.ps1");

test("存在 adb 执行辅助脚本，且只实现 adb 单通道", () => {
  assert.ok(fs.existsSync(HELPER), "必须存在 tools/ops/adb_exec.ps1");
  const src = fs.readFileSync(HELPER, "utf8");
  assert.match(src, /proot-distro login/, "adb 通道必须能进 Linux 容器");
  assert.match(src, /\$ContainerName/, "容器名必须由 BIO_CONTAINER_NAME 配置");
  assert.equal(/\bssh\.exe\b/.test(src), false, "SSH 客户端调用必须封存");
  assert.equal(/Invoke-ViaSsh/.test(src), false, "SSH 备用分支必须封存");
});

test("固定走 adb，不保留任何备用通道或 auto 回落", () => {
  const src = fs.readFileSync(HELPER, "utf8");
  assert.match(src, /\[ValidateSet\('adb'\)\]\[string\]\$Transport = 'adb'/,
    "Transport 必须固定为 adb");
  assert.equal(src.includes("'auto'"), false, "不得保留 auto 回落档位");
  assert.match(src, /Invoke-ViaAdb \$payload/, "唯一执行分支必须走 adb");
  assert.equal(src.includes("if ($Transport -eq 'ssh')"), false, "不得保留 SSH 分派");
});

test("SSH 封存恢复手册存在且记录范围", () => {
  const doc = path.join(REPO, "_archive/ssh_retired_20261111/RESTORE.md");
  assert.ok(fs.existsSync(doc), "必须有 SSH 恢复手册");
  const t = fs.readFileSync(doc, "utf8");
  assert.match(t, /恢复步骤/, "必须写明恢复步骤");
  assert.match(t, /Transport ssh/, "必须写明 -Transport ssh 恢复项");
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

test("策略文档记录了 ADB 单通道与 SSH 封存", () => {
  const doc = path.join(REPO, "docs/remote_channel_policy.md");
  assert.ok(fs.existsSync(doc), "必须有 docs/remote_channel_policy.md");
  const t = fs.readFileSync(doc, "utf8");
  assert.match(t, /ADB 单通道/, "必须写明 ADB 单通道");
  assert.match(t, /ssh_retired_20261111/, "必须写明 SSH 封存目录");
  assert.match(t, /run-as/, "必须写明权限边界");
  assert.match(t, /无 `auto` 回落路径/, "必须写明不回落");
});
