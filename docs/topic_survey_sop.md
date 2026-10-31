# 模式 A 调研 SOP：按筛子做课题数据调研

> version 1 | 2026-10-24
> 上位规范：`docs/topic_sieve_spec.md`（筛子全文，规则正本）。
> 本文件是**模式 A 的执行规程**：客户给一个方向，AI 按筛子 L0 到 L4 外出调研，回一份带留痕的报告。
> 与模式 B 的分界见 `con_hf/2026-10-24_topic_sieve_landing_plan.md` 第一节：
> 模式 A 产出「做什么课题、用哪些数据」这个决策，模式 B 产出「把已定的课题跑出结果」。
> 本文件不含规则正文，只规定怎么执行；规则判定一律回筛子正本查，不在此复述。

## 一、输入与输出

**输入**：一个研究方向。最小形态是疾病名（英文，GEO 检索用），可附兴趣点、物种偏好、组织偏好。

**输出**：一份调研报告，含四部分，缺一不可：

1. L0 准入结论（含边缘病判定依据）
2. 候选数据集要素卡（每 GSE 一张，L1 字段）
3. L2 评分与分级
4. L3 成链判定 + L4 课题反推
5. **完整留痕**：检索式、命中 GSE、每个字段取自哪里

第 5 项是本 SOP 的硬要求。没有留痕的报告不可复现、不可审计，等于没做。

## 二、执行步骤

### 步 1 · L0 准入

拿疾病名对筛子 3.1 硬排除清单过一遍。

- 明确落在肿瘤或免疫方向：**停止调研**，直接回报不接，附命中的排除项。
- 落在 3.2 边缘病表：标 `status=manual`，**不替客户拍板**，把对照表依据写进报告待人工裁定。
- 其余：记 `纳入`，附一句依据（该病的主流机制定位）。

### 步 2 · GEO 检索

数据源是 NCBI E-utilities，不需要登录态：

```bash
# 检索式（retmax 按需放大）
esearch: db=gds&term=<疾病名> AND Homo sapiens[Organism] AND gse[Entry Type]&retmode=json&sort=relevance
esummary: db=gds&id=<uid 列表>&retmode=json
```

esummary 返回的 `accession` / `n_samples` / `gpl` / `bioproject` / `suppfile` / `ptechtype`
直接对应筛子要素卡的多个字段，先落进初筛表。

**检索纪律**：

- 检索式原文记进留痕，包括 retmax 与排序方式。不同 retmax 会得到不同候选集，不记就无法复现。
- `suppfile` 是判可得性档位的第一个信号（CEL / H5AD / TSV / RDS / TAR 等）。
- 一检完先做标题级 L0 复筛：命中肿瘤或免疫语义的直接出局，不占用后续步骤。

### 步 3 · GSM 级分组映射（L1 核心字段）

esummary 拿不到 GSM 与分组的映射，必须下钻 series_matrix：

```bash
https://ftp.ncbi.nlm.nih.gov/geo/series/GSE<编号去掉末3位>nnn/<GSE>/matrix/<GSE>_series_matrix.txt.gz
```

解析规则（本次实测确认，**这是最容易写错的一处**）：

- 文件是 gzip，判据 magic 头 `1f 8b`。
- **同一字段名可能占多行**（如 `characteristics_ch1` 有三行，分别是 tissue / disease / treatment）。
  每行仍是「首列字段名 + 每样本一列」。解析时必须按 key 累积成二维数组，
  同名覆盖会丢掉分组信息，全部样本沦为 UNMAPPED。
- characteristics 的值形如 `tissue: Lung BALF`，用 `key: value` 提取，值可能带引号，先剥。
- 分组字段的 key 不固定，常见 `disease` / `group` / `disease state`，
  按筛子要素卡的「分组方案」语义取，取不到记 UNMAPPED 并说明。

### 步 4 · 数据类型判定

判据按优先级：`library_source` 含 `single cell` 判单细胞；否则看标题关键词；
再次之看 `suppfile` 是否出现 10x 三件套或空间坐标文件。

**不要只按标题猜**：本次实测的 GSE252465 标题是 `ControlYu01`，
毫无信息量，而 `library_source` 明确写着 `transcriptomic single cell`。

### 步 5 · L1 填卡

按筛子第四部分的四类模板填。每个 GSE 一张卡，SuperSeries 拆 SubSeries 各填各的。

字段能自动取的就自动取，取不到的标 `缺`，**不编造**。

### 步 6 · L2 评分

按筛子第五部分的六维权重打分，产出 A / B / C 级。

规模分位一维：当前无参照集，按固定阈值兜底，并在报告里标注「未用参照集」。
这是已知能力缺口，不是数据缺陷。

### 步 7 · L3 成链与 L4 反推

按筛子第六部分判强中弱配套、第七部分走决策树反推课题模板。

三个必须标 manual 的项，AI 一律不自裁：

- 边缘病准入（步 1 已标）
- BioProject 去重（要外查，本地判不了）
- 批次与分组混杂（要做交叉表，字段不全判不了）

## 三、三条实测抓到的坑（2026-10-24，IPF 方向）

1. **GEO FTP 目录名**：`GSE252465` 的目录是 `GSE252nnn`，规则是编号去掉末 3 位后补 `nnn`。
   写成取末 3 位会拼出 `GSE465nnn`，服务器返回 XML 错误页（magic `3c3f786d`，990 字节）。
2. **series_matrix 同名字段多行**：同名 key 覆盖会导致分组全 UNMAPPED。见步 3。
3. **标题无信息量**：`ControlYu01` 这种标题判不出类型，`library_source` 才是可靠信号。见步 4。
4. **GEO FTP 响应会间歇性变成 990 字节的 XML**：实测同一 URL 在几分钟内两次请求，
   一次返回正常 gzip（magic `1f8b`），一次返回 990 字节 XML 错误页（magic `3c3f786d`）。
   **根因尚未定位**，已排除的因素：URL 拼写（两次打印的 URL 逐字符相同）、
   `?cb=` 缓存绕过参数（有无都一样）、请求间隔。
   尚未排除：NCBI 侧限流或按 IP 临时降级、批量连续请求触发的保护。
   另一条独立事实：`curl` 在 Windows schannel 下对该域名直接 SSL 失败（exit 35），
   所以抓取一律用 Node `https`，不要用 curl。

> 判别特征：`bytes` 恰为 990 且 magic 为 `3c3f786d`（`<?xm`），说明拿到的是错误页。
> **当前处置**：见到这个尺寸就落 `status=manual` 并把该数据集标"下钻失败"，
> 不要静默当作空要素卡继续跑 L2 和 L4，那会产出全无推荐的假结论。
> 根因定位前，把"下钻失败"如实写进报告，比给出一个看起来完整的课题清单更诚实。

> 验证脚本只认 `con_hf/2026-10-24_topic_survey_probe/fetch.cjs`。
> 同目录的 `probe.cjs` 是调试中间产物，它的 `parseMatrix` 正是坑 2 的错误写法，
> 运行会静默产出全 UNMAPPED 的分组，**不要用**。

## 四、验收判据

一次调研交付前，逐条自检：

- L0 有结论，边缘病有依据或已标 manual
- 每个候选 GSE 有要素卡，字段缺口标 `缺` 而非留空
- L2 有分数与等级，规模分位标注了是否用参照集
- L3 有链型判定，L4 有课题候选
- 检索式与 GSE 列表完整，别人照着重跑得到同一批候选
- 三个 manual 项都在报告里显式列出，没有被静默裁决

## 五、不做什么

- 不下载原始数据、不跑分析、不出图。本 SOP 止于课题与数据决策。
- 不建项、不改客户项目目录。决策确认后交模式 B。
- 不为了凑齐四类数据而放宽匹配。筛子 7.1 的提醒优先于「数据越多越好」。

## 六、可执行 runner

本 SOP 的步 2 到步 7 有机器实现，位置 `con_hf/topic_survey/survey_run.mjs`：

```bash
node con_hf/topic_survey/survey_run.mjs "<疾病名>" [--kinds bulk,scrna] [--ticket TSV-xxx]
```

它做四件事：L0 两道闸、esearch 到 esummary 检索、短名单下钻 series_matrix 填卡、
L2 六维评分与 L4 九类课题反推。产物落 `con_hf/topic_survey/runs/<疾病>_<日期>.json`，
结构与结果页 `portal/survey_result.html` 消费的 `result` 字段一致。

**它是参考实现，不是唯一实现**。runner 的价值是给出字段口径与判定顺序，
让 AI 照着做时有可对照的样板；碰到 runner 没覆盖的情况（例如需要读 10x 三件套、
或要外查 BioProject），AI 仍按本 SOP 手工执行并把留痕写进报告。

当前 runner 的已知边界：

- L4 的九类课题判定基于要素卡的粗粒度字段，不读临床协变量明细，T7 只会因为
  「无随访字段」被排除，不做真实的生存分析可行性判断。
- 规模分位按固定阈值（≥50 满分、≥20 中档、其余低档），未用参照集。
- 深挖的数据集数由 `SURVEY_DEEP` 控制，默认 3 个，避免一次跑太久。
