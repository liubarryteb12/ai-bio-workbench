// ============================================================
// 类型定义
// ============================================================

export type Compute = {
  cpus: string | null;
  cpusTotal?: string | null;
  memoryGb: string | null;
  memoryAvailGb?: string | null;
  disk: string | null;
};
export type Segment = { name: string; pass: boolean; detail?: string; compute?: Compute | null; entries?: Array<{ local: string; remote: string; purpose: string; pass: boolean; action: string }> };
export type Service = { name: string; state: string; running: boolean; logCrashLoop: boolean };
export type LinkResult = {
  overall: 'pass' | 'warn' | 'fail';
  segments: Segment[];
  services: Service[];
  compute: Compute;
  checkedAt: string;
};
export type LinkResponse = { serial: string; adb: string; link: LinkResult } | { error: string; hint?: string };

export type ProjectMeta = {
  project_id: string;
  name?: string;
  description?: string;
  created_at: string;
  lines: string[];
  // v3 契约把项目名放在 basic_info 里，顶层 name 只有 schema_version 1 的旧项目才有
  basic_info?: { name?: string; description?: string; disease?: string };
};
export type ProjectEntry = { projectId: string; meta: ProjectMeta | null };
export type ProjectsResponse = { defaultProject: string; projects: ProjectEntry[] };

// 黑名单校验结果
export type BlacklistResult = { hit: boolean; matches: string[]; hint?: string };

// 步骤元信息
export type StepMeta = {
  label: string;
  desc: string;
  tool: string;
  io: string;
  note: string;
};

// 步骤列表
export type StepsResponse = {
  steps: {
    line1_bulk: string[];
    line2_scrna: string[];
    line3_spatial: string[];
  };
  meta: Record<string, StepMeta>;
};

// 分组设计
export type GroupMode = 'two_group' | 'multi_group' | 'ordered_stage';
export type GroupRole = 'reference' | 'disease_stage';

export type GroupEntry = {
  groupId: string;
  groupName: string;
  role: GroupRole;
  stageOrder: number;
  colorHex: string;
  sampleIdsText: string; // 多行文本域原始内容
};

export type Contrast = {
  name: string;
  case: string;
  ctrl: string;
  isPrimary: boolean;
  enabled: boolean;
};

// 客户需求收件箱（portal/inbox）
// 数据集 ↔ 平台配对：一行一组 GSE↔GPL，role 标明训练 / 验证；
// dataType / sampleCount / tissue 是行级三元组（留空表示沿用项目级）
export type DatasetRow = {
  gse: string;
  gpl: string;
  role: 'train' | 'validation';
  dataType?: string;
  sampleCount?: number | string;
  tissue?: string;
};
// 客户在用户端上传的参考文献元数据（文件本体留在 portal/inbox/refs/<sid>/ 下）
export type ReferenceMeta = { name: string; path: string; size: number };
export type InboxSummary = {
  name: string;
  disease: string;
  domain: string;
  species: string;
  dataType: string;
  suggestedLine: string;
  datasets: DatasetRow[];
  datasetsInferred: boolean;
  refCount: number;
  notes: string;
  submittedAt: string;
  stepCount: number;
  groupCount: number;
  sampleCount: number;
  tissue: string;
};
export type InboxItem = {
  file: string;
  size: number;
  mtime: string;
  summary: InboxSummary | null;
  parseError: string | null;
  // 新提交包才有：包目录名与附件计数（旧平铺 JSON 为 null）
  packageDir?: string | null;
  attachments?: { references?: number; data_files?: number } | null;
};
export type InboxResponse = {
  blocked: boolean;
  reason?: string;
  detail?: string;
  dir?: string;
  items: InboxItem[];
};

// 用户提交台导出的需求文件（manifest v1.0）
export type PortalManifest = {
  manifest_version?: string;
  submitted_at?: string;
  basicInfo?: {
    name?: string; description?: string; domain?: string;
    disease?: string; species?: string; contact?: string;
  };
  dataSource?: {
    source?: string; dataType?: string;
    datasets?: Array<{ gse?: string; gpl?: string; role?: string }>;
    // 旧格式（2026-10-18 前）：三个扁平数组，彼此无显式对应关系
    trainGse?: string[]; valGse?: string[]; gpl?: string[];
    sampleCount?: number; tissue?: string;
  };
  // 客户补充材料：备注原文 + 参考文献元数据
  notes?: string;
  references?: Array<{ name?: string; path?: string; size?: number }>;
  // 客户上传的数据文件（提交包内相对路径）
  dataFiles?: IntakeExtras['dataFiles'];
  groupingDesign?: {
    mode?: string;
    groups?: Array<{ groupName?: string; role?: string; stageOrder?: number; colorHex?: string; sampleIds?: string[] }>;
    contrasts?: Array<{ name?: string; case?: string; ctrl?: string; isPrimary?: boolean }>;
  };
  pipelineDag?: Array<{ order?: number; stepId?: string }>;
  aclAndOutput?: { expectedFormats?: string[]; targetKoGene?: string };
  // aims v3.0 intake 四块 + 独立验证集映射（工作台不改写，原样落进 project.json）
  biologicalPriors?: IntakeExtras['biologicalPriors'];
  analysisCutoffs?: IntakeExtras['analysisCutoffs'];
  plotLayoutConfig?: IntakeExtras['plotLayoutConfig'];
  experimentalDesign?: IntakeExtras['experimentalDesign'];
  validationGroupMapping?: IntakeExtras['validationGroupMapping'];
};

/**
 * 客户在用户端填的 v3.0 intake 契约块。
 * 工作台这里只做透传：这些值决定下游脚本的阈值、统计模型与出图模板，
 * 重新推导会与客户确认过的需求单不一致，所以不提供改写，只展示。
 */
export type IntakeExtras = {
  biologicalPriors?: { focusGenes?: string[]; targetKoGene?: string; koFallbackPolicy?: string };
  // 数值键与 server/project.js normalizeAnalysisCutoffs 同形（snake_case；maxMtPercent 为 portal 旧写法兼容）
  analysisCutoffs?: { profile?: string; log2fc_threshold?: number; padj_threshold?: number; p_threshold?: number; max_mt_percent?: number; maxMtPercent?: number };
  plotLayoutConfig?: { templateId?: string };
  experimentalDesign?: { isPaired?: boolean; pairMap?: Record<string, string>; covariates?: { batchCol?: string; adjustedVariables?: string[] } };
  validationGroupMapping?: { valControlSamples?: string[]; valTreatSamples?: string[] } | null;
  // 客户上传的数据文件（提交包内相对路径），建项时由服务端复制到本项目本线 raw_data/
  dataFiles?: Array<{ role?: string; bind?: string; name?: string; path?: string; size?: number; sha256?: string }>;
};

// 五维自检。sub_checks 是合并报灯下的结构化子灯（P17：第 4 维把隔离与 SHA256 合成一盏，
// 但前端要点名坏在哪一盏上），旧后端不下发该字段，故可选。
export type SelfCheckSubItem = { id: string; label: string; status: string; value: string; detail: string };
export type SelfCheckItem = {
  id: string;
  label: string;
  status: string;
  value: string;
  detail: string;
  sub_checks?: SelfCheckSubItem[];
};
export type SelfCheckResponse = { all_pass: boolean; checks: SelfCheckItem[] };

// 图件
export type FigureEntry = { name: string; size: number; mtime: number; caption?: string; sizeLabel?: string };

/** Studio 顶部展示的项目出图配置（只读，来自 /api/projects/meta） */
export type ProjectMetaBrief = {
  projectId: string;
  plotLayoutConfig: { template_id?: string; dpi?: number; theme_rules?: Record<string, unknown> } | null;
  analysisCutoffs: { profile?: string; log2fc_threshold?: number; padj_threshold?: number } | null;
  dataSourceMode: string;
  focusGenes: string[];
  targetKoGene: string;
  stepCount: number;
};


export type FiguresResponse =
  | { blocked: true; lineId: string; reason: string; hint: string; figures: [] }
  | { blocked: false; lineId: string; dir: string; source?: 'local' | 'remote'; figures: FigureEntry[] }
  | { error: string };

export type FigureTemplateItem = {
  id: string;
  name: string;
  level: string;
  category: string;
  language: string;
  deps_status: string;
  verified: boolean;
  preview: string | null;
  source_sha256: string | null;
  linked_mods: string[];
  adapt_vars: Record<string, string>;
  block_reason: string;
};
export type FigureTemplateResponse = {
  ok?: boolean;
  registry_ok?: boolean;
  registry_errors?: string[];
  stats?: { templates: number; ready: number; pending: number; blocked: number };
  lineId?: string;
  templates?: FigureTemplateItem[];
  error?: string;
};
export type FigureAdaptResponse = {
  ok: boolean;
  projectId: string;
  lineId: string;
  template_id: string;
  selected_mods: string[];
  local_path: string;
  remote_path: string;
  master_sha256: string;
  derived_sha256: string;
  task: {
    projectId: string;
    lineId: string;
    step: string;
    inputs: string[];
    outputs: string[];
    seed: number;
  };
};

// 文件树
export type TreeNode = { name: string; path: string; type: 'd' | 'f'; size: number; mtime: number; children: TreeNode[] };
export type FilesResponse =
  | { blocked: true; lineId: string; reason: string; hint: string; tree: null }
  | { blocked: false; lineId: string; root: string; tree: TreeNode }
  | { error: string };

// 任务
export type TaskEntry = {
  task_id: string;
  line_id: string;
  step_name: string;
  status: string;
  start_time: string;
  end_time: string;
  checkpoint_status: string;
  error_log: string | null;
  exit_code: number | null;
  environment: { random_seed: number | null };
};
export type LogLine = { stream: 'stdout' | 'stderr'; text: string };

// 台账
export type LedgerEntry = {
  file: string;
  path: string;
  lineId: string | null;
  stepName: string | null;
  status: string | null;
  problems: string[];
  legal: boolean;
};
export type LedgerSummary = {
  total: number;
  legal: number;
  violations: number;
  byLine: Record<string, { legal: number; violations: number; steps: Record<string, string> }>;
};
export type LedgerResponse =
  | { blocked: true; reason: string; hint: string; summary: null }
  | { blocked: false; dir: string; summary: LedgerSummary; entries: LedgerEntry[] }
  | { error: string; hint?: string };

// 上传
export type UploadValidation = { ok: boolean; reasons: string[]; warnings: string[]; magic: string; modality: string };
export type UploadResult = {
  ok?: boolean;
  validation?: UploadValidation;
  remotePath?: string;
  localSize?: number;
  remoteSize?: number | null;
  sizeMatch?: boolean;
  hint?: string;
  error?: string;
};
// 上传会话（断点续传）的纯逻辑在 src/lib/uploadSession.ts：
// 文件指纹与确定性 uploadId 的权威定义是仓库根 shared/upload_session.mjs，
// 前端与 server/upload.js 同源，保证两边算出同一个会话 id。
// 抽成独立模块是为了让 node --test 直接 import 覆盖指纹、夹取、缓存损坏等分支。

// 三态守卫
export type ApiState<T> = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ok'; data: T };
