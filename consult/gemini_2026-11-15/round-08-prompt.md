继续。用户已授权我们自行商定四项决策，完成前不打扰他。我的建议如下，请你终审；如无异议，我按此写目标并开工。

1. 工具暴露：方案 C，宿主受控 JSON Tool-Loop，最多 6 步，Pi 零原生工具、零 MCP、零扩展。
2. Stage 2 自愈：3.5GB 验证通过后允许 Pi 自动 dispatch_step；仅在 adaptation_epoch 达到 2、或进入检查点二签发时卡人工。适配提案仍写台账与 adaptation_trace。
3. 擦除：签发并验签通过后立即擦除 raw_data、processed、figures、results，只留 WIPE_TOMBSTONE.json，不设 24 小时 TTL；客户改图重出必须从桌面端重新推包。失败入 pending_remote_wipes 重试。
4. 模型降级：默认严格 fail-closed，端点不可用即阻断新工单并告警；DETERMINISTIC_FALLBACK 只作为管理员显式开关，不自动切换。

请确认或修正，并给出：四项最终裁定、P0/P1/P2 实施顺序、每阶段验收判据、最容易翻车的两个点。
