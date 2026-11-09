# 商用合规许可（LICENSES.md）

> 本文件只做 posture 导航，逐条许可明细以各真源为准。

| 资产 | 许可真源 | posture |
|---|---|---|
| 参考生信代码库（原 references/05） | `references/05.可参考生信代码/library/licenses.json` | Python 0BSD；R MIT；来源站点图片另行声明；对外分发前逐条复核 |
| vendor 便携工具二进制 | `docs/vendor_assembly.md` | 本地受控缓存组装，二进制不进 Git，不随包再分发源码包 |
| Node 依赖 | `BioanalysDesktop/package-lock.json` | 以各包声明为准，升级时复查 |
| 文档与自有代码 | 仓库本体 | 对外交付前按 `docs/delivery_package_spec.md` 验收 |

对外交付任何包之前，交付验收四关（`tools/ops/delivery_acceptance.ps1`）包含许可复核。
