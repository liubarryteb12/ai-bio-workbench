# B3 二次裁定报告：黑名单 8 -> 20 条（以 aims 为准，吸纳 27 条中可用项）

- 日期：2026-10-21
- 触发：用户裁定（m02739）「B3，以 aims 为准，吸纳 provenance 29 条中可用的并对齐」
- 执行：Lead 自办（写域：aims/、BioanalysDesktop/server/tumor_blacklist.js、portal/index.html、相关测试、docs/、交付报告）
- 决策记录：`con_hf/SPEC_DECISIONS.md` D-19

## 一、背景与事实校正

1. 黑名单有三段沿革：**规格正本 8 条 -> 实现侧自行扩充 27 条 -> 2026-10-21 收敛回 8 条**。收敛动作的报告是
   `con_hf/dispatch/B3_blacklist_report.md`，台账见 `con_hf/操作台账.md` 第 174 行。
2. 评审文档里说的"provenance 29 条"是估算数。从 `git show 5e3ce52:BioanalysDesktop/server/tumor_blacklist.js`
   取回权威原文，**实际可枚举 27 条**，逐条如下：
   cancer, tumor, tumour, carcinoma, glioma, sarcoma, lymphoma, leukemia, leukaemia, melanoma,
   adenocarcinoma, squamous cell carcinoma, immune infiltration, tumor microenvironment,
   tumour microenvironment, immune checkpoint, PD-?L?1, CTLA-?4, oncogene, tumor suppressor,
   癌症, 肿瘤, 癌, 免疫浸润, 免疫检查点, 肿瘤微环境, 癌细胞。
   本报告按 27 条口径处理（29 这个数没有可核对的来源）。

## 二、裁定判据（三条，写进 aims §三.1 供后续复用）

1. **语义**：明确属肿瘤或免疫浸润语义（不是"沾边"）。
2. **不冗余**：不被既有父词覆盖 : `adenocarcinoma` 被 `carcinoma` 覆盖，`癌症` 被 `癌` 覆盖，
   这类项进清单只会制造"改一条要改两处"的维护成本，不增加拦截能力。
3. **误伤可接受**：子串匹配的固有边界可以保留（如"非肿瘤"命中"肿瘤"），但**基因符号级别的误伤必须修**
   （见第四节 PD-L1/PD-1）。

## 三、逐条处置

### 吸纳 12 条（进 20 条清单）

| # | 词 | 为什么可用 |
|---|---|---|
| 1 | `tumour` | 英式拼写，`/tumor/` 覆盖不到（t-u-m-o-u-r 不含 tumor 子串） |
| 2 | `sarcoma` | 肉瘤，实体瘤大类，原 8 条完全漏拦 |
| 3 | `lymphoma` | 淋巴瘤 |
| 4 | `leukemia` | 白血病（美式） |
| 5 | `leukaemia` | 白血病（英式），与上条互为拼写变体，都不能省 |
| 6 | `melanoma` | 黑色素瘤 |
| 7 | `immune checkpoint` | 免疫检查点（英文），正则 `immune\s*checkpoint` 允许词间空白 |
| 8 | `PD-L1` | 免疫检查点配体，高频出现在肿瘤免疫项目描述里 |
| 9 | `PD-1` | 同上；**必须带边界**，见第四节 |
| 10 | `CTLA-4` | 免疫检查点靶点，正则 `CTLA-?4` 兼容 CTLA4 |
| 11 | `oncogene` | 癌基因，语义明确属肿瘤 |
| 12 | `免疫检查点` | 中文对应项，原 8 条只有"免疫浸润" |

### 剔除 8 条（父词已覆盖，不重复入清单）

| 词 | 被谁覆盖 |
|---|---|
| `adenocarcinoma` | `carcinoma` |
| `squamous cell carcinoma` | `carcinoma` |
| `tumor microenvironment` | `tumor` |
| `tumour microenvironment` | `tumour` |
| `tumor suppressor` | `tumor` |
| `癌症` | `癌` |
| `肿瘤微环境` | `肿瘤` |
| `癌细胞` | `癌` |

**重要**：剔除只意味着"不再单列"，不意味着"不再拦截"。上面 8 条文本仍会因父词命中，
`tumor_blacklist.test.js` 用「被剔除的 8 条冗余项仍因父词命中」这条用例把边界如实钉住，
防止后来者误以为剔除=放行。

## 四、顺带修掉的真误伤（PD-L1 / PD-1 边界）

原实现 `/PD-?L?1/i` 的语义是"PD + 可选 L + 1"，于是 `GPD1`、`SLC40A1` 这类基因符号被判命中 :
这在 bulk 项目里是**必然误伤**（GPD1 是甘油-3-磷酸脱氢酶，SLC40A1 是膜铁转运蛋白，都是非肿瘤研究常见基因）。

新写法：

- `/(?<![A-Za-z0-9])PD-?L1(?![0-9])/i`
- `/(?<![A-Za-z0-9])PD-?1(?![0-9])/i`

仍兼容省略连字符（`PDL1` / `PD1`），但要求左右不是字母数字。实测：`GPD1`、`SLC40A1`、`PDK1`、
`PDGFB`、`TPD52` 全部放行；`PD-L1`、`PDL1`、`PD-1`、`PD1` 全部拦截。

## 五、改动文件清单（逐处）

| 文件 | 改了什么 |
|---|---|
| `aims/aims.txt` | §一.2 铁律 1 条数 8 -> 20（写明二次裁定与吸纳/剔除数）；§三.1 模块 A 清单块整块重写（英文 16 + 中文 4 + 匹配规则 + 沿革 + 治理纪律）；§九 落点表两处 8 -> 20（**注意该行末单元格无尾随 `\|`**，替换时踩过一次） |
| `BioanalysDesktop/server/tumor_blacklist.js` | `BLACKLIST_PATTERNS` 重写为 20 条同序；文件头写明沿革与 PD 边界理由；`checkTumorBlacklist` / `validateProjectFields` 逻辑未动 |
| `portal/index.html` | 纯前端副本 `var BL_PATTERNS` 8 -> 20 同序，注释补沿革与 PD 边界说明（运行时仍会被 `serve.mjs` 注入的共享契约覆盖） |
| `BioanalysDesktop/tests/tumor_blacklist.test.js` | 重写为 16 条：20 条同序、逐模式正例 20 条、PD 两种写法、PD 边界负例、剔除项仍命中、误伤负例、#153 全量 key 回归 |
| `BioanalysDesktop/tests/tumor_blacklist_parity.test.js` | EXPECTED 8 -> 20（含 source/flags 逐条）、判定矩阵扩到 35 个样例、新增「吸纳词两侧都拦」「PD 边界两侧都生效」 |
| `BioanalysDesktop/tests/portal_inject.test.js` | 注入条数与离线字面量条数两处断言改为与 `BLACKLIST_PATTERNS.length` 动态比对 + 显式 20 |
| `BioanalysDesktop/tests/aims_drift_guard.test.js` | §一.2 断言 `'8 条黑名单'` -> `'20 条黑名单'`（P14 切片跑全量时唯一的红灯就是这条） |
| `docs/delivery_supervisor_prompt.md` | 监督方口径 8 -> 20 条 + 沿革改写（否则监督方会按过期条数把合规实现判成漏拦） |
| `项目交付报告.html` | 交付材料两处 30 词 -> 20 条并列出关键词（原先 :131 写 30、:196 写 30，与实现三方不一致） |
| `con_hf/SPEC_DECISIONS.md` | 追加 D-19（备选对比 / 拍板 / 受影响条款 / 同步文件 / 验证测试名 / 历史记录不回改的说明） |

## 六、验证（真实输出）

```
cd BioanalysDesktop
node --test tests/tumor_blacklist_parity.test.js tests/portal_inject.test.js \
              tests/aims_drift_guard.test.js tests/tumor_blacklist.test.js
-> tests 54 / pass 54 / fail 0 / exit 0
```

真实 import 探测（`server/tumor_blacklist.js`）：

```
BLACKLIST_PATTERNS.length = 20
breast cancer -> hit cancer          tumour -> hit tumour
sarcoma -> hit sarcoma               lymphoma -> hit lymphoma
leukemia -> hit leukemia             melanoma -> hit melanoma
immune checkpoint -> hit             PD-L1 -> hit PD-L1
PD-1 -> hit PD-1                     PD1 -> hit PD1
CTLA-4 -> hit CTLA-4                 oncogene -> hit oncogene
免疫检查点 -> hit                     GPD1 -> no hit
SLC40A1 -> no hit                    脑卒中 -> no hit
肺纤维化 -> no hit                    非小细胞肺癌 -> hit 癌（子串匹配，属预期）
```

## 七、遗留与纪律

1. `con_hf/handoff.md`、`con_hf/操作台账.md`、`con_hf/dispatch/B3_blacklist_report.md`、`aims/old/*`
   里的"8 条"是**历史记录**（描述当时的收敛动作），按台账纪律不回改；本报告与 D-19 是二次裁定的记录。
2. `aims/aims261021todo.txt` 里"肿瘤黑名单（8 条正本）"是当日待办快照，同样不回改。
3. 治理纪律（已写进 aims §三.1）：**严禁开发人员未经规格裁定私自扩充拦截词**。上一轮 27 条就是
   实现侧单方面扩充、注释却写"与工作台同源"，导致规格与实现脱钩；这次把判据写进规格，就是为了下次有据可依。
4. 黑名单是"建项拦截"，不参与分析流程判定；后续若出现新型肿瘤免疫研究名词（如 `CAR-T`、`TMB`），
   走同一套三条判据评估，不要临时加词。
