# K40 Device Configuration

本目录只保存 Redmi K40 `alioth` 的设备事实、服务器重建计划和阶段验收结果。

## Files

- `device_profile.json`：当前设备、Android、资源和 Termux 状态。
- `server_plan.md`：分阶段目标、操作边界和验收条件。
- `build_state.json`：重建进度和最近一次验收结果。

## Update Rules

- 设备事实必须来自 `adb`、Fastboot 或 Termux 的实际输出。
- 密码、Token、SSH 私钥和完整登录凭证不写入本目录。
- 每次阶段完成后同步更新 `device_profile.json` 与 `build_state.json`。
- 运行数据和生信数据不存放在本目录。
