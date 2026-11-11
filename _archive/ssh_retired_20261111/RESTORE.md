# SSH 功能恢复手册（2026-11-11 封存）

## 封存范围

用户当前不使用 SSH，产品入口已收敛为 ADB 单通道。以下内容被归档或禁用：

- 环境准备与运维手册中的 `~/.ssh/config`、known_hosts、端口转发探活说明；
- `docs/handover_2026-11-03.md`、`docs/k40_hostkey_fingerprints.md`；
- `configs/k40/build_state.json` 中的 SSH 验收记录；
- 工单 schema 与编排器中的 `compute_adapter=ssh` / `allow_ssh` 开关；
- `tools/ops/adb_exec.ps1` 的 `-Transport ssh` 备用分支；
- `BioanalysDesktop/server/remote_exec.js` 的 SSH 适配分支；
- 前端 `compute_mode='ssh'` 提示与 `Remote Channel Policy` 契约测试中 SSH 断言。

底层仍存在「借用 ssh/scp argv 形态、由 proc.js 统一重写成 ADB」的传输调用。
这些不是用户需要安装或配置的 SSH 客户端，不删除以免破坏已跑通的上传与报告链路。

## 恢复步骤

1. 把本目录中同名文件复制回原路径，覆盖当前简化版：
   `docs/`、`configs/k40/`、`skills/stable/ops/work_order/`、`交接清单/`。
2. 恢复 `shared/work_order_v2.mjs` 与 `schemas/work_order_v2.schema.json` 中
   `COMPUTE_ADAPTERS` 的 `ssh` 枚举、`ERR_SSH_DISABLED` 校验与 `allow_ssh` 条件分支。
3. 恢复 `tools/dev/work_order_orchestrator.mjs` 与
   `tools/dev/work_order_orchestrator_gate.mjs` 中的 `ssh` 白名单与 fail-closed 门禁。
4. 恢复 `tools/ops/adb_exec.ps1` 的 `Invoke-ViaSsh`、`Repair-Forwards`、
   `[ValidateSet('adb','ssh')]` 与 `-Transport ssh` 分派。
5. 恢复 `BioanalysDesktop/server/remote_exec.js` 的 `usesSshAdapter()` 分支，
   `BioanalysDesktop/src/App.tsx` 的 `ssh` 联合类型与提示，
   以及 `BioanalysDesktop/tests/remote_channel_policy_contract.test.js` 的 SSH 断言。
6. 恢复 `AGENTS.md` 与 `docs/remote_channel_policy.md` 的 SSH 特殊开关表述。
7. 跑 `node --test BioanalysDesktop/tests/*.test.js` 与
   `node tools/dev/work_order_orchestrator_gate.mjs`，确认全绿。

## 验收判据

- 未设置 `BIO_COMPUTE_ADAPTER` 时全部业务链路仍走 ADB；
- 显式 `BIO_COMPUTE_ADAPTER=ssh` 时才走 SSH，且无 `allow_ssh=true` 的工单被拒；
- `-Transport ssh` 仅手工排障使用，默认分支不回落。
