# 出图审计负对照样本（figure_code_audit.py）

用途：证明 "no issue found" 不是漏报。规范要求任何"全 PASS"结论必须先有负对照
（把样本改坏后必须复现 FAIL）。这三个样本就是 C4/C8/C9 的固定坏样本与正对照。

| 样本 | 故意违反 | 期望命中 |
|---|---|---|
| `src/line1_bulk/scripts/bad_fig` | `fontsize=6`；`savefig` 无 dpi 且无 `savefig.dpi`；内嵌 R `png(...)` 无 `res=` | C4_TINY_FONT / C9_NO_DPI / C8_NO_RES |
| `src/line1_bulk/scripts/bad_r_fig` | R `png()` 未声明 `res=` | C8_NO_RES |
| `src/line1_bulk/scripts/good_fig` | 合规写法（rcParams 带 `savefig.dpi`、`fontsize=8`、`png(..., res=300)`） | no issue found |

跑法（在仓库根执行）：

```bash
python cn_debug/figure_code_audit.py --root cn_debug/figure_negctrl                                        # 期望命中 3 项，退出码 1
python cn_debug/figure_code_audit.py --root cn_debug/figure_negctrl/src/line1_bulk/scripts/good_fig        # 期望 no issue found
python cn_debug/figure_code_audit.py --root src                                                             # 真源码，期望 no issue found
```

注意：审计工具只扫**无扩展名**文件（出图脚本是无扩展名 bash），`.py` 文件会被跳过——
所以这里的样本一律不带扩展名。放 `.py` 会得到假的 "no issue found"。
