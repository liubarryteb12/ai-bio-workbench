/**
 * BioanalysDesktop 本地交互层 · 领域常量
 *
 * 术语唯一权威是 GLOSSARY.md，这里只做实现层映射，不得另造同义词。
 *
 * 数据面组织（2026-10-14 引入项目维度）：
 *   /mnt/ssd/bio_data/
 *   ├── projects/<project>/<line>/{raw_data,processed,results,figures}   每个项目一套三线
 *   ├── bin/<line>/          脚本部署区（代码本体，所有项目共用一份）
 *   ├── envs/<line>/         环境声明（跟代码走，所有项目共用）
 *   ├── public_references/   跨项目只读共享
 *   └── system_logs/         全局台账（条目带 project_id 区分归属）
 */

/** 三条分析线，顺序固定（与 CONTEXT.md 一致） */
export const LINES = ['line1_bulk', 'line2_scrna', 'line3_spatial'];

/** 线的中文展示名，仅用于界面 */
export const LINE_LABELS = {
  line1_bulk: '线1 / GEO bulk',
  line2_scrna: '线2 / 单细胞 + 虚拟敲除',
  line3_spatial: '线3 / 空间转录组 + 虚拟敲除',
};

/**
 * 数据类型 → 分析线映射（唯一判定真源）。
 *
 * 为什么要单独有这个字段：GSE/GPL 只说明"数据从哪来、平台是什么"，
 * 不能说明"这是什么数据"——基因芯片与 bulk RNA-seq 都挂在 GEO 下、
 * 都可能带 GPL，但预处理路径完全不同（探针注释 vs counts），
 * 单细胞与空转更是互不交叉的另两条线。类型缺失就无法正确选线，
 * 这正是 2026-10-18 补上的缺口。
 *
 * 粒度刻意到 microarray / bulk_rnaseq 两级：line1 内部预处理不同，
 * 不能粗到只写 'bulk'。前端(工作台)与用户端各自持有同值枚举（两端解耦，
 * 不共享代码），此处是服务端判定与回退推断的真源。
 */
export const DATA_TYPES = [
  { id: 'microarray', label: '基因芯片（表达谱）', line: 'line1_bulk' },
  { id: 'bulk_rnaseq', label: 'Bulk RNA-seq（转录组测序）', line: 'line1_bulk' },
  { id: 'scrna', label: '单细胞转录组（scRNA-seq）', line: 'line2_scrna' },
  { id: 'spatial', label: '空间转录组（Visium 等）', line: 'line3_spatial' },
];

/** 合法的数据类型 id 集合（校验用） */
export const DATA_TYPE_IDS = DATA_TYPES.map((d) => d.id);

/**
 * 物种枚举（建项校验用，S24/R11）。
 * 与工作台 App.tsx 的 SPECIES_OPTIONS、用户端 portal 的物种下拉同值
 * （两端解耦不共享代码）。拼错物种（如 "Homo Sapiens"、"human"）会让下游
 * 选错 OrgDb / 注释分支，所以建项入口必须卡枚举。
 */
export const SPECIES_ENUM = ['Homo sapiens', 'Mus musculus', 'Rattus norvegicus'];

/**
 * 非肿瘤研究领域枚举（建项校验用，S24/R11）。
 * 与 portal/index.html 领域下拉七项、App.tsx DOMAIN_OPTIONS 同值。
 */
export const DOMAIN_ENUM = ['心脑血管', '神经退行', '代谢', '纤维化', '发育', '免疫', '其他非肿瘤'];

/** dataType -> line 的扁平映射 */
export const DATATYPE_TO_LINE = Object.fromEntries(DATA_TYPES.map((d) => [d.id, d.line]));

/**
 * 由数据类型解析分析线。
 * @param {string} dataType
 * @returns {string} 命中的 line；缺失或非法返回 ''，调用方自行回退推断
 */
export function resolveLineFromDataType(dataType) {
  return DATATYPE_TO_LINE[String(dataType || '').trim()] || '';
}

/**
 * 数据源双模态（aims v2.8 细化专题一）。
 *
 * 客户除了公共数据库编号（GEO/ArrayExpress），还会直接上传实验室自测的下机矩阵，
 * 此时没有 GSE / GPL / GSM 可用。两种来源的必填字段、校验规则、下游预处理入口
 * 完全不同，因此提升为一等字段而不是在 GSE 框里塞特殊值。
 *
 *   PUBLIC_DB        公共数据库模式，默认；GSE 必填且强正则
 *   IN_HOUSE_UPLOAD  自有测序上传模式；GSE 自动生成 LOC_ 内部编号
 */
export const DATA_SOURCE_MODES = ['PUBLIC_DB', 'IN_HOUSE_UPLOAD'];
export const DEFAULT_DATA_SOURCE_MODE = 'PUBLIC_DB';

/**
 * 自有上传矩阵的基因标识符类型。
 * 没有 GPL 探针表可用，必须由客户显式声明第一列是什么，否则无法转 Symbol。
 */
export const ID_TYPES = [
  { id: 'Gene_Symbol', label: 'Gene Symbol（TREM2 / Trem2，已注释好）' },
  { id: 'Ensembl_ID', label: 'Ensembl ID（ENSG00000095970.12，自动剥离版本号）' },
  { id: 'Entrez_ID', label: 'Entrez ID（纯数字，走物种 OrgDb 转换）' },
];
export const ID_TYPE_IDS = ID_TYPES.map((t) => t.id);

/**
 * 表达量数值类型（量纲）。
 * 决定下游走 DESeq2/edgeR/voom 还是 log2 后的 limma；拿已 log2 的数据跑 DESeq2
 * 会直接报错，拿未取对数的 FPKM 算 fold change 会数值爆炸。
 */
export const VALUE_SCALES = [
  { id: 'Raw_Counts', label: 'Raw Counts（原始整数计数）', downstream: 'DESeq2 / edgeR / voom' },
  { id: 'TPM_FPKM', label: 'TPM / FPKM（已标准化非负实数）', downstream: 'log2(x+1) 后 limma' },
  { id: 'Log2_Normalized', label: 'Log2 Normalized（已对数化）', downstream: '直接 limma' },
];
export const VALUE_SCALE_IDS = VALUE_SCALES.map((t) => t.id);

/** 归一化数据源模式；缺失或非法一律回落到公共数据库模式（默认） */
export function normalizeDataSourceMode(mode) {
  // 大小写与首尾空白都归一再判定，前端口径不统一（aims 契约用全大写）
  const raw = String(mode ?? '').trim().toUpperCase();
  return DATA_SOURCE_MODES.includes(raw) ? raw : DEFAULT_DATA_SOURCE_MODE;
}

/** 归一化基因标识符类型；非法返回空串（调用方按缺失处理） */
export function normalizeIdType(idType) {
  const raw = String(idType ?? '').trim();
  return ID_TYPE_IDS.includes(raw) ? raw : '';
}

/** 归一化表达量数值类型；非法返回空串 */
export function normalizeValueScale(valueScale) {
  const raw = String(valueScale ?? '').trim();
  return VALUE_SCALE_IDS.includes(raw) ? raw : '';
}

/** 数据集编号格式：公共库强正则（GSE 或 ArrayExpress） */
export const PUBLIC_ACCESSION_RE = /^(GSE\d+|E-MTAB-\d+)$/i;
/** 数据集编号格式：自有数据内部编号 LOC_<project_id>_TRAIN / _VAL */
export const LOC_ACCESSION_RE = /^LOC_[A-Za-z0-9._-]+_(TRAIN|VAL)$/;

/**
 * 生成自有数据的内部编号。
 * 服务端用项目 ID 派生，客户看不到也填不了，避免撞号与歧义。
 * @param {string} projectId
 * @param {'train'|'validation'} role
 */
export function buildLocAccession(projectId, role) {
  return `LOC_${projectId}_${role === 'validation' ? 'VAL' : 'TRAIN'}`;
}

/**
 * 样本编号格式校验（双模态切换的核心差异之一）。
 * 公共库 GSM 前缀是 GEO 契约；自有数据解除该限制，
 * 允许字母数字下划线连字符与点，如 Ctrl_1 / Stroke_Mouse_02。
 * @returns {boolean}
 */
export function isValidSampleId(sampleId, mode = DEFAULT_DATA_SOURCE_MODE) {
  const raw = String(sampleId ?? '').trim();
  if (!raw) return false;
  if (normalizeDataSourceMode(mode) === 'IN_HOUSE_UPLOAD') return /^[A-Za-z0-9_.-]+$/.test(raw);
  return /^GSM\d+$/.test(raw);
}

/** 数据集行级数据类型：只认四种枚举，非法/缺失返回空串（交给上层回落项目级） */
export function normalizeDatasetDataType(value) {
  const id = String(value ?? '').trim();
  return DATA_TYPE_IDS.includes(id) ? id : '';
}

/** 数据集行级样本数量：正整数才收，0 / 负数 / 非数字一律归 0（表示未填） */
export function normalizeDatasetSampleCount(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * 归一化「数据集 ↔ 平台配对」（2026-10-18 新增，配合数据类型字段）。
 *
 * 新格式是显式配对表：dataSource.datasets = [{gse, gpl, role}]，一行一组对应关系。
 * 旧格式是三个各自独立的扁平数组 trainGse / valGse / gpl，彼此之间没有显式对应关系。
 * 工作台读旧需求文件时必须能兼容，所以这里按位置推断配对：
 *   - 只有一个 GPL 时广播给全部 GSE（常见于单平台多数据集）；
 *   - GPL 与 GSE 数量对不上、位置越界的，GPL 留空（宁缺勿错配）。
 * 按位置推断的配对本身可能错（这正是旧扁平格式的毛病），因此 inferred=true，
 * 调用方必须提示用户"配对为推断，请核对"，不能当作可信数据直接跑。
 *
 * 2026-10-19：每行再带「数据类型 / 样本数量 / 组织来源」。
 * 一个项目合入多个 GSE 时这三项常不同（如芯片 60 例外周血 + 测序 24 例皮肤），
 * 只按项目级存一份会让 prep_matrix 用错注释分支。逐行未填时回落项目级
 * dataType / sampleCount / tissue（旧需求文件因此不破），都缺则留空串 / 0，不编造。
 *
 * @param {object} dataSource 需求 manifest 的 dataSource 段
 * @returns {{datasets: Array<{gse:string, gpl:string, role:'train'|'validation', dataType:string, sampleCount:number, tissue:string}>, inferred: boolean}}
 */
export function normalizeDatasets(dataSource) {
  const source = dataSource && typeof dataSource === 'object' ? dataSource : {};
  const clean = (v) => String(v ?? '').trim();
  const role = (v) => (v === 'validation' ? 'validation' : 'train');

  // 项目级兜底：行级留空时继承；都缺则保持空，不填默认值掩盖缺失
  const fallbackType = normalizeDatasetDataType(source.dataType);
  const fallbackCount = normalizeDatasetSampleCount(source.sampleCount);
  const fallbackTissue = clean(source.tissue);
  const enrich = (row) => ({
    ...row,
    dataType: normalizeDatasetDataType(row.dataType) || fallbackType,
    sampleCount: row.sampleCount === undefined || row.sampleCount === null || row.sampleCount === ''
      ? fallbackCount
      : normalizeDatasetSampleCount(row.sampleCount),
    tissue: clean(row.tissue) || fallbackTissue,
  });

  if (Array.isArray(source.datasets) && source.datasets.length) {
    const datasets = source.datasets
      .filter((d) => d && typeof d === 'object')
      .map((d) => ({
        gse: clean(d.gse),
        gpl: clean(d.gpl),
        role: role(d.role),
        dataType: d.dataType,
        sampleCount: d.sampleCount,
        tissue: d.tissue,
      }))
      .filter((d) => d.gse)
      .map(enrich);
    return { datasets, inferred: false };
  }

  const trainGse = Array.isArray(source.trainGse) ? source.trainGse.map(clean).filter(Boolean) : [];
  const valGse = Array.isArray(source.valGse) ? source.valGse.map(clean).filter(Boolean) : [];
  const gplList = Array.isArray(source.gpl) ? source.gpl.map(clean).filter(Boolean) : [];
  if (!trainGse.length && !valGse.length) return { datasets: [], inferred: false };

  const pickGpl = (index) => {
    if (!gplList.length) return '';
    if (gplList.length === 1) return gplList[0];
    return gplList[index] || '';
  };
  const datasets = [];
  trainGse.forEach((gse, i) => datasets.push({ gse, gpl: pickGpl(i), role: 'train' }));
  valGse.forEach((gse, i) => datasets.push({ gse, gpl: pickGpl(trainGse.length + i), role: 'validation' }));
  return { datasets: datasets.map(enrich), inferred: true };
}

/**
 * 数据源段归一化总入口（双模态）。
 *
 * aims v2.8 契约：dataSource 增加 data_source_mode，并在自有上传模式下
 * 用一组平铺的 accession_and_platform 取代 datasets 配对表
 * （自有数据没有 GSE/GSM 概念，配对表无从填起）。
 *
 * 返回三种形态的并集，调用方按需取：
 *   mode       归一化后的数据源模式
 *   datasets   数据集配对（IN_HOUSE 模式下为 LOC_ 内部编号，供步骤脚本定位文件用）
 *   inferred   旧扁平格式是否按位置推断（兼容标记）
 *   accession  accession_and_platform 段（IN_HOUSE 模式）；null 表示未提供
 *
 * 兼容：旧格式无 data_source_mode 时按默认 PUBLIC_DB 处理，
 * 不影响现有需求文件与测试。
 */
export function normalizeDataSource(dataSource, projectId = '') {
  const src = dataSource && typeof dataSource === 'object' ? dataSource : {};
  const mode = normalizeDataSourceMode(src.data_source_mode);
  const base = normalizeDatasets(src);

  if (mode !== 'IN_HOUSE_UPLOAD') {
    return { mode, datasets: base.datasets, inferred: base.inferred, accession: null };
  }

  const idType = normalizeIdType(src.id_type ?? src.accession_and_platform?.id_type);
  const valueScale = normalizeValueScale(src.value_scale ?? src.accession_and_platform?.value_scale);
  const trainMatrix = String(src.uploaded_files?.train_matrix ?? src.accession_and_platform?.uploaded_files?.train_matrix ?? '').trim();
  const valMatrix = String(src.uploaded_files?.val_matrix ?? src.accession_and_platform?.uploaded_files?.val_matrix ?? '').trim();

  if (!idType) {
    throw new Error('自有测序上传模式缺少 id_type（上传矩阵第一列的基因标识符类型）');
  }
  if (!valueScale) {
    throw new Error('自有测序上传模式缺少 value_scale（表达量数值类型）');
  }
  if (!trainMatrix) {
    throw new Error('自有测序上传模式缺少 uploaded_files.train_matrix（上传的表达矩阵文件路径）');
  }

  const accession = {
    // 预览阶段还没有项目 ID，train_id 留空由建项时按真实 projectId 派生。
    // 不能填占位编号：下游会把它当真实数据集编号写进脚本与台账。
    train_id: projectId ? buildLocAccession(projectId, 'train') : '',
    val_id: valMatrix && projectId ? buildLocAccession(projectId, 'validation') : null,
    id_type: idType,
    value_scale: valueScale,
    species: String(src.species ?? '').trim(),
    data_modality: String(src.data_modality ?? src.dataType ?? '').trim(),
    tissue_source: String(src.tissue_source ?? src.tissue ?? '').trim(),
    uploaded_files: { train_matrix: trainMatrix, val_matrix: valMatrix || null },
  };

  return { mode, datasets: base.datasets, inferred: base.inferred, accession };
}

/**
 * 容器计算面的 scp 直连目标（adb forward 拓扑）。
 *
 * 为什么存在：~/.ssh/config 的 Host 别名只覆盖 ssh，scp 的 -P 端口与 user@host 是
 * 独立口径（task_input.js / upload.routes.js 两处直连点共用，2026-11-01 前各写一份
 * 字面量）。环境变量可覆盖：换 forward 端口或换设备只改这里，不改调用点。
 */
export const COMPUTE_SCP_TARGET = process.env.BIO_COMPUTE_SCP_TARGET || 'root@127.0.0.1';
export const COMPUTE_SSH_PORT = Number(process.env.BIO_COMPUTE_SSH_PORT || 10022);

/** 执行面术语到 ssh 别名的映射 */
export const HOSTS = {
  /** 底座面：Termux，编排/传文件/服务管理，不跑分析 */
  base: 'k40',
  /** 容器计算面：Ubuntu 24.04 proot，R/Python 计算 */
  compute: 'k40-ubuntu',
};

/** SSD 数据面根（未挂载时一切数据操作必须显式失败） */
export const SSD_ROOT = '/mnt/ssd/bio_data';

/** 项目根：每个项目一套三线，项目之间物理隔离 */
export const PROJECTS_ROOT = `${SSD_ROOT}/projects`;

/** 默认项目：历史三线数据迁入此处，无 project 参数时的落点 */
export const DEFAULT_PROJECT = 'default';

/** 脚本部署区（代码本体，全局一份，不随项目复制） */
export const BIN_ROOT = `${SSD_ROOT}/bin`;

/** 环境声明区（跟代码走，全局一份） */
export const ENVS_ROOT = `${SSD_ROOT}/envs`;

/** 三线唯一合法共享读入口 */
export const PUBLIC_REFERENCES = `${SSD_ROOT}/public_references`;

/** 任务台账落盘处（全局，条目带 project_id） */
export const SYSTEM_LOGS = `${SSD_ROOT}/system_logs`;

/** 每个项目内、每条线固定的数据子目录 */
export const LINE_SUBDIRS = ['raw_data', 'processed', 'results', 'figures'];

/** runit 监管的四个服务 */
export const SERVICES = ['sshd', 'crond', 'ssh-agent', 'ubuntu-sshd', 'pi-a2a'];

/**
 * adb forward 的四条隧道。
 *
 * 语义边界：这张表是"手机端口在 PC 侧可达"的唯一真源。checkForwards() 只遍历这张表
 * 补隧道，表里没登记的端口永远不会被重建 —— 这也是第二十九轮前 pi agent 检测一直
 * 全红的第一根因：pi_agent.js 直连 127.0.0.1:9910/9911，而这两条不在表内。
 *
 * 前两条是 ssh 数据面（Termux 底座 / 容器），后两条是 pi agent 的观测面：
 *   9910 = A2A AgentCard 与 JSON-RPC 任务口，9911 = 遥测侧车。
 */
export const FORWARD_PAIRS = [
  { local: 'tcp:8022', remote: 'tcp:8022', purpose: 'Termux sshd' },
  { local: 'tcp:10022', remote: 'tcp:10022', purpose: '容器 sshd' },
  { local: 'tcp:9910', remote: 'tcp:9910', purpose: 'pi agent A2A' },
  { local: 'tcp:9911', remote: 'tcp:9911', purpose: 'pi 遥测侧车' },
];

/** 默认手机序列号 */
export const DEFAULT_SERIAL = '3a3e1f52';

/**
 * 项目 ID 消毒：项目 ID 会进服务器路径与台账文件名，必须严格。
 * 只允许 `[A-Za-z0-9._-]`，禁以 `.` 开头（防隐藏文件）、禁 `..`、长度 <= 64。
 * @returns {string|null} 合法返回原 ID，否则 null
 */
export function sanitizeProjectId(projectId) {
  const raw = String(projectId ?? '').trim();
  if (!raw || raw.length > 64) return null;
  if (raw === '.' || raw === '..') return null;
  if (raw.startsWith('.')) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) return null;
  return raw;
}

/** 项目根目录；ID 非法时抛错（调用方应先消毒） */
export function projectRoot(projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`项目 ID 非法: ${projectId}`);
  return `${PROJECTS_ROOT}/${safe}`;
}

/** 项目内某条线的目录；projectId 或 lineId 非法时抛错 */
export function projectLineDir(projectId, lineId) {
  if (!LINES.includes(lineId)) throw new Error(`line_id 非法: ${lineId}`);
  return `${projectRoot(projectId)}/${lineId}`;
}

/** 某条线的全局脚本部署目录 */
export function binDir(lineId) {
  if (!LINES.includes(lineId)) throw new Error(`line_id 非法: ${lineId}`);
  return `${BIN_ROOT}/${lineId}`;
}

/** 某条线的全局环境声明目录 */
export function envsDir(lineId) {
  if (!LINES.includes(lineId)) throw new Error(`line_id 非法: ${lineId}`);
  return `${ENVS_ROOT}/${lineId}`;
}
