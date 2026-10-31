export const SUBDIRS = ['raw_data', 'processed', 'results', 'envs'];

export const SPECIES_OPTIONS = ['Homo sapiens', 'Mus musculus', 'Rattus norvegicus'];
export const DOMAIN_OPTIONS = [
  '心脑血管',
  '神经退行',
  '代谢',
  '纤维化',
  '发育',
  '免疫',
  '其他非肿瘤',
];
export const DATA_SOURCES = ['GEO', 'ArrayExpress', '自有数据'];

// 自有上传矩阵的基因标识符类型 / 表达量量纲（server/domain.js ID_TYPES / VALUE_SCALES 同值）
export const ID_TYPE_OPTIONS = [
  { id: 'Gene_Symbol', label: 'Gene Symbol（已注释好）' },
  { id: 'Ensembl_ID', label: 'Ensembl ID（自动剥离版本号）' },
  { id: 'Entrez_ID', label: 'Entrez ID（纯数字，走物种 OrgDb 转换）' },
];
export const VALUE_SCALE_OPTIONS = [
  { id: 'Raw_Counts', label: 'Raw Counts（原始整数计数）' },
  { id: 'TPM_FPKM', label: 'TPM / FPKM（已标准化非负实数）' },
  { id: 'Log2_Normalized', label: 'Log2 Normalized（已对数化）' },
];

// 出图画幅两档（server/project.js PLOT_LAYOUT_TEMPLATES 同源，照 portal/index.html 先例）
export const LAYOUT_TEMPLATE_OPTIONS = [
  { id: 'template_4x3', label: '4:3（图例右侧 · 单栏插图）' },
  { id: 'template_16x9', label: '16:9（图例底部 · 横向宽幅）' },
];

// 统计阈值三档（server/project.js ANALYSIS_CUTOFFS 同值）
export const CUTOFF_PROFILE_OPTIONS = [
  { id: 'standard_sci', label: '标准科研档（log2FC ≥ 1.0，padj < 0.05）' },
  { id: 'sensitive', label: '灵敏档（log2FC ≥ 0.585，p < 0.05）' },
  { id: 'strict', label: '严格档（log2FC ≥ 1.5，padj < 0.01）' },
];
// 虚拟敲除靶基因检出率不足时的兜底策略（server/project.js KO_FALLBACK_POLICIES 同值）
export const KO_FALLBACK_OPTIONS = [
  { id: 'strict_abort', label: '检出率不足即中止（strict_abort）' },
  { id: 'auto_recommend', label: '自动推荐替代基因（auto_recommend）' },
];

/**
 * 数据类型 → 分析线。
 * 与 server/domain.js 的 DATA_TYPES、用户端 portal/index.html 的 DATA_TYPE_LINE 同值枚举
 * （两端解耦不共享代码，各自持有同一份约定）。服务端接口也返回 suggestedLine，
 * 导入时以接口值为准，这里供"手工新建"时选类型即选线用。
 */
export const DATA_TYPE_OPTIONS: Array<{ id: string; label: string; line: string }> = [
  { id: 'microarray', label: '基因芯片（表达谱）', line: 'line1_bulk' },
  { id: 'bulk_rnaseq', label: 'Bulk RNA-seq（转录组测序）', line: 'line1_bulk' },
  { id: 'scrna', label: '单细胞转录组（scRNA-seq）', line: 'line2_scrna' },
  { id: 'spatial', label: '空间转录组（Visium 等）', line: 'line3_spatial' },
];
