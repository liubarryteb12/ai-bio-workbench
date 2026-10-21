import { useEffect, useState, useCallback, useRef } from 'react';
import './app.css';

import { LINES, LINE_LABELS } from '../server/domain.js';
import {
  fileFingerprint, forgetUploadId, readStoredUploadId, resumeStartIndex, storeUploadId,
  uploadIdFromFingerprint,
} from './lib/uploadSession';
import type { UploadStatus } from './lib/uploadSession';

// ============================================================
// 类型定义
// ============================================================

type Compute = {
  cpus: string | null;
  cpusTotal?: string | null;
  memoryGb: string | null;
  memoryAvailGb?: string | null;
  disk: string | null;
};
type Segment = { name: string; pass: boolean; detail?: string; compute?: Compute | null; entries?: Array<{ local: string; remote: string; purpose: string; pass: boolean; action: string }> };
type Service = { name: string; state: string; running: boolean; logCrashLoop: boolean };
type LinkResult = {
  overall: 'pass' | 'warn' | 'fail';
  segments: Segment[];
  services: Service[];
  compute: Compute;
  checkedAt: string;
};
type LinkResponse = { serial: string; adb: string; link: LinkResult } | { error: string; hint?: string };

type ProjectMeta = {
  project_id: string;
  name?: string;
  description?: string;
  created_at: string;
  lines: string[];
  // v3 契约把项目名放在 basic_info 里，顶层 name 只有 schema_version 1 的旧项目才有
  basic_info?: { name?: string; description?: string; disease?: string };
};
type ProjectEntry = { projectId: string; meta: ProjectMeta | null };
type ProjectsResponse = { defaultProject: string; projects: ProjectEntry[] };

/** 项目选择器显示名：v3 读 basic_info.name，旧项目读顶层 name，都没有才用 ID */
const projectDisplayName = (item: ProjectEntry): string =>
  item.meta?.basic_info?.name || item.meta?.name || item.projectId;

// 黑名单校验结果
type BlacklistResult = { hit: boolean; matches: string[]; hint?: string };

// 步骤元信息
type StepMeta = {
  label: string;
  desc: string;
  tool: string;
  io: string;
  note: string;
};

// 步骤列表
type StepsResponse = {
  steps: {
    line1_bulk: string[];
    line2_scrna: string[];
    line3_spatial: string[];
  };
  meta: Record<string, StepMeta>;
};

// 分组设计
type GroupMode = 'two_group' | 'multi_group' | 'ordered_stage';
type GroupRole = 'reference' | 'disease_stage';

type GroupEntry = {
  groupId: string;
  groupName: string;
  role: GroupRole;
  stageOrder: number;
  colorHex: string;
  sampleIdsText: string; // 多行文本域原始内容
};

type Contrast = {
  name: string;
  case: string;
  ctrl: string;
  isPrimary: boolean;
  enabled: boolean;
};

// 客户需求收件箱（portal/inbox）
// 数据集 ↔ 平台配对：一行一组 GSE↔GPL，role 标明训练 / 验证；
// dataType / sampleCount / tissue 是行级三元组（留空表示沿用项目级）
type DatasetRow = {
  gse: string;
  gpl: string;
  role: 'train' | 'validation';
  dataType?: string;
  sampleCount?: number | string;
  tissue?: string;
};
// 客户在用户端上传的参考文献元数据（文件本体留在 portal/inbox/refs/<sid>/ 下）
type ReferenceMeta = { name: string; path: string; size: number };
type InboxSummary = {
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
type InboxItem = {
  file: string;
  size: number;
  mtime: string;
  summary: InboxSummary | null;
  parseError: string | null;
  // 新提交包才有：包目录名与附件计数（旧平铺 JSON 为 null）
  packageDir?: string | null;
  attachments?: { references?: number; data_files?: number } | null;
};
type InboxResponse = {
  blocked: boolean;
  reason?: string;
  detail?: string;
  dir?: string;
  items: InboxItem[];
};

// 用户提交台导出的需求文件（manifest v1.0）
type PortalManifest = {
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
type IntakeExtras = {
  biologicalPriors?: { focusGenes?: string[]; targetKoGene?: string; koFallbackPolicy?: string };
  // 数值键与 server/project.js normalizeAnalysisCutoffs 同形（snake_case；maxMtPercent 为 portal 旧写法兼容）
  analysisCutoffs?: { profile?: string; log2fc_threshold?: number; padj_threshold?: number; p_threshold?: number; max_mt_percent?: number; maxMtPercent?: number };
  plotLayoutConfig?: { templateId?: string };
  experimentalDesign?: { isPaired?: boolean; pairMap?: Record<string, string>; covariates?: { batchCol?: string; adjustedVariables?: string[] } };
  validationGroupMapping?: { valControlSamples?: string[]; valTreatSamples?: string[] } | null;
  // 客户上传的数据文件（提交包内相对路径），建项时由服务端复制到本项目本线 raw_data/
  dataFiles?: Array<{ role?: string; bind?: string; name?: string; path?: string; size?: number; sha256?: string }>;
};

// 五维自检
type SelfCheckItem = { id: string; label: string; status: string; value: string; detail: string };
type SelfCheckResponse = { all_pass: boolean; checks: SelfCheckItem[] };

// 图件
type FigureEntry = { name: string; size: number; mtime: number; caption?: string; sizeLabel?: string };

/** Studio 顶部展示的项目出图配置（只读，来自 /api/projects/meta） */
type ProjectMetaBrief = {
  projectId: string;
  plotLayoutConfig: { template_id?: string; dpi?: number; theme_rules?: Record<string, unknown> } | null;
  analysisCutoffs: { profile?: string; log2fc_threshold?: number; padj_threshold?: number } | null;
  dataSourceMode: string;
  focusGenes: string[];
  targetKoGene: string;
  stepCount: number;
};

// R13：键改为服务端现行两档 id（server/project.js PLOT_LAYOUT_TEMPLATES 同源）；
// 收敛前旧 id 保留兼容映射（project.js LEGACY_TEMPLATE_IDS 同源），旧项目照新档显示
const LAYOUT_TEMPLATE_LABEL: Record<string, string> = {
  template_4x3: '4:3 标准型（图例右侧 · 单栏插图）',
  template_16x9: '16:9 宽幅型（图例底部 · 横向宽幅）',
  template_1_nature_side: '4:3 标准型（图例右侧 · 单栏插图）',
  template_2_cell_wide: '16:9 宽幅型（图例底部 · 横向宽幅）',
  template_3_clinical_note: '4:3 标准型（图例右侧 · 单栏插图）',
};
type FiguresResponse =
  | { blocked: true; lineId: string; reason: string; hint: string; figures: [] }
  | { blocked: false; lineId: string; dir: string; source?: 'local' | 'remote'; figures: FigureEntry[] }
  | { error: string };

// 文件树
type TreeNode = { name: string; path: string; type: 'd' | 'f'; size: number; mtime: number; children: TreeNode[] };
type FilesResponse =
  | { blocked: true; lineId: string; reason: string; hint: string; tree: null }
  | { blocked: false; lineId: string; root: string; tree: TreeNode }
  | { error: string };

// 任务
type TaskEntry = {
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
type LogLine = { stream: 'stdout' | 'stderr'; text: string };

// 台账
type LedgerEntry = {
  file: string;
  path: string;
  lineId: string | null;
  stepName: string | null;
  status: string | null;
  problems: string[];
  legal: boolean;
};
type LedgerSummary = {
  total: number;
  legal: number;
  violations: number;
  byLine: Record<string, { legal: number; violations: number; steps: Record<string, string> }>;
};
type LedgerResponse =
  | { blocked: true; reason: string; hint: string; summary: null }
  | { blocked: false; dir: string; summary: LedgerSummary; entries: LedgerEntry[] }
  | { error: string; hint?: string };

// 上传
type UploadValidation = { ok: boolean; reasons: string[]; warnings: string[]; magic: string; modality: string };
type UploadResult = {
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
type ApiState<T> = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ok'; data: T };

function readApiState<T extends object>(raw: T | { error: string } | null): ApiState<T> {
  if (raw === null) return { kind: 'loading' };
  if ('error' in raw) return { kind: 'failed', message: raw.error };
  return { kind: 'ok', data: raw as T };
}

// ============================================================
// 视图枚举
// ============================================================

type ViewKey = 'onboarding' | 'console' | 'preflight' | 'studio';

const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: 'onboarding', label: '新建项目向导' },
  { key: 'console', label: '分析输入控制台' },
  { key: 'preflight', label: '五维自检' },
  { key: 'studio', label: '结果预览 Studio' },
];

const SUBDIRS = ['raw_data', 'processed', 'results', 'envs'];

const SPECIES_OPTIONS = ['Homo sapiens', 'Mus musculus', 'Rattus norvegicus'];
const DOMAIN_OPTIONS = [
  '心脑血管',
  '神经退行',
  '代谢',
  '纤维化',
  '发育',
  '免疫',
  '其他非肿瘤',
];
const DATA_SOURCES = ['GEO', 'ArrayExpress', '自有数据'];

// 数据来源双模态（aims v2.8，与 server/domain.js DATA_SOURCE_MODES 同值）
type DataSourceMode = 'PUBLIC_DB' | 'IN_HOUSE_UPLOAD';
// 自有上传矩阵的基因标识符类型 / 表达量量纲（server/domain.js ID_TYPES / VALUE_SCALES 同值）
const ID_TYPE_OPTIONS = [
  { id: 'Gene_Symbol', label: 'Gene Symbol（已注释好）' },
  { id: 'Ensembl_ID', label: 'Ensembl ID（自动剥离版本号）' },
  { id: 'Entrez_ID', label: 'Entrez ID（纯数字，走物种 OrgDb 转换）' },
];
const VALUE_SCALE_OPTIONS = [
  { id: 'Raw_Counts', label: 'Raw Counts（原始整数计数）' },
  { id: 'TPM_FPKM', label: 'TPM / FPKM（已标准化非负实数）' },
  { id: 'Log2_Normalized', label: 'Log2 Normalized（已对数化）' },
];
// 出图画幅两档（server/project.js PLOT_LAYOUT_TEMPLATES 同源，照 portal/index.html 先例）
const LAYOUT_TEMPLATE_OPTIONS = [
  { id: 'template_4x3', label: '4:3（图例右侧 · 单栏插图）' },
  { id: 'template_16x9', label: '16:9（图例底部 · 横向宽幅）' },
];
const LAYOUT_LEGACY_TO_NEW: Record<string, string> = {
  template_1_nature_side: 'template_4x3',
  template_2_cell_wide: 'template_16x9',
  template_3_clinical_note: 'template_4x3',
};
// 统计阈值三档（server/project.js ANALYSIS_CUTOFFS 同值）
const CUTOFF_PROFILE_OPTIONS = [
  { id: 'standard_sci', label: '标准科研档（log2FC ≥ 1.0，padj < 0.05）' },
  { id: 'sensitive', label: '灵敏档（log2FC ≥ 0.585，p < 0.05）' },
  { id: 'strict', label: '严格档（log2FC ≥ 1.5，padj < 0.01）' },
];
// 虚拟敲除靶基因检出率不足时的兜底策略（server/project.js KO_FALLBACK_POLICIES 同值）
const KO_FALLBACK_OPTIONS = [
  { id: 'strict_abort', label: '检出率不足即中止（strict_abort）' },
  { id: 'auto_recommend', label: '自动推荐替代基因（auto_recommend）' },
];
// WGCNA 参数（server/project.js WGCNA_CONFIG_DEFAULTS 同键，留空走服务端默认）
const WGCNA_PARAM_FIELDS: Array<{ key: string; label: string; placeholder: string }> = [
  { key: 'top_n_genes', label: 'Top N 高变基因', placeholder: '5000' },
  { key: 'min_module_size', label: '最小模块基因数', placeholder: '20' },
  { key: 'merge_cut_height', label: '模块合并阈值', placeholder: '0.25' },
  { key: 'deep_split', label: '聚类深度 deepSplit', placeholder: '2' },
  { key: 'max_block_size', label: '单块最大基因数', placeholder: '5000' },
  { key: 'module_p_threshold', label: '模块-表型 p 阈值', placeholder: '0.05' },
  { key: 'hub_kme_min', label: 'Hub kME 下限', placeholder: '0.8' },
  { key: 'hub_gs_min', label: 'Hub GS 下限', placeholder: '0.2' },
];

/**
 * 数据类型 → 分析线。
 * 与 server/domain.js 的 DATA_TYPES、用户端 portal/index.html 的 DATA_TYPE_LINE 同值枚举
 * （两端解耦不共享代码，各自持有同一份约定）。服务端接口也返回 suggestedLine，
 * 导入时以接口值为准，这里供"手工新建"时选类型即选线用。
 */
const DATA_TYPE_OPTIONS: Array<{ id: string; label: string; line: string }> = [
  { id: 'microarray', label: '基因芯片（表达谱）', line: 'line1_bulk' },
  { id: 'bulk_rnaseq', label: 'Bulk RNA-seq（转录组测序）', line: 'line1_bulk' },
  { id: 'scrna', label: '单细胞转录组（scRNA-seq）', line: 'line2_scrna' },
  { id: 'spatial', label: '空间转录组（Visium 等）', line: 'line3_spatial' },
];
const lineFromDataType = (id: string): string =>
  DATA_TYPE_OPTIONS.find((d) => d.id === id)?.line || '';

// ============================================================
// App 主组件
// ============================================================

export function App() {
  const [view, setView] = useState<ViewKey>('onboarding');
  const [project, setProject] = useState<string>('default');
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [projectError, setProjectError] = useState<string | null>(null);
  const projectInit = useRef(false);

  const refreshProjects = useCallback(async () => {
    try {
      const response = await fetch('/api/projects/list');
      const payload = (await response.json()) as ProjectsResponse;
      setProjects(payload.projects);
      setProject((prev) => {
        if (!projectInit.current) {
          projectInit.current = true;
          return payload.defaultProject || 'default';
        }
        if (payload.projects.some((item) => item.projectId === prev)) return prev;
        return payload.defaultProject || 'default';
      });
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  // 项目列表只在挂载时拉一次会长期停留在旧快照：项目可能在别处新增
  // （用户端提交后由工作台建项、另一个标签页建项），切视图/回到本页时必须重拉，
  // 否则选择器里只剩当时存在的 default（2026-10-19 实测踩到）。
  useEffect(() => {
    void refreshProjects();
  }, [view, refreshProjects]);

  useEffect(() => {
    const reload = () => {
      if (document.visibilityState === 'visible') void refreshProjects();
    };
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', reload);
    return () => {
      window.removeEventListener('focus', reload);
      document.removeEventListener('visibilitychange', reload);
    };
  }, [refreshProjects]);

  return (
    <div className="app-root">
      <header className="app-header">
        <h1 className="app-title">BioanalysDesktop</h1>
        <div className="app-header-sep" />
        <nav className="tab-nav">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className={`tab-nav-item${view === v.key ? ' tab-nav-item-active' : ''}`}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <div className="project-selector-wrap">
          <span className="project-selector-label">当前项目</span>
          <select
            className="project-selector"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            {projects.length === 0 ? (
              <option value={project}>{project}</option>
            ) : projects.map((item) => (
              <option key={item.projectId} value={item.projectId}>
                {projectDisplayName(item)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            style={{ marginLeft: 8, padding: '4px 10px', fontSize: 12 }}
            onClick={() => void refreshProjects()}
            title="重新读取项目列表"
          >
            刷新
          </button>
        </div>
      </header>

      {projectError && (
        <div className="card" style={{ margin: 16 }}>
          <p className="error-text">项目列表错误：{projectError}</p>
        </div>
      )}

      {view === 'onboarding' && <OnboardingPortal onCreated={refreshProjects} onProjectSet={setProject} />}
      {view === 'console' && <CustomerInputConsole project={project} />}
      {view === 'preflight' && <PreFlightDashboard />}
      {view === 'studio' && <ResultPreviewStudio project={project} />}
    </div>
  );
}

// ============================================================
// 视图1：新建项目向导页（Onboarding Portal）
// ============================================================

function OnboardingPortal({
  onCreated,
  onProjectSet,
}: {
  onCreated: () => Promise<void>;
  onProjectSet: (id: string) => void;
}) {
  // 模块 A
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // 客户备注 / 分析需求补充（来自用户端导入）
  const [notes, setNotes] = useState('');
  // 客户上传的参考文献元数据（只读展示 + 随建项落进项目 meta）
  const [references, setReferences] = useState<ReferenceMeta[]>([]);
  // v3.0 intake 契约块：从需求文件原样透传，建项时一并写入 project.json
  const [intakeExtras, setIntakeExtras] = useState<IntakeExtras | null>(null);
  const [species, setSpecies] = useState(SPECIES_OPTIONS[0]);
  const [domain, setDomain] = useState(DOMAIN_OPTIONS[0]);
  const [disease, setDisease] = useState('');

  // 模块 B
  const [dataSource, setDataSource] = useState(DATA_SOURCES[0]);
  // 数据来源双模态（R2）：PUBLIC_DB 公共库 / IN_HOUSE_UPLOAD 自有上传（LOC 编号，服务端派生）
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>('PUBLIC_DB');
  // 自有数据三件套（dualmode 契约必填：id_type / value_scale / train_matrix）
  const [idType, setIdType] = useState(ID_TYPE_OPTIONS[0].id);
  const [valueScale, setValueScale] = useState(VALUE_SCALE_OPTIONS[0].id);
  const [trainMatrixPath, setTrainMatrixPath] = useState('');
  const [valMatrixPath, setValMatrixPath] = useState('');
  const [dataType, setDataType] = useState('');
  // 数据集 ↔ 平台配对表：可增删，一行一组 GSE↔GPL + 训练/验证用途
  const [datasetRows, setDatasetRows] = useState<DatasetRow[]>([
    { gse: '', gpl: '', role: 'train', dataType: '', sampleCount: '', tissue: '' },
    { gse: '', gpl: '', role: 'validation', dataType: '', sampleCount: '', tissue: '' },
  ]);
  const [sampleCount, setSampleCount] = useState('');
  const [tissue, setTissue] = useState('');
  const [groupMode, setGroupMode] = useState<GroupMode>('two_group');
  const [groups, setGroups] = useState<GroupEntry[]>([
    { groupId: 'g1', groupName: 'Control', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIdsText: '' },
    { groupId: 'g2', groupName: 'Disease', role: 'disease_stage', stageOrder: 1, colorHex: '#EE6C4D', sampleIdsText: '' },
  ]);
  const [contrasts, setContrasts] = useState<Contrast[]>([]);
  const [primaryContrast, setPrimaryContrast] = useState<string>('');
  const [bulkPasteOpen, setBulkPasteOpen] = useState(false);
  const [bulkPasteText, setBulkPasteText] = useState('');
  const groupIdCounter = useRef(2);

  // 模块 C
  const [selectedLine, setSelectedLine] = useState<string>('');
  const [stepsData, setStepsData] = useState<StepsResponse['steps'] | null>(null);
  const [stepsMeta, setStepsMeta] = useState<Record<string, StepMeta>>({});
  const [selectedSteps, setSelectedSteps] = useState<string[]>([]);
  const [koGene, setKoGene] = useState('');

  // 模块 E · v3 intake 分析契约（R2：字段形状照 v3_intake.test.js / server/project.js 归一化契约）
  const [layoutTemplate, setLayoutTemplate] = useState('template_4x3');
  const [cutoffProfile, setCutoffProfile] = useState('standard_sci');
  // 显式数值覆盖：留空走档位预设（服务端 normalizeAnalysisCutoffs 只认 snake_case 键）
  const [cutoffOverrides, setCutoffOverrides] = useState<Record<string, string>>({
    log2fc_threshold: '', padj_threshold: '', p_threshold: '', max_mt_percent: '',
  });
  const [focusGenesText, setFocusGenesText] = useState('');
  const [koFallbackPolicy, setKoFallbackPolicy] = useState('strict_abort');
  const [isPaired, setIsPaired] = useState(false);
  // 每行「样本=供体/配对」，如 GSM1=Donor_01
  const [pairMapText, setPairMapText] = useState('');
  const [batchCol, setBatchCol] = useState('');
  const [adjustedVarsText, setAdjustedVarsText] = useState('');
  const [valControlText, setValControlText] = useState('');
  const [valTreatText, setValTreatText] = useState('');
  // WGCNA 参数：全部选填，留空由服务端取契约默认（normalizeWgcnaConfig）
  const [wgcnaParams, setWgcnaParams] = useState<Record<string, string>>({
    top_n_genes: '', min_module_size: '', merge_cut_height: '', deep_split: '',
    power_rule: '', module_p_threshold: '', hub_kme_min: '', hub_gs_min: '', max_block_size: '',
  });

  // 模块 D
  const [owner, setOwner] = useState('');
  const [collaborators, setCollaborators] = useState('');
  const [outputItems, setOutputItems] = useState<Record<string, boolean>>({
    web_preview: true,
    tsv_tables: true,
    pdf_vector: false,
    checkpoint_archive: true,
    audit_ledger: true,
  });

  // 黑名单校验
  const [blName, setBlName] = useState<BlacklistResult | null>(null);
  const [blDesc, setBlDesc] = useState<BlacklistResult | null>(null);
  const [blDisease, setBlDisease] = useState<BlacklistResult | null>(null);

  // 提交
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState<string | null>(null);

  // 客户需求导入（portal/inbox）
  const [inbox, setInbox] = useState<InboxResponse | null>(null);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [importedFrom, setImportedFrom] = useState<string | null>(null);
  const [importNotes, setImportNotes] = useState<string[]>([]);

  // 加载步骤列表
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/projects/steps');
        const payload = (await res.json()) as StepsResponse;
        setStepsData(payload.steps);
        setStepsMeta(payload.meta || {});
      } catch {
        // 静默，用户选线时再看有没有
      }
    })();
  }, []);

  // 黑名单实时校验
  const checkBlacklist = useCallback(async (text: string, setter: (r: BlacklistResult) => void) => {
    if (!text.trim()) {
      setter({ hit: false, matches: [] });
      return;
    }
    try {
      const res = await fetch('/api/blacklist/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const payload = (await res.json()) as BlacklistResult;
      setter(payload);
    } catch {
      // 网络不通时不阻塞用户输入
      setter({ hit: false, matches: [] });
    }
  }, []);

  // 防抖黑名单校验
  const blTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedCheck = useCallback(
    (text: string, setter: (r: BlacklistResult) => void) => {
      if (blTimer.current) clearTimeout(blTimer.current);
      blTimer.current = setTimeout(() => void checkBlacklist(text, setter), 350);
    },
    [checkBlacklist]
  );

  const onNameChange = (v: string) => { setName(v); debouncedCheck(v, setBlName); };
  const onDescChange = (v: string) => { setDescription(v); debouncedCheck(v, setBlDesc); };
  const onDiseaseChange = (v: string) => { setDisease(v); debouncedCheck(v, setBlDisease); };

  // 选线时重置步骤勾选
  const onSelectLine = (line: string) => {
    setSelectedLine(line);
    setSelectedSteps([]);
  };

  // 数据集↔平台配对表：改某一行、增行、删行
  const updateDatasetRow = (index: number, patch: Partial<DatasetRow>) => {
    setDatasetRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const addDatasetRow = () => {
    setDatasetRows((rows) => [...rows, {
      gse: '', gpl: '', role: rows.length ? 'validation' : 'train',
      // 新行默认继承项目级三元组，只需改有差异的那几行
      dataType: dataType || '',
      sampleCount: sampleCount || '',
      tissue: tissue || '',
    }]);
  };
  const removeDatasetRow = (index: number) => {
    setDatasetRows((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== index)));
  };

  // 步骤勾选
  const onToggleStep = (step: string) => {
    // QC 步骤固定不可取消
    const isQC = step.toLowerCase().includes('qc');
    if (isQC && selectedSteps.includes(step)) return;
    setSelectedSteps((prev) =>
      prev.includes(step) ? prev.filter((s) => s !== step) : [...prev, step]
    );
  };

  // QC 步骤自动选中
  useEffect(() => {
    if (!selectedLine || !stepsData) return;
    const lineStepList = stepsData[selectedLine as keyof typeof stepsData];
    if (!lineStepList) return;
    const qcSteps = lineStepList.filter((s) => s.toLowerCase().includes('qc'));
    setSelectedSteps((prev) => {
      const merged = new Set(prev);
      for (const qc of qcSteps) merged.add(qc);
      return Array.from(merged);
    });
  }, [selectedLine, stepsData]);

  // 是否含 knockout 步骤
  const hasKnockout = selectedSteps.some((s) => s.toLowerCase().includes('knockout'));

  // ===== 模块 B 辅助函数 =====
  const COLOR_PALETTE = ['#3B4992', '#EE6C4D', '#00A896', '#F4A261', '#E76F51', '#7B2CBF', '#06A77D', '#D62828'];

  const parseSampleIds = (text: string): string[] =>
    text.split(/[,\s\n\r]+/).map((s) => s.trim()).filter(Boolean);

  // 配对设计 pairMap：每行「样本=供体/配对」，兼容 = , : tab 分隔
  const parsePairMap = (text: string): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const line of text.split(/[\n;；]+/)) {
      const parts = line.split(/[=,，:：\t]/).map((p) => p.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) map[parts[0]] = parts[1];
    }
    return map;
  };

  // 跨组查重：返回出现多次的样本 ID 集合
  const duplicateSamples = (() => {
    const allIds: string[] = [];
    for (const g of groups) {
      allIds.push(...parseSampleIds(g.sampleIdsText));
    }
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const id of allIds) {
      if (seen.has(id)) dupes.add(id);
      else seen.add(id);
    }
    return dupes;
  })();

  const isGroupDuplicate = (group: GroupEntry): boolean => {
    const ids = parseSampleIds(group.sampleIdsText);
    return ids.some((id) => duplicateSamples.has(id));
  };

  const addGroup = () => {
    groupIdCounter.current += 1;
    const idx = groups.length;
    const newGroup: GroupEntry = {
      groupId: `g${groupIdCounter.current}`,
      groupName: `Group ${idx + 1}`,
      role: 'disease_stage',
      stageOrder: idx,
      colorHex: COLOR_PALETTE[idx % COLOR_PALETTE.length],
      sampleIdsText: '',
    };
    setGroups((prev) => [...prev, newGroup]);
  };

  const removeGroup = (groupId: string) => {
    if (groups.length <= 2) return;
    setGroups((prev) => prev.filter((g) => g.groupId !== groupId));
  };

  const updateGroup = (groupId: string, patch: Partial<GroupEntry>) => {
    setGroups((prev) => prev.map((g) => (g.groupId === groupId ? { ...g, ...patch } : g)));
  };

  const moveGroupUp = (index: number) => {
    if (index === 0) return;
    setGroups((prev) => {
      const arr = [...prev];
      [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
      // 重新分配 stageOrder
      return arr.map((g, i) => ({ ...g, stageOrder: i }));
    });
  };

  const moveGroupDown = (index: number) => {
    setGroups((prev) => {
      const arr = [...prev];
      if (index >= arr.length - 1) return prev;
      [arr[index + 1], arr[index]] = [arr[index], arr[index + 1]];
      return arr.map((g, i) => ({ ...g, stageOrder: i }));
    });
  };

  // 设置 role 时确保只有一个 reference
  const setGroupRole = (groupId: string, newRole: GroupRole) => {
    setGroups((prev) => {
      let updated = prev.map((g) =>
        g.groupId === groupId ? { ...g, role: newRole } : g
      );
      // 如果设为 reference，把其他组改为 disease_stage
      if (newRole === 'reference') {
        updated = updated.map((g) =>
          g.groupId === groupId ? g : { ...g, role: 'disease_stage' as GroupRole }
        );
      }
      // 确保至少有一个 reference
      if (!updated.some((g) => g.role === 'reference')) {
        updated[0] = { ...updated[0], role: 'reference' as GroupRole };
      }
      return updated;
    });
  };

  // 一键粘贴分组表
  const applyBulkPaste = () => {
    const lines = bulkPasteText.trim().split(/\r?\n/).filter(Boolean);
    const groupMap = new Map<string, string[]>(); // groupName -> sampleIds
    for (const line of lines) {
      const parts = line.split(/[,\t]/).map((p) => p.trim());
      if (parts.length < 2) continue;
      const sampleId = parts[0];
      const groupName = parts[1];
      if (!sampleId || !groupName) continue;
      if (!groupMap.has(groupName)) groupMap.set(groupName, []);
      groupMap.get(groupName)!.push(sampleId);
    }
    if (groupMap.size === 0) return;
    const groupNames = Array.from(groupMap.keys());
    const newGroups: GroupEntry[] = groupNames.map((gName, i) => ({
      groupId: `g${i + 1}`,
      groupName: gName,
      role: i === 0 ? 'reference' : 'disease_stage',
      stageOrder: i,
      colorHex: COLOR_PALETTE[i % COLOR_PALETTE.length],
      sampleIdsText: (groupMap.get(gName) || []).join(', '),
    }));
    groupIdCounter.current = newGroups.length;
    setGroups(newGroups);
    setBulkPasteOpen(false);
    setBulkPasteText('');
  };

  // 自动生成对比对（分组 >= 3 时）
  useEffect(() => {
    if (groups.length < 3) {
      setContrasts([]);
      setPrimaryContrast('');
      return;
    }
    const newContrasts: Contrast[] = [];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const caseGroup = groups[j].groupName;
        const ctrlGroup = groups[i].groupName;
        const name = `${caseGroup} vs ${ctrlGroup}`;
        newContrasts.push({ name, case: caseGroup, ctrl: ctrlGroup, isPrimary: false, enabled: true });
      }
    }
    setContrasts(newContrasts);
    // 默认主对比为第一个
    if (newContrasts.length > 0 && !newContrasts.some((c) => c.name === primaryContrast)) {
      setPrimaryContrast(newContrasts[0].name);
    }
  }, [groups]);

  const toggleContrast = (name: string) => {
    setContrasts((prev) => prev.map((c) => (c.name === name ? { ...c, enabled: !c.enabled } : c)));
  };

  const setPrimaryContrastItem = (name: string) => {
    setPrimaryContrast(name);
    setContrasts((prev) => prev.map((c) => ({ ...c, isPrimary: c.name === name })));
  };

  // ===== 模块 D 辅助函数 =====
  const toggleOutputItem = (key: string) => {
    setOutputItems((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // 黑名单是否命中
  const blacklistHit = blName?.hit || blDesc?.hit || blDisease?.hit || false;

  // 能否提交
  const canSubmit =
    projectId.trim() !== '' &&
    name.trim() !== '' &&
    !blacklistHit &&
    selectedLine !== '' &&
    selectedSteps.length > 0 &&
    !submitting;

  const submit = useCallback(async () => {
    setSubmitError(null);
    setSubmitOk(null);
    if (!projectId.trim()) { setSubmitError('项目 ID 不能为空'); return; }
    if (!/^[A-Za-z0-9._-]+$/.test(projectId.trim())) { setSubmitError('项目 ID 只允许字母数字 . _ -'); return; }
    if (blacklistHit) { setSubmitError('黑名单校验未通过，请修改违规字段'); return; }
    if (!selectedLine) { setSubmitError('请选择分析线'); return; }
    if (selectedSteps.length === 0) { setSubmitError('请至少勾选一个步骤'); return; }
    if (hasKnockout && !koGene.trim()) { setSubmitError('含 knockout 步骤，请填写目标敲除基因'); return; }
    // S24/R11：数据类型决定选线，服务端 strict 校验拒绝空值，客户端先拦给出友好提示
    if (!dataType) { setSubmitError('请选择数据类型'); return; }
    // S24/R11：sampleCount 服务端要求正整数（>=1），空串/0 在这里先拦
    const sampleCountNum = Number(sampleCount);
    if (!Number.isInteger(sampleCountNum) || sampleCountNum < 1) {
      setSubmitError('样本数量必须是正整数（>=1）');
      return;
    }
    // S24/R2：自有数据三件套必填（服务端 normalizeDataSource 同规则，缺一即 400）
    if (dataSourceMode === 'IN_HOUSE_UPLOAD' && !trainMatrixPath.trim()) {
      setSubmitError('自有数据模式必须填写训练矩阵（train_matrix）');
      return;
    }
    // 行级三元组：留空可继承项目级，填了就必须合法（脏值会让预处理选错分支）
    const badCountRow = datasetRows.findIndex((r) => {
      if (r.sampleCount === '' || r.sampleCount === undefined) return false;
      const n = Number(r.sampleCount);
      return !Number.isInteger(n) || n <= 0;
    });
    if (badCountRow !== -1) {
      setSubmitError(`第 ${badCountRow + 1} 行数据集的样本数量非法（应为正整数）`);
      return;
    }
    const badTypeRow = datasetRows.findIndex(
      (r) => (r.dataType || '') && !DATA_TYPE_OPTIONS.some((d) => d.id === r.dataType)
    );
    if (badTypeRow !== -1) {
      setSubmitError(`第 ${badTypeRow + 1} 行数据集的数据类型非法`);
      return;
    }

    setSubmitting(true);
    try {
      const pipelineDag = selectedSteps.map((step, i) => ({
        order: i + 1,
        stepId: step,
        tool: '',
        lang: '',
        params: step.toLowerCase().includes('knockout') ? { target_gene: koGene.trim() } : {},
      }));

      // 组装分组设计
      const groupingDesign = {
        mode: groupMode,
        groups: groups.map((g) => ({
          groupId: g.groupId,
          groupName: g.groupName,
          role: g.role,
          stageOrder: g.stageOrder,
          colorHex: g.colorHex,
          sampleIds: parseSampleIds(g.sampleIdsText),
        })),
        contrasts: contrasts.filter((c) => c.enabled).map((c) => ({
          name: c.name,
          case: c.case,
          ctrl: c.ctrl,
          isPrimary: c.name === primaryContrast,
        })),
      };

      // 组装 ACL 与输出
      const expectedFormats: string[] = [];
      if (outputItems.web_preview) expectedFormats.push('png_300dpi');
      if (outputItems.tsv_tables) expectedFormats.push('tsv_tables');
      if (outputItems.pdf_vector) expectedFormats.push('pdf_vector');
      if (outputItems.checkpoint_archive) expectedFormats.push('rds_checkpoint');
      if (outputItems.audit_ledger) expectedFormats.push('audit_json');

      const aclAndOutput = {
        owner: owner.trim() || 'current_user',
        collaborators: collaborators.trim() ? collaborators.trim().split(/[,\s]+/) : [],
        expectedFormats,
      };

      // S24/R2：数据源按双模态组装。IN_HOUSE 不需要 GSE 编号，LOC 编号由服务端按项目 ID 派生
      const dataSourcePayload = dataSourceMode === 'IN_HOUSE_UPLOAD'
        ? {
          source: '自有数据',
          data_source_mode: 'IN_HOUSE_UPLOAD',
          id_type: idType,
          value_scale: valueScale,
          species,
          dataType,
          sampleCount: sampleCountNum,
          tissue: tissue.trim(),
          uploaded_files: {
            train_matrix: trainMatrixPath.trim(),
            val_matrix: valMatrixPath.trim() || null,
          },
        }
        : {
          source: dataSource,
          data_source_mode: 'PUBLIC_DB',
          dataType,
          // 逐行配对：多组数据必须标明「哪个 GPL 属于哪个 GSE」，否则预处理会跑偏；
          // 行级三元组留空即沿用项目级（服务端 normalizeDatasets 负责兜底）
          datasets: datasetRows
            .map((r) => ({
              gse: r.gse.trim(),
              gpl: r.gpl.trim(),
              role: r.role,
              dataType: (r.dataType || '').trim(),
              sampleCount: r.sampleCount === '' || r.sampleCount === undefined ? '' : Number(r.sampleCount),
              tissue: (r.tissue || '').trim(),
            }))
            .filter((r) => r.gse),
          sampleCount: sampleCountNum,
          tissue: tissue.trim(),
        };

      // S24/R11：显式阈值覆盖只带上非空项，其余走服务端档位预设
      const cutoffOverridePayload: Record<string, number> = {};
      for (const [key, value] of Object.entries(cutoffOverrides)) {
        if (value.trim() === '') continue;
        const n = Number(value);
        if (Number.isFinite(n)) cutoffOverridePayload[key] = n;
      }
      // WGCNA 参数：只带非空项，留空由服务端取契约默认（normalizeWgcnaConfig 逐键回落）
      const wgcnaPayload: Record<string, string> = {};
      for (const [key, value] of Object.entries(wgcnaParams)) {
        if (value.trim() !== '') wgcnaPayload[key] = value.trim();
      }

      const body = {
        projectId: projectId.trim(),
        name: name.trim(),
        description: description.trim(),
        // aims.txt:96 契约：line_id 随建项请求落进 project.json
        lineId: selectedLine,
        basicInfo: {
          name: name.trim(),
          domain,
          disease: disease.trim(),
          species,
          nonTumorVerified: true,
        },
        dataSource: dataSourcePayload,
        groupingDesign,
        pipelineDag,
        aclAndOutput,
        // 客户侧补充材料：备注原文 + 参考文献元数据（文件本体留在用户端收件箱）
        notes: notes.trim(),
        references,
        // S24/R2：aims v3.0 intake 四块由表单录入（形状照 v3_intake.test.js 契约），
        // 服务端负责归一化与校验；收件箱导入的值已映射进下方各 state，这里不再整体透传
        biologicalPriors: {
          focusGenes: parseSampleIds(focusGenesText.replace(/[，；]/g, ' ')),
          targetKoGene: koGene.trim(),
          koFallbackPolicy,
        },
        analysisCutoffs: { profile: cutoffProfile, ...cutoffOverridePayload },
        plotLayoutConfig: { templateId: layoutTemplate },
        experimentalDesign: {
          isPaired,
          pairMap: isPaired ? parsePairMap(pairMapText) : {},
          covariates: {
            batchCol: batchCol.trim(),
            adjustedVariables: parseSampleIds(adjustedVarsText.replace(/[，；]/g, ' ')),
          },
        },
        validationGroupMapping: {
          valControlSamples: parseSampleIds(valControlText.replace(/[，；]/g, ' ')),
          valTreatSamples: parseSampleIds(valTreatText.replace(/[，；]/g, ' ')),
        },
        // WGCNA 参数（选填，空键由服务端取默认）
        wgcnaConfig: wgcnaPayload,
        // 收件箱导入的客户上传数据文件（提交包内相对路径），建项时由服务端部署
        dataFiles: intakeExtras?.dataFiles ?? [],
      };

      const res = await fetch('/api/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) {
        setSubmitError(payload.error || `HTTP ${res.status}`);
        return;
      }
      setSubmitOk(payload.message || `项目 ${projectId.trim()} 创建成功`);
      // 部分数据文件部署失败时如实提示，不能只显示"成功"
      const failedFiles = Array.isArray(payload.dataFiles)
        ? payload.dataFiles.filter((f: { ok?: boolean }) => f.ok === false) : [];
      if (failedFiles.length) {
        setSubmitError(`数据文件未部署成功：${failedFiles.map((f: { name?: string; error?: string }) => `${f.name}（${f.error}）`).join('；')}`);
      }
      await onCreated();
      onProjectSet(projectId.trim());
      // 重置表单
      setProjectId(''); setName(''); setDescription(''); setDisease('');
      setNotes(''); setReferences([]);
      setIntakeExtras(null);
      setDataType(''); setSelectedLine(''); setSelectedSteps([]); setKoGene('');
      setSampleCount(''); setTissue('');
      setDataSourceMode('PUBLIC_DB'); setTrainMatrixPath(''); setValMatrixPath('');
      setDatasetRows([{ gse: '', gpl: '', role: 'train' }, { gse: '', gpl: '', role: 'validation' }]);
      setLayoutTemplate('template_4x3'); setCutoffProfile('standard_sci');
      setCutoffOverrides({ log2fc_threshold: '', padj_threshold: '', p_threshold: '', max_mt_percent: '' });
      setFocusGenesText(''); setKoFallbackPolicy('strict_abort');
      setIsPaired(false); setPairMapText(''); setBatchCol(''); setAdjustedVarsText('');
      setValControlText(''); setValTreatText('');
      setWgcnaParams({ top_n_genes: '', min_module_size: '', merge_cut_height: '', deep_split: '', power_rule: '', module_p_threshold: '', hub_kme_min: '', hub_gs_min: '', max_block_size: '' });
      setOwner(''); setCollaborators('');
      setOutputItems({ web_preview: true, tsv_tables: true, pdf_vector: false, checkpoint_archive: true, audit_ledger: true });
      setBlName(null); setBlDesc(null); setBlDisease(null);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }, [projectId, name, description, blacklistHit, selectedLine, selectedSteps, hasKnockout, koGene,
    domain, disease, species, dataSource, dataSourceMode, idType, valueScale, trainMatrixPath, valMatrixPath,
    dataType, datasetRows, sampleCount, tissue, layoutTemplate, cutoffProfile, cutoffOverrides,
    focusGenesText, koFallbackPolicy, isPaired, pairMapText, batchCol, adjustedVarsText,
    valControlText, valTreatText, wgcnaParams,
    groupMode, groups, contrasts, primaryContrast, owner, collaborators, outputItems,
    notes, references, intakeExtras, onCreated, onProjectSet]);

  const lineSteps = selectedLine && stepsData ? stepsData[selectedLine as keyof typeof stepsData] : [];

  // ------------------------------------------------------------
  // 客户需求导入：读取 portal/inbox 的 manifest 并映射到表单
  // ------------------------------------------------------------

  const loadInbox = useCallback(async () => {
    setInboxLoading(true);
    setInboxError(null);
    try {
      const res = await fetch('/api/portal/inbox');
      const payload = (await res.json()) as InboxResponse;
      setInbox(payload);
      if (payload.blocked) setInboxError(payload.reason || '收件箱不可读');
    } catch (cause) {
      setInboxError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInboxLoading(false);
    }
  }, []);

  const importFromInbox = useCallback(async (file: string) => {
    setInboxError(null);
    setImportNotes([]);
    try {
      const res = await fetch(`/api/portal/inbox/item?name=${encodeURIComponent(file)}`);
      const payload = await res.json();
      if (!res.ok) {
        setInboxError(payload.error || `HTTP ${res.status}`);
        return;
      }
      const m = payload.manifest as PortalManifest;
      // 导入结果里的提示语（与组件级 notes state 区分开：后者存客户备注原文）
      const notesList: string[] = [];

      // 1) 基础信息
      setName(m.basicInfo?.name || '');
      setDescription(m.basicInfo?.description || '');
      setDisease(m.basicInfo?.disease || '');
      if (m.basicInfo?.domain && DOMAIN_OPTIONS.includes(m.basicInfo.domain)) {
        setDomain(m.basicInfo.domain);
      } else if (m.basicInfo?.domain) {
        notesList.push(`研究领域「${m.basicInfo.domain}」不在预设列表，保留默认值`);
      }
      if (m.basicInfo?.species && SPECIES_OPTIONS.includes(m.basicInfo.species)) setSpecies(m.basicInfo.species);

      // 2) 项目 ID：从文件名时间戳派生，保证符合 [A-Za-z0-9._-]
      const stamp = /(\d{4})-(\d{2})-(\d{2})_(\d{6})/.exec(file);
      const derivedId = stamp ? `proj_${stamp[1]}${stamp[2]}${stamp[3]}_${stamp[4]}` : '';
      setProjectId(derivedId);
      if (derivedId) notesList.push(`项目 ID 已派生为 ${derivedId}，可按需修改`);

      // 3) 数据来源
      if (m.dataSource?.source && DATA_SOURCES.includes(m.dataSource.source)) setDataSource(m.dataSource.source);
      // 数据集↔平台配对：服务端已归一化（新格式透传、旧扁平格式按位置推断），
      // 这里直接用归一化结果，避免前端再实现一遍配对推断逻辑（两端规则漂移）
      const incomingDatasets: DatasetRow[] = Array.isArray(payload.datasets) ? payload.datasets : [];
      setDatasetRows(
        incomingDatasets.length
          ? incomingDatasets.map((d) => ({
              gse: d.gse || '',
              gpl: d.gpl || '',
              role: d.role === 'validation' ? 'validation' : 'train',
              // 服务端已把行级三元组兜底成项目级值；这里原样带入，导入后仍可逐行改
              dataType: d.dataType || '',
              sampleCount: d.sampleCount ?? '',
              tissue: d.tissue || '',
            }))
          : [{ gse: '', gpl: '', role: 'train' }]
      );
      if (payload.datasetsInferred) {
        notesList.push('需求文件为旧格式（GSE / GPL 分开填写、无显式对应），配对关系由服务端按位置推断，请核对后再跑预处理');
      }
      if (!incomingDatasets.some((d) => d.gse)) {
        notesList.push('需求文件未填数据集编号（GSE），跑 ingest / prep 前需补全');
      }
      setSampleCount(m.dataSource?.sampleCount ? String(m.dataSource.sampleCount) : '');
      setTissue(m.dataSource?.tissue || '');

      // 3.2) 客户补充材料：备注原文 + 参考文献元数据
      setNotes(m.notes || '');
      const incomingRefs: ReferenceMeta[] = Array.isArray(m.references)
        ? m.references
            .filter((r) => r && typeof r.path === 'string' && r.path)
            .map((r) => ({ name: r.name || r.path!.split('/').pop() || '', path: r.path!, size: Number(r.size) || 0 }))
        : [];
      setReferences(incomingRefs);
      if (incomingRefs.length) {
        notesList.push(`客户上传了 ${incomingRefs.length} 篇参考文献，文件在用户端收件箱 ${incomingRefs[0].path.split('/').slice(0, 2).join('/')}/ 下`);
      }

      // 3.1) aims v3.0 intake 契约块：S24 起表单可直接录入，导入把需求单值映射进表单 state
      //（阈值档决定显著基因数量、模板决定图幅，客户确认过的值原样搬运、仍可逐项改）
      if (m.plotLayoutConfig?.templateId) {
        const tid = m.plotLayoutConfig.templateId;
        // 旧 id 先映射成新两档（project.js LEGACY_TEMPLATE_IDS 同规则）
        setLayoutTemplate(LAYOUT_LEGACY_TO_NEW[tid] ?? tid);
        notesList.push(`出图模板：${LAYOUT_LEGACY_TO_NEW[tid] ?? tid}`);
      }
      if (m.analysisCutoffs?.profile) {
        if (CUTOFF_PROFILE_OPTIONS.some((o) => o.id === m.analysisCutoffs?.profile)) {
          setCutoffProfile(m.analysisCutoffs.profile);
        }
        notesList.push(`统计阈值档：${m.analysisCutoffs.profile}`);
      }
      const incomingCutoffs = m.analysisCutoffs;
      setCutoffOverrides({
        log2fc_threshold: incomingCutoffs?.log2fc_threshold != null ? String(incomingCutoffs.log2fc_threshold) : '',
        padj_threshold: incomingCutoffs?.padj_threshold != null ? String(incomingCutoffs.padj_threshold) : '',
        p_threshold: incomingCutoffs?.p_threshold != null ? String(incomingCutoffs.p_threshold) : '',
        max_mt_percent: incomingCutoffs?.max_mt_percent != null ? String(incomingCutoffs.max_mt_percent)
          : (incomingCutoffs?.maxMtPercent != null ? String(incomingCutoffs.maxMtPercent) : ''),
      });
      const priors = m.biologicalPriors;
      if (priors?.focusGenes?.length) {
        setFocusGenesText(priors.focusGenes.join(', '));
        notesList.push(`重点关注基因：${priors.focusGenes.join('、')}`);
      }
      if (priors?.koFallbackPolicy && KO_FALLBACK_OPTIONS.some((o) => o.id === priors.koFallbackPolicy)) {
        setKoFallbackPolicy(priors.koFallbackPolicy);
      }
      // 靶基因：模块 C 的「目标敲除基因」输入框即 biologicalPriors.targetKoGene 的录入位
      if (priors?.targetKoGene && !m.aclAndOutput?.targetKoGene) setKoGene(priors.targetKoGene);
      const design = m.experimentalDesign;
      if (design) {
        setIsPaired(design.isPaired === true);
        setPairMapText(Object.entries(design.pairMap || {}).map(([k, v]) => `${k}=${v}`).join('\n'));
        setBatchCol(design.covariates?.batchCol || '');
        setAdjustedVarsText((design.covariates?.adjustedVariables || []).join(', '));
        if (design.isPaired) notesList.push('客户声明为配对 / 同供体设计');
      }
      const vgm = m.validationGroupMapping;
      if (vgm) {
        setValControlText((vgm.valControlSamples || []).join('\n'));
        setValTreatText((vgm.valTreatSamples || []).join('\n'));
        notesList.push(`独立验证集映射：对照 ${vgm.valControlSamples?.length || 0} 例 / 处理 ${vgm.valTreatSamples?.length || 0} 例`);
      }
      // 数据文件没有表单项（提交包内相对路径），保留在 intakeExtras 随建项透传部署
      setIntakeExtras(m.dataFiles && m.dataFiles.length ? { dataFiles: m.dataFiles } : null);
      if (m.dataFiles && m.dataFiles.length) {
        notesList.push(`客户上传了 ${m.dataFiles.length} 个数据文件，建项时复制到本项目本线 raw_data/`);
      }

      // 3.5) 数据类型：决定走哪条分析线。缺失/非法则留空，由第 5 步回退到步骤反查
      const incomingDataType = m.dataSource?.dataType || '';
      const typeKnown = DATA_TYPE_OPTIONS.some((d) => d.id === incomingDataType);
      setDataType(typeKnown ? incomingDataType : '');
      if (!typeKnown) {
        notesList.push('需求文件未填数据类型（dataType），已按步骤反查分析线，请确认后补选');
      }

      // 4) 分组设计
      setGroupMode((m.groupingDesign?.mode || 'two_group') as GroupMode);
      const incomingGroups = m.groupingDesign?.groups || [];
      if (incomingGroups.length >= 2) {
        const mapped: GroupEntry[] = incomingGroups.map((g, i) => ({
          groupId: `g${i + 1}`,
          groupName: g.groupName || `Group${i + 1}`,
          role: (g.role === 'reference' ? 'reference' : 'disease_stage') as GroupRole,
          stageOrder: typeof g.stageOrder === 'number' ? g.stageOrder : i,
          colorHex: g.colorHex || (i === 0 ? '#3B4992' : '#EE0000'),
          sampleIdsText: (g.sampleIds || []).join('\n'),
        }));
        setGroups(mapped);
        groupIdCounter.current = mapped.length;
      }
      const totalSamples = incomingGroups.reduce((sum, g) => sum + (g.sampleIds || []).length, 0);
      if (totalSamples === 0) notesList.push('需求文件未填样本编号，分组表为空，跑分析前需补全');

      const mappedContrasts: Contrast[] = (m.groupingDesign?.contrasts || []).map((c) => ({
        name: c.name || '', case: c.case || '', ctrl: c.ctrl || '',
        isPrimary: !!c.isPrimary, enabled: true,
      }));
      setContrasts(mappedContrasts);
      setPrimaryContrast(mappedContrasts.find((c) => c.isPrimary)?.name || mappedContrasts[0]?.name || '');

      // 5) 分析线 + 步骤：优先用服务端按 dataType 判定的 suggestedLine；
      //    旧需求文件缺 dataType 时回退到 stepId 命中数反查（向后兼容）
      let stepsMap = stepsData;
      if (!stepsMap) {
        const r = await fetch('/api/projects/steps');
        const p = (await r.json()) as StepsResponse;
        stepsMap = p.steps;
        setStepsData(p.steps);
        setStepsMeta(p.meta || {});
      }
      const dag = (m.pipelineDag || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const requestedSteps = dag.map((d) => d.stepId).filter(Boolean) as string[];

      const serverLine = typeof payload.suggestedLine === 'string' ? payload.suggestedLine : '';
      let bestLine = serverLine && stepsMap[serverLine as keyof typeof stepsMap] ? serverLine : '';
      const lineSource = bestLine ? 'dataType' : 'stepId';
      if (!bestLine) {
        let bestHit = 0;
        for (const key of Object.keys(stepsMap) as Array<keyof typeof stepsMap>) {
          const hit = requestedSteps.filter((s) => stepsMap![key].includes(s)).length;
          if (hit > bestHit) { bestHit = hit; bestLine = key; }
        }
      }
      if (bestLine) {
        const masterOrder = stepsMap[bestLine as keyof typeof stepsMap];
        // 母版顺序即验证过的依赖顺序，避免需求文件里手写顺序与步骤依赖冲突
        const ordered = masterOrder.filter((s) => requestedSteps.includes(s));
        setSelectedLine(bestLine);
        setSelectedSteps(ordered);
        const dropped = requestedSteps.filter((s) => !masterOrder.includes(s));
        if (dropped.length) notesList.push(`以下步骤不属于 ${bestLine}，已忽略：${dropped.join('、')}`);
        if (requestedSteps.join(',') !== ordered.join(',')) {
          notesList.push('步骤已按母版依赖顺序重排（需求文件中的顺序与执行依赖不符）');
        }
        // 数据类型与步骤命中线不一致时明确告警：宁可人工确认，也不要静默跑错线
        if (lineSource === 'dataType') {
          const hits = requestedSteps.filter((s) => masterOrder.includes(s)).length;
          if (requestedSteps.length && hits < requestedSteps.length) {
            notesList.push(`需求文件的步骤与数据类型所指分析线（${bestLine}）不完全一致（${hits}/${requestedSteps.length} 命中），请人工确认`);
          }
        }
      } else {
        notesList.push('未能从需求文件识别分析线，请手动选择');
      }

      // 6) 交付物格式
      const formats = m.aclAndOutput?.expectedFormats || [];
      setOutputItems({
        web_preview: formats.includes('png_300dpi') || formats.includes('png_150dpi'),
        tsv_tables: formats.includes('tsv_tables'),
        pdf_vector: formats.includes('pdf_vector'),
        checkpoint_archive: formats.includes('rds_checkpoint'),
        audit_ledger: formats.includes('audit_json'),
      });

      // 7) 虚拟敲除目标基因
      setKoGene(m.aclAndOutput?.targetKoGene || '');

      setImportedFrom(file);
      setImportNotes(notesList);
    } catch (cause) {
      setInboxError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [stepsData]);

  // 进页面即读一次收件箱（本地目录，开销可忽略）
  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  return (
    <div className="view-container">
      {/* 模块 0：从客户需求导入 */}
      <div className="module-card">
        <h2 className="module-title">从客户需求导入</h2>
        <p className="module-desc">
          读取 <code>portal/inbox/</code> 中用户提交台导出的需求文件，自动填充下方 A/B/C/D 四个模块。导入后仍可逐项修改。
        </p>

        <div className="inbox-toolbar">
          <button className="btn btn-primary" onClick={() => void loadInbox()} disabled={inboxLoading}>
            {inboxLoading ? '读取中…' : '刷新收件箱'}
          </button>
          {inbox?.dir && <span className="hint">目录：{inbox.dir}</span>}
        </div>

        {inboxError && <p className="error-text">{inboxError}</p>}

        {inbox && !inbox.blocked && inbox.items.length === 0 && (
          <p className="hint">收件箱为空。客户提交需求后，文件会出现在 portal/inbox/。</p>
        )}

        {inbox && inbox.items.length > 0 && (
          <div className="inbox-list">
            {inbox.items.map((item) => {
              const s = item.summary;
              const dtLabel = s?.dataType
                ? (DATA_TYPE_OPTIONS.find((d) => d.id === s.dataType)?.label || s.dataType)
                : '';
              return (
                <div key={item.file} className="inbox-item">
                  <div className="inbox-item-main">
                    <div className="inbox-item-name">{s?.name || item.file}</div>
                    <div className="hint">
                      {s
                        ? `${dtLabel || '⚠ 未填数据类型'} · ${s.domain || '—'} / ${s.disease || '—'} / ${s.species || '—'} · ${s.groupCount} 组 · ${s.stepCount} 步 · ${s.sampleCount} 样本`
                        : `解析失败：${item.parseError}`}
                    </div>
                    {s && (
                      <div className="hint">
                        建议分析线：{s.suggestedLine || '未识别，导入后按步骤反查'}
                      </div>
                    )}
                    {s && (
                      <div className="hint">
                        数据集配对：{s.datasets && s.datasets.length
                          ? s.datasets.map((d) => {
                              const t = DATA_TYPE_OPTIONS.find((x) => x.id === d.dataType)?.label || d.dataType || '类型未填';
                              const n = d.sampleCount ? `${d.sampleCount} 例` : '样本数未填';
                              return `${d.gse}${d.gpl ? '↔' + d.gpl : ''}（${d.role === 'validation' ? '验证' : '训练'} · ${t} · ${n}${d.tissue ? ' · ' + d.tissue : ''}）`;
                            }).join('；')
                          : '未填'}
                        {s.datasetsInferred ? ' ⚠ 旧格式推断，需核对' : ''}
                      </div>
                    )}
                    {s && (
                      <div className="hint">
                        补充材料：参考文献 {s.refCount || 0} 篇 · 备注 {s.notes ? s.notes.length + ' 字' : '未填'}
                      </div>
                    )}
                    {item.attachments && (
                      <div className="hint">
                        提交包：{item.packageDir} · 文献 {item.attachments.references} 篇 · 数据文件 {item.attachments.data_files} 个
                      </div>
                    )}
                    <div className="hint">{item.file} · {new Date(item.mtime).toLocaleString()}</div>
                  </div>
                  <button
                    className="btn"
                    disabled={!!item.parseError}
                    onClick={() => void importFromInbox(item.file)}
                  >导入</button>
                </div>
              );
            })}
          </div>
        )}

        {importedFrom && (
          <div className="import-result">
            <p className="hint">已导入：{importedFrom}</p>
            {importNotes.length > 0 && (
              <ul className="import-notes">
                {importNotes.map((note, i) => <li key={i}>{note}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 模块 A：项目基础信息 */}
      <div className="module-card">
        <h2 className="module-title">模块 A · 项目基础信息</h2>
        <p className="module-desc">项目 ID、名称、描述与研究领域。疾病/名称/描述实时校验非肿瘤黑名单。</p>

        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">项目 ID *</label>
            <input className="form-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}
              placeholder="仅字母数字 . _ -" />
          </div>
          <div className="form-group">
            <label className="form-label">项目名称 *</label>
            <input className="form-input" value={name} onChange={(e) => onNameChange(e.target.value)} />
            {blName?.hit && (
              <div className="blacklist-warning">违规词：{blName.matches.join('、')}（本平台专精非肿瘤领域）</div>
            )}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">项目描述</label>
          <textarea className="form-input" rows={2} value={description} onChange={(e) => onDescChange(e.target.value)} />
          {blDesc?.hit && (
            <div className="blacklist-warning">违规词：{blDesc.matches.join('、')}</div>
          )}
        </div>

        {/* 客户备注 / 分析需求补充（来自用户端，自由文本，同样参与非肿瘤黑名单校验） */}
        <div className="form-group">
          <label className="form-label">备注 / 分析需求补充</label>
          <textarea className="form-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="客户写明的更详细研究目的、期望分析手段等" />
        </div>
        {references.length > 0 && (
          <div className="hint">
            参考文献（{references.length} 篇，客户在用户端上传）：{references.map((r) => r.name).join('；')}
          </div>
        )}

        <div className="form-grid-3">
          <div className="form-group">
            <label className="form-label">物种</label>
            <select className="form-select" value={species} onChange={(e) => setSpecies(e.target.value)}>
              {SPECIES_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">非肿瘤研究领域</label>
            <select className="form-select" value={domain} onChange={(e) => setDomain(e.target.value)}>
              {DOMAIN_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">疾病名称</label>
            <input className="form-input" value={disease} onChange={(e) => onDiseaseChange(e.target.value)}
              placeholder="如 Ischemic Stroke" />
            {blDisease?.hit && (
              <div className="blacklist-warning">违规词：{blDisease.matches.join('、')}</div>
            )}
          </div>
        </div>
      </div>

      {/* 模块 B：数据来源与动态分组设计 */}
      <div className="module-card">
        <h2 className="module-title">模块 B · 数据来源与分组设计</h2>
        <p className="module-desc">数据类型（决定分析线，必选）+ GEO / ArrayExpress / 自有数据，训练集与验证集 GSE、GPL 平台、样本量、组织来源，以及动态多分组 + 组内样本绑定 + 对比对。</p>

        <div className="form-row">
          <div className="form-col">
            <div className="form-group">
              <label className="form-label">数据类型 *</label>
              <select className="form-select" value={dataType}
                onChange={(e) => {
                  const next = e.target.value;
                  setDataType(next);
                  // 选类型即选线：三线互不交叉，由类型唯一决定，避免跑错线
                  onSelectLine(lineFromDataType(next));
                }}>
                <option value="">请选择…</option>
                {DATA_TYPE_OPTIONS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
              <div className="hint">芯片 / Bulk → 线 1，单细胞 → 线 2，空转 → 线 3</div>
            </div>
          </div>
          <div className="form-col">
            <div className="form-group">
              <label className="form-label">数据来源</label>
              <select className="form-select" value={dataSource} onChange={(e) => setDataSource(e.target.value)}>
                {DATA_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* S24/R2：数据来源双模态单选（照 portal 同名实现的语义）。
            IN_HOUSE 模式下没有 GSE/GSM 概念，LOC 编号由服务端按项目 ID 派生 */}
        <div className="form-group">
          <label className="form-label">数据来源模式 *</label>
          <div className="chip-row">
            {([
              { value: 'PUBLIC_DB', label: '公共数据库（GEO / ArrayExpress，按编号获取）' },
              { value: 'IN_HOUSE_UPLOAD', label: '自有数据上传（自测矩阵，无需 GSE 编号）' },
            ] as const).map((opt) => (
              <button key={opt.value} type="button"
                className={`chip${dataSourceMode === opt.value ? ' chip-active' : ''}`}
                onClick={() => setDataSourceMode(opt.value)}>
                {opt.label}
              </button>
            ))}
          </div>
          <div className="hint">
            {dataSourceMode === 'PUBLIC_DB'
              ? '按下方「数据集 ↔ 平台配对」填写的 GSE / GPL 编号获取数据，样本编号须为 GSM 开头。'
              : '自有数据不需要 GSE 编号：训练/验证数据集编号（LOC_…_TRAIN / _VAL）由服务端按项目 ID 自动派生；样本编号允许字母数字下划线连字符与点。'}
          </div>
        </div>

        {/* S24/R2：自有数据三件套（id_type / value_scale / train_matrix 必填，dualmode 契约） */}
        {dataSourceMode === 'IN_HOUSE_UPLOAD' && (
          <div className="form-group">
            <div className="pairing-head">
              <span className="form-label">自有数据三件套 *</span>
            </div>
            <div className="hint" style={{ marginBottom: 8 }}>
              训练集矩阵路径必填；验证集矩阵选填（填了才派生 LOC_…_VAL 编号）。路径为上传到服务器本项目 raw_data/ 下的相对路径。
            </div>
            <div className="pairing-row pairing-row-sub">
              <select className="form-select" value={idType} aria-label="基因标识符类型 id_type"
                onChange={(e) => setIdType(e.target.value)}>
                {ID_TYPE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <select className="form-select" value={valueScale} aria-label="表达量数值类型 value_scale"
                onChange={(e) => setValueScale(e.target.value)}>
                {VALUE_SCALE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div className="pairing-row pairing-row-sub">
              <input className="form-input" value={trainMatrixPath} aria-label="训练矩阵路径 train_matrix"
                placeholder="raw_data/counts_train.tsv（必填）"
                onChange={(e) => setTrainMatrixPath(e.target.value)} />
              <input className="form-input" value={valMatrixPath} aria-label="验证矩阵路径 val_matrix"
                placeholder="raw_data/counts_val.tsv（选填）"
                onChange={(e) => setValMatrixPath(e.target.value)} />
            </div>
          </div>
        )}

        {/* 数据集 ↔ 平台配对表：多组数据必须逐行写明哪个 GPL 属于哪个 GSE（仅公共库模式；自有数据无 GSE 概念） */}
        {dataSourceMode === 'PUBLIC_DB' && (
        <div className="form-group">
          <div className="pairing-head">
            <span className="form-label">数据集 ↔ 平台配对</span>
            <button type="button" className="btn" onClick={addDatasetRow}>＋ 新增数据集配对</button>
          </div>
          <div className="hint" style={{ marginBottom: 8 }}>
            每行一组「GSE ↔ GPL」并标明用途。多组数据、或同一 GSE 涉及多个平台时请分多行写清楚，配对错了预处理会跑偏。
          </div>
          {datasetRows.map((row, index) => (
            <div className="pairing-block" key={index}>
              <div className="pairing-row">
                <input className="form-input" value={row.gse} aria-label={`第 ${index + 1} 行数据集编号 GSE`}
                  placeholder="GSE16561" onChange={(e) => updateDatasetRow(index, { gse: e.target.value })} />
                <input className="form-input" value={row.gpl} aria-label={`第 ${index + 1} 行平台编号 GPL`}
                  placeholder="GPL6883（测序数据可留空）" onChange={(e) => updateDatasetRow(index, { gpl: e.target.value })} />
                <select className="form-select" value={row.role} aria-label={`第 ${index + 1} 行用途`}
                  onChange={(e) => updateDatasetRow(index, { role: e.target.value === 'validation' ? 'validation' : 'train' })}>
                  <option value="train">训练集（建模 / 特征筛选）</option>
                  <option value="validation">验证集（独立验证）</option>
                </select>
                <button type="button" className="btn btn-danger" disabled={datasetRows.length <= 1}
                  onClick={() => removeDatasetRow(index)}>删除</button>
              </div>
              {/* 行级三元组：留空沿用项目级（页面上方那组），多数据集有差异时才逐行改 */}
              <div className="pairing-row pairing-row-sub">
                <select className="form-select" value={row.dataType || ''} aria-label={`第 ${index + 1} 行数据类型`}
                  onChange={(e) => updateDatasetRow(index, { dataType: e.target.value })}>
                  <option value="">数据类型：同项目级{dataType ? `（${DATA_TYPE_OPTIONS.find((d) => d.id === dataType)?.label || dataType}）` : ''}</option>
                  {DATA_TYPE_OPTIONS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
                <input className="form-input" value={row.sampleCount ?? ''} inputMode="numeric"
                  aria-label={`第 ${index + 1} 行样本数量`}
                  placeholder={sampleCount ? `样本数：同项目级（${sampleCount}）` : '样本数：同项目级'}
                  onChange={(e) => updateDatasetRow(index, { sampleCount: e.target.value })} />
                <input className="form-input" value={row.tissue || ''}
                  aria-label={`第 ${index + 1} 行组织来源`}
                  placeholder={tissue ? `组织来源：同项目级（${tissue}）` : '组织来源：同项目级'}
                  onChange={(e) => updateDatasetRow(index, { tissue: e.target.value })} />
              </div>
            </div>
          ))}
        </div>
        )}

        <div className="form-row">
          <div className="form-col">
            <div className="form-group">
              <label className="form-label">样本数量</label>
              <input className="form-input" value={sampleCount} onChange={(e) => setSampleCount(e.target.value)}
                inputMode="numeric" placeholder="60" />
            </div>
          </div>
          <div className="form-col">
            <div className="form-group">
              <label className="form-label">组织来源</label>
              <input className="form-input" value={tissue} onChange={(e) => setTissue(e.target.value)}
                placeholder="Peripheral Blood" />
            </div>
          </div>
        </div>

        {/* 分组模式选择器 */}
        <div className="form-group">
          <label className="form-label">分组模式</label>
          <div className="chip-row">
            {([
              { value: 'two_group', label: '二分类对比 (2 Groups)' },
              { value: 'multi_group', label: '多组无序对比 (Multi-group)' },
              { value: 'ordered_stage', label: '有序病情阶段演进 (Ordered Stage)' },
            ] as const).map((opt) => (
              <button key={opt.value} type="button"
                className={`chip${groupMode === opt.value ? ' chip-active' : ''}`}
                onClick={() => setGroupMode(opt.value)}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 一键导入分组表 */}
        <div className="form-group">
          <button type="button" className="btn" onClick={() => setBulkPasteOpen(!bulkPasteOpen)}>
            {bulkPasteOpen ? '取消粘贴' : '一键粘贴 2 列分组表'}
          </button>
        </div>
        {bulkPasteOpen && (
          <div className="bulk-paste-area">
            <textarea className="form-input" rows={5} value={bulkPasteText}
              onChange={(e) => setBulkPasteText(e.target.value)}
              placeholder="Sample_ID,Group_Name&#10;GSM416528,Control&#10;GSM416529,Control&#10;GSM416530,Disease&#10;（逗号或 tab 分隔）"
              style={{ fontFamily: 'monospace' }} />
            <button type="button" className="btn btn-primary" onClick={applyBulkPaste} style={{ marginTop: 8 }}>
              解析并填充分组
            </button>
          </div>
        )}

        {/* 动态分组卡片列表 */}
        <div className="group-card-list">
          {groups.map((group, index) => {
            const sampleCount = parseSampleIds(group.sampleIdsText).length;
            const hasDup = isGroupDuplicate(group);
            return (
              <div key={group.groupId} className={`group-card${hasDup ? ' group-card-duplicate' : ''}`}>
                <div className="group-card-head">
                  <span className="group-card-index">分组 {index + 1}</span>
                  <div className="group-card-actions">
                    {groupMode === 'ordered_stage' && (
                      <>
                        <button type="button" className="btn" disabled={index === 0}
                          onClick={() => moveGroupUp(index)}>↑</button>
                        <button type="button" className="btn" disabled={index === groups.length - 1}
                          onClick={() => moveGroupDown(index)}>↓</button>
                      </>
                    )}
                    {groups.length > 2 && (
                      <button type="button" className="btn btn-danger"
                        onClick={() => removeGroup(group.groupId)}>删除</button>
                    )}
                  </div>
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">分组名称</label>
                    <input className="form-input" value={group.groupName}
                      onChange={(e) => updateGroup(group.groupId, { groupName: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">角色</label>
                    <select className="form-select" value={group.role}
                      onChange={(e) => setGroupRole(group.groupId, e.target.value as GroupRole)}>
                      <option value="reference">reference（基准对照）</option>
                      <option value="disease_stage">disease_stage</option>
                    </select>
                  </div>
                </div>
                <div className="form-grid-2">
                  {groupMode === 'ordered_stage' && (
                    <div className="form-group">
                      <label className="form-label">阶段序号 (stage_order)</label>
                      <input className="form-input" type="number" value={group.stageOrder}
                        onChange={(e) => updateGroup(group.groupId, { stageOrder: Number(e.target.value) })} />
                    </div>
                  )}
                  <div className="form-group">
                    <label className="form-label">颜色标识</label>
                    <div className="color-pick-row">
                      <input type="color" className="color-picker" value={group.colorHex}
                        onChange={(e) => updateGroup(group.groupId, { colorHex: e.target.value })} />
                      <span className="color-hex-label">{group.colorHex}</span>
                      <span className="color-swatch" style={{ background: group.colorHex }} />
                    </div>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">样本编号</label>
                  <textarea className="form-input" rows={3} value={group.sampleIdsText}
                    onChange={(e) => updateGroup(group.groupId, { sampleIdsText: e.target.value })}
                    placeholder="请输入或粘贴归属本组的样本编号（如 GSM416528, GSM416529），支持逗号、空格或换行分隔"
                    style={{ fontFamily: 'monospace' }} />
                  <span className="subtle">已录入: {sampleCount} 个样本</span>
                  {hasDup && (
                    <span className="duplicate-warning">⚠ 同一样本 ID 出现在多个分组</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {groups.length < 2 && (
          <p className="error-text">至少需要 2 个分组。</p>
        )}
        <button type="button" className="btn btn-primary" onClick={addGroup} style={{ marginTop: 8 }}>
          + 新增分组
        </button>

        {/* 显式对比对（Contrasts）生成器 */}
        {groups.length >= 3 && contrasts.length > 0 && (
          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label">显式对比对 (Contrasts)</label>
            <p className="subtle">自动生成所有两两对比组合，勾选启用，单选标记主对比对。</p>
            <div className="contrast-list">
              {contrasts.map((c) => (
                <div key={c.name} className={`contrast-item${c.enabled ? ' contrast-enabled' : ''}`}>
                  <label className="contrast-check">
                    <input type="checkbox" checked={c.enabled} onChange={() => toggleContrast(c.name)} />
                    <span className="contrast-name">{c.name}</span>
                  </label>
                  <label className="contrast-primary">
                    <input type="radio" name="primary-contrast"
                      checked={c.name === primaryContrast}
                      onChange={() => setPrimaryContrastItem(c.name)} />
                    主对比
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 模块 C：分析线与步骤 */}
      <div className="module-card">
        <h2 className="module-title">模块 C · 分析线与步骤</h2>
        <p className="module-desc">先选一条分析线（物理锁死，单选），再勾选该线步骤。每个步骤展示功能名称、简介、核心工具与输入/输出。前置 QC 模块固定勾选不可取消。</p>

        <div className="form-group">
          <label className="form-label">分析线（单选物理锁死）</label>
          <div className="chip-row">
            {LINES.map((line) => (
              <button key={line} type="button"
                className={`chip${selectedLine === line ? ' chip-active' : ''}`}
                onClick={() => onSelectLine(line)}>
                {LINE_LABELS[line as keyof typeof LINE_LABELS]}
              </button>
            ))}
          </div>
        </div>

        {selectedLine && lineSteps.length > 0 && (
          <>
            <label className="form-label">步骤勾选（QC 步骤固定不可取消）</label>
            <div className="step-meta-list">
              {lineSteps.map((step) => {
                const isChecked = selectedSteps.includes(step);
                const isQC = step.toLowerCase().includes('qc');
                const meta = stepsMeta[step];
                const isKnockout = step.toLowerCase().includes('knockout');
                return (
                  <div key={step} className={`step-meta-card${isChecked ? ' step-meta-card-active' : ''}`}>
                    <div className="step-meta-head">
                      <label className="step-meta-check">
                        <input type="checkbox" checked={isChecked}
                          disabled={isQC}
                          onChange={() => onToggleStep(step)} />
                        {isQC && <span className="step-meta-locked" title="QC 步骤固定勾选">🔒</span>}
                      </label>
                      <span className="step-meta-label">{meta?.label || step}</span>
                    </div>
                    {meta && (
                      <div className="step-meta-body">
                        <p className="step-meta-desc">{meta.desc}</p>
                        <p className="step-meta-tool">{meta.tool}</p>
                        <p className="step-meta-io">{meta.io}</p>
                        {meta.note && (
                          <span className="step-meta-note">{meta.note}</span>
                        )}
                      </div>
                    )}
                    {isKnockout && isChecked && (
                      <div className="form-group" style={{ marginTop: 8 }}>
                        <label className="form-label">目标敲除基因 *</label>
                        <input className="form-input" value={koGene} onChange={(e) => setKoGene(e.target.value)}
                          placeholder="如 APP, MAPT" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {selectedSteps.length > 0 && (
              <p className="subtle" style={{ marginTop: 8 }}>已选 {selectedSteps.length} 个步骤</p>
            )}
          </>
        )}
      </div>

      {/* 模块 D：权限、算力策略与交付物配置 */}
      <div className="module-card">
        <h2 className="module-title">模块 D：项目权限、算力保护策略与预期交付物配置</h2>
        <p className="module-desc">本模块用于定义项目归属权、确认服务器端防崩运行级别，并锁定最终交付清单。</p>

        {/* 子项 1：项目成员与权限 */}
        <div className="form-group">
          <label className="form-label">子项 1 · 项目成员与权限 (ACL)</label>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Owner（默认当前用户）</label>
              <input className="form-input" value={owner} onChange={(e) => setOwner(e.target.value)}
                placeholder="current_user" />
            </div>
            <div className="form-group">
              <label className="form-label">Collaborators（选填，逗号分隔）</label>
              <input className="form-input" value={collaborators} onChange={(e) => setCollaborators(e.target.value)}
                placeholder="researcher_01, reviewer_02" />
            </div>
          </div>
        </div>

        {/* 子项 2：算力削峰与断点恢复 */}
        <div className="form-group">
          <label className="form-label">子项 2 · 算力削峰与断点恢复</label>
          <div className="compute-shield-card">
            <div className="compute-shield-icon">🛡</div>
            <ul className="compute-shield-list">
              <li>K40 降权执行：nice/ionice（默认不绑核，EAS 动态调度实测更快）+ 3 线程封顶</li>
              <li>7.5GB 内存软熔断与检查点续跑</li>
              <li>每步 exit 0 后自动落盘检查点与 JSON 台账</li>
            </ul>
          </div>
        </div>

        {/* 子项 3：预期输出结果 */}
        <div className="form-group">
          <label className="form-label">子项 3 · 预期输出结果</label>
          <div className="output-check-list">
            <div className={`output-check-card${outputItems.web_preview ? ' output-check-active' : ''}`}>
              <label className="output-check-label">
                <input type="checkbox" checked={outputItems.web_preview}
                  onChange={() => toggleOutputItem('web_preview')} />
                <span className="output-check-name">Web 预览图集 (300 DPI PNG)</span>
                <span className="output-check-tag">必选默认</span>
              </label>
              <p className="output-check-desc">无头渲染、紧凑裁剪、英文标签，单图 &lt;500KB</p>
            </div>
            <div className={`output-check-card${outputItems.tsv_tables ? ' output-check-active' : ''}`}>
              <label className="output-check-label">
                <input type="checkbox" checked={outputItems.tsv_tables}
                  onChange={() => toggleOutputItem('tsv_tables')} />
                <span className="output-check-name">全量统计结果表 (.tsv)</span>
                <span className="output-check-tag">必选默认</span>
              </label>
              <p className="output-check-desc">完整基因列表、p 值、SHAP 值、DR 基因排名</p>
            </div>
            <div className={`output-check-card${outputItems.pdf_vector ? ' output-check-active' : ''}`}>
              <label className="output-check-label">
                <input type="checkbox" checked={outputItems.pdf_vector}
                  onChange={() => toggleOutputItem('pdf_vector')} />
                <span className="output-check-name">发表级矢量图副本 (.pdf/.svg)</span>
                <span className="output-check-tag-optional">可选</span>
              </label>
              <p className="output-check-desc">供论文排版使用</p>
            </div>
            <div className={`output-check-card${outputItems.checkpoint_archive ? ' output-check-active' : ''}`}>
              <label className="output-check-label">
                <input type="checkbox" checked={outputItems.checkpoint_archive}
                  onChange={() => toggleOutputItem('checkpoint_archive')} />
                <span className="output-check-name">中间态检查点归档 (.rds/.h5ad)</span>
                <span className="output-check-tag">默认勾选</span>
              </label>
              <p className="output-check-desc">清洗后对象与冻结模型</p>
            </div>
            <div className={`output-check-card${outputItems.audit_ledger ? ' output-check-active' : ''}`}>
              <label className="output-check-label">
                <input type="checkbox" checked={outputItems.audit_ledger}
                  onChange={() => toggleOutputItem('audit_ledger')} />
                <span className="output-check-name">结构化审计台账 (system_logs/*.json)</span>
                <span className="output-check-tag">必选默认</span>
              </label>
              <p className="output-check-desc">区分 DEG vs DR Genes 的三段式报告</p>
            </div>
          </div>
        </div>
      </div>

      {/* 模块 E：v3 intake 分析契约（R2：排版 / 统计阈值 / 生物学先验 / 实验设计 / 验证集映射 / WGCNA 参数） */}
      <div className="module-card">
        <h2 className="module-title">模块 E · 分析契约（v3 intake）</h2>
        <p className="module-desc">
          决定下游脚本跑什么阈值、按什么统计模型、出图套哪个模板。字段形状与服务端归一化契约逐字段一致；留空项取服务端安全默认。
        </p>

        {/* 出图画幅（plotLayoutConfig.templateId，两档） */}
        <div className="form-group">
          <label className="form-label">出图画幅</label>
          <select className="form-select" value={layoutTemplate}
            onChange={(e) => setLayoutTemplate(e.target.value)}>
            {LAYOUT_TEMPLATE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <div className="hint">全部图件按同一画幅出图，DPI 固定 300。</div>
        </div>

        {/* 统计阈值三档（analysisCutoffs.profile + 可选显式覆盖） */}
        <div className="form-group">
          <label className="form-label">统计阈值档位</label>
          <div className="chip-row">
            {CUTOFF_PROFILE_OPTIONS.map((opt) => (
              <button key={opt.id} type="button"
                className={`chip${cutoffProfile === opt.id ? ' chip-active' : ''}`}
                onClick={() => setCutoffProfile(opt.id)}>
                {opt.label}
              </button>
            ))}
          </div>
          <div className="form-grid-2" style={{ marginTop: 8 }}>
            {([
              { key: 'log2fc_threshold', label: 'log2FC 阈值（覆盖档位预设）' },
              { key: 'padj_threshold', label: 'padj 阈值（覆盖档位预设）' },
              { key: 'p_threshold', label: 'p 阈值（覆盖档位预设）' },
              { key: 'max_mt_percent', label: '线粒体百分比上限（默认 15）' },
            ] as const).map((f) => (
              <div className="form-group" key={f.key}>
                <label className="form-label">{f.label}</label>
                <input className="form-input" inputMode="decimal"
                  value={cutoffOverrides[f.key]}
                  placeholder="留空用档位预设"
                  onChange={(e) => setCutoffOverrides((prev) => ({ ...prev, [f.key]: e.target.value }))} />
              </div>
            ))}
          </div>
        </div>

        {/* 生物学先验（biologicalPriors：focusGenes / koFallbackPolicy；targetKoGene 复用模块 C 的敲除基因框） */}
        <div className="form-group">
          <label className="form-label">重点关注基因（focus_genes，最多 5 个）</label>
          <input className="form-input" value={focusGenesText}
            placeholder="如 IL17A, S100A8, S100A9（逗号 / 空格分隔）"
            onChange={(e) => setFocusGenesText(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">敲除靶基因检出不足时的兜底策略（ko_fallback_policy）</label>
          <select className="form-select" value={koFallbackPolicy}
            onChange={(e) => setKoFallbackPolicy(e.target.value)}>
            {KO_FALLBACK_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {hasKnockout && (
            <div className="hint">已勾选虚拟敲除：靶基因在模块 C 的「目标敲除基因」框填写（即 target_ko_gene）。</div>
          )}
        </div>

        {/* 实验设计（experimentalDesign：配对 + 协变量） */}
        <div className="form-group">
          <label className="form-label">
            <input type="checkbox" checked={isPaired} onChange={(e) => setIsPaired(e.target.checked)} />
            {' '}配对 / 同供体设计（is_paired，驱动下游自动切配对统计模型）
          </label>
          {isPaired && (
            <textarea className="form-input" rows={3} value={pairMapText} style={{ marginTop: 8, fontFamily: 'monospace' }}
              placeholder={'样本=供体/配对，每行一条，如：\nGSM1=Donor_01\nGSM2=Donor_01'}
              onChange={(e) => setPairMapText(e.target.value)} />
          )}
        </div>
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">批次列名（batch_col，选填）</label>
            <input className="form-input" value={batchCol}
              placeholder="如 GSE_batch"
              onChange={(e) => setBatchCol(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">校正协变量（adjusted_variables，选填）</label>
            <input className="form-input" value={adjustedVarsText}
              placeholder="如 age, sex"
              onChange={(e) => setAdjustedVarsText(e.target.value)} />
          </div>
        </div>

        {/* 独立验证集分组映射（validationGroupMapping） */}
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">验证集对照组样本（val_control_samples）</label>
            <textarea className="form-input" rows={3} value={valControlText} style={{ fontFamily: 'monospace' }}
              placeholder="每行一个样本编号，如 GSM1"
              onChange={(e) => setValControlText(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">验证集处理组样本（val_treat_samples）</label>
            <textarea className="form-input" rows={3} value={valTreatText} style={{ fontFamily: 'monospace' }}
              placeholder="每行一个样本编号，如 GSM3"
              onChange={(e) => setValTreatText(e.target.value)} />
          </div>
        </div>
        <div className="hint">同一批样本不能同时出现在两侧，否则服务端直接拒绝建项（冻结评估会失真）。</div>

        {/* WGCNA 参数（wgcna_config，全部选填，留空取服务端契约默认） */}
        <div className="form-group">
          <label className="form-label">WGCNA 参数（选填，留空用 K40 安全默认）</label>
          <div className="form-grid-2">
            {WGCNA_PARAM_FIELDS.map((f) => (
              <div className="form-group" key={f.key}>
                <label className="form-label">{f.label}</label>
                <input className="form-input" inputMode="decimal" value={wgcnaParams[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setWgcnaParams((prev) => ({ ...prev, [f.key]: e.target.value }))} />
              </div>
            ))}
            <div className="form-group">
              <label className="form-label">软阈值选择规则（power_rule）</label>
              <select className="form-select" value={wgcnaParams.power_rule}
                onChange={(e) => setWgcnaParams((prev) => ({ ...prev, power_rule: e.target.value }))}>
                <option value="">默认：first_r2_ge_0.8_else_max</option>
                <option value="first_r2_ge_0.8_else_max">first_r2_ge_0.8_else_max</option>
                <option value="max_r2">max_r2</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 提交 */}
      <div className="card">
        <div className="card-head">
          <h2 className="card-title">提交建项</h2>
          <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? '创建中...' : '提交创建项目'}
          </button>
        </div>
        {blacklistHit && <p className="error-text">存在黑名单命中，提交已禁用。请修改违规字段。</p>}
        {submitError && <p className="error-text">{submitError}</p>}
        {submitOk && <p style={{ color: '#0f7b3f', fontSize: 14 }}>{submitOk}</p>}
        {!submitOk && !submitError && !blacklistHit && (
          <p className="hint">填写完成后点击提交，调用 POST /api/projects/create 建项。</p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 视图2：客户分析输入控制台（Customer Input Console）
// ============================================================

function CustomerInputConsole({ project }: { project: string }) {
  const [subTab, setSubTab] = useState<'task' | 'upload' | 'files' | 'ledger'>('task');

  return (
    <div className="view-container">
      <div className="sub-tab-row">
        <button className={`sub-tab${subTab === 'task' ? ' sub-tab-active' : ''}`} onClick={() => setSubTab('task')}>任务下发</button>
        <button className={`sub-tab${subTab === 'upload' ? ' sub-tab-active' : ''}`} onClick={() => setSubTab('upload')}>数据导入</button>
        <button className={`sub-tab${subTab === 'files' ? ' sub-tab-active' : ''}`} onClick={() => setSubTab('files')}>文件浏览</button>
        <button className={`sub-tab${subTab === 'ledger' ? ' sub-tab-active' : ''}`} onClick={() => setSubTab('ledger')}>台账巡检</button>
      </div>
      {subTab === 'task' && <TaskPanel project={project} />}
      {subTab === 'upload' && <UploadPanel project={project} />}
      {subTab === 'files' && <FilesPanel project={project} />}
      {subTab === 'ledger' && <LedgerPanel />}
    </div>
  );
}

// ============================================================
// 视图3：服务端五维自检面板（Pre-flight Dashboard）
// ============================================================

function PreFlightDashboard() {
  const [result, setResult] = useState<SelfCheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/selfcheck');
      const payload = (await res.json()) as SelfCheckResponse;
      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  // 四档：pass/fail/warn/unknown。warn 是"能跑但该降载"（温度进降频区、内存贴 90%、负载超核数），
  // 不能和 unknown（读不到）混成一个灰灯，否则用户分不清"没事"和"没测到"。
  const dotClass = (status: string) =>
    status === 'pass'
      ? 'selfcheck-dot-pass'
      : status === 'fail'
        ? 'selfcheck-dot-fail'
        : status === 'warn'
          ? 'selfcheck-dot-warn'
          : 'selfcheck-dot-unknown';
  const dotText = (status: string) =>
    status === 'pass' ? 'OK' : status === 'fail' ? 'FAIL' : status === 'warn' ? '!' : '?';
  const hasFail = (result?.checks ?? []).some((c) => c.status === 'fail');
  const hasWarn = (result?.checks ?? []).some((c) => c.status === 'warn');

  return (
    <div className="view-container">
      <div className="card">
        <div className="card-head">
          <h2 className="card-title">服务端五维自检面板</h2>
          <button className="btn" onClick={() => void run()} disabled={loading}>
            {loading ? '检测中...' : '重新检测'}
          </button>
        </div>

        {error && <p className="error-text">检测失败：{error}</p>}

        {result && (
          <div className="selfcheck-summary">
            {result.all_pass ? (
              <span className="badge badge-pass">全部通过</span>
            ) : hasFail ? (
              <span className="badge badge-fail">存在未通过项</span>
            ) : hasWarn ? (
              <span className="badge badge-warn">存在告警项</span>
            ) : (
              <span className="badge badge-fail">存在未通过项</span>
            )}
          </div>
        )}

        {result && (
          <div className="selfcheck-grid">
            {result.checks.map((item) => (
              <div key={item.id} className="selfcheck-light">
                <div className={`selfcheck-dot ${dotClass(item.status)}`}>{dotText(item.status)}</div>
                <div className="selfcheck-label">{item.label}</div>
                <div className="selfcheck-value">{item.value || '—'}</div>
                <div className="selfcheck-detail">{item.detail}</div>
              </div>
            ))}
          </div>
        )}

        {!result && !error && !loading && (
          <p className="hint">点击"重新检测"调用 GET /api/selfcheck。</p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 视图4：结果预览 Studio（Result Preview Studio）
// ============================================================

function ResultPreviewStudio({ project }: { project: string }) {
  const [figuresByLine, setFiguresByLine] = useState<Record<string, FigureEntry[]>>({});
  const [figuresSource, setFiguresSource] = useState<Record<string, 'local' | 'remote'>>({});
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullNote, setPullNote] = useState('');
  const [zoom, setZoom] = useState<{ name: string; line: string } | null>(null);
  const [selectedFig, setSelectedFig] = useState<{ name: string; line: string } | null>(null);
  // 项目出图配置：让对接人一眼看到"这批图按哪个模板/阈值出的"
  const [projectMeta, setProjectMeta] = useState<ProjectMetaBrief | null>(null);

  const loadProjectMeta = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/meta?project=${encodeURIComponent(project)}`);
      const payload = (await res.json()) as ProjectMetaBrief & { error?: string };
      setProjectMeta(payload && !payload.error ? payload : null);
    } catch {
      setProjectMeta(null);
    }
  }, [project]);

  useEffect(() => {
    void loadProjectMeta();
  }, [loadProjectMeta]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const result: Record<string, FigureEntry[]> = {};
    const source: Record<string, 'local' | 'remote'> = {};
    for (const line of LINES) {
      try {
        const res = await fetch(
          `/api/figures/list?project=${encodeURIComponent(project)}&line=${encodeURIComponent(line)}`
        );
        const payload = (await res.json()) as FiguresResponse;
        if (!('blocked' in payload) && !('error' in payload)) continue;
        if ('blocked' in payload && !payload.blocked) {
          result[line] = payload.figures;
          if (payload.source) source[line] = payload.source;
        }
      } catch {
        // 跳过单线失败
      }
    }
    setFiguresByLine(result);
    setFiguresSource(source);
    setLoading(false);
  }, [project]);

  /** 把远端图件回搬到本地 outputs/，之后视图 4 直接读本地副本 */
  const pullFigures = useCallback(async () => {
    setPulling(true);
    setPullNote('');
    try {
      const res = await fetch('/api/figures/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project }),
      });
      const payload = (await res.json()) as {
        ok?: boolean; error?: string; localRoot?: string;
        results?: Array<{ lineId: string; pulled: number; skipped: number; failed: number }>;
      };
      if (payload.error) {
        setPullNote(`回搬失败：${payload.error}`);
      } else {
        const summary = (payload.results || [])
          .map((item) => `${item.lineId} 拉取 ${item.pulled} / 跳过 ${item.skipped} / 失败 ${item.failed}`)
          .join('；');
        setPullNote(`回搬完成（${payload.localRoot}）：${summary}`);
      }
    } catch (cause) {
      setPullNote(`回搬失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setPulling(false);
      await loadAll();
    }
  }, [project, loadAll]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const imgUrl = (name: string, line: string) =>
    `/api/figures/image?project=${encodeURIComponent(project)}&line=${encodeURIComponent(line)}&name=${encodeURIComponent(name)}`;

  // 判断图件类型标签：DEG vs DR Genes
  const getGeneTypeTag = (name: string): { label: string; cls: string } => {
    const lower = name.toLowerCase();
    // DR 相关特征（优先匹配，DR 非 DEG）
    if (lower.includes('dr_') || lower.includes('_dr') || lower.includes('dr_gsea') ||
        lower.includes('dr_overlap') || lower.includes('dr_network') || lower.includes('dr_by_domain') ||
        lower.includes('ko_dr') || lower.includes('knockout_dr') || lower.includes('summarize_dr')) {
      return { label: 'DR Genes', cls: 'gene-type-tag-dr' };
    }
    // DEG 相关特征
    if (lower.includes('deg') || lower.includes('volcano') || lower.includes('differential')) {
      return { label: 'DEG', cls: 'gene-type-tag-deg' };
    }
    // 其他默认不标
    return { label: '', cls: '' };
  };

  // 解读卡片内容
  const getInterpretation = (fig: FigureEntry) => {
    const tag = getGeneTypeTag(fig.name);
    const sections: Array<{ title: string; body: string }> = [];

    if (tag.label === 'DEG') {
      sections.push({
        title: '统计口径',
        body: '差异表达基因（DEG）：基于 FDR 校正后的 p 值阈值，对比实验组 vs 对照组。火山图中红=上调、蓝=下调、灰=非显著。',
      });
      sections.push({
        title: '解读重点',
        body: fig.caption || '查看显著基因数量、上下调比例，结合后续富集分析评估生物学意义。',
      });
    } else if (tag.label === 'DR Genes') {
      sections.push({
        title: '统计口径',
        body: '疾病调控基因（DR）：由 SCENIC/虚拟敲除等调控网络分析得出，区别于 DEG。DR 基因反映调控关系而非纯表达差异。',
      });
      sections.push({
        title: '解读重点',
        body: fig.caption || 'DR 基因与 DEG 的交集规模反映调控层与表达层的一致性。交集越大，下游机制假说越可靠。',
      });
    } else {
      sections.push({
        title: '图件说明',
        body: fig.caption || '该图件暂无自动说明。',
      });
    }

    return { tag, sections };
  };

  // 当前选中的图件信息
  const selectedFigEntry = selectedFig
    ? figuresByLine[selectedFig.line]?.find((f) => f.name === selectedFig.name)
    : null;
  const interpretation = selectedFigEntry ? getInterpretation(selectedFigEntry) : null;

  return (
    <div className="view-container" style={{ padding: 16 }}>
      <div className="card" style={{ marginBottom: 12, paddingBottom: 12 }}>
        <div className="card-head">
          <h2 className="card-title">结果预览 Studio</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => void pullFigures()} disabled={pulling}>
              {pulling ? '回搬中...' : '回搬图件到本地'}
            </button>
            <button className="btn" onClick={() => void loadAll()} disabled={loading}>
              {loading ? '加载中...' : '刷新全部'}
            </button>
          </div>
        </div>
        <p className="subtle">左侧步骤树 · 中间图廊+TSV预览 · 右侧三段式解读卡片</p>
        {pullNote && <p className="subtle">{pullNote}</p>}
        {Object.entries(figuresSource).some(([, src]) => src === 'remote') && (
          <p className="hint">
            当前有分析线在读远端实时图件（本地尚无回搬副本）。点「回搬图件到本地」把图存到
            outputs/&lt;项目&gt;/&lt;线&gt;/figures/，之后离线也能看。
          </p>
        )}
        {projectMeta && (
          <div className="studio-meta-strip">
            <span className="studio-meta-item">
              出图模板：{LAYOUT_TEMPLATE_LABEL[projectMeta.plotLayoutConfig?.template_id || ''] || '未指定（按默认 Nature 侧边型）'}
            </span>
            <span className="studio-meta-item">
              DPI：{projectMeta.plotLayoutConfig?.dpi || 300}
            </span>
            <span className="studio-meta-item">
              阈值档：{projectMeta.analysisCutoffs?.profile || '未记录'}
            </span>
            {projectMeta.focusGenes.length > 0 && (
              <span className="studio-meta-item">
                关注基因：{projectMeta.focusGenes.join('、')}
              </span>
            )}
            {projectMeta.targetKoGene && (
              <span className="studio-meta-item">敲除靶基因：{projectMeta.targetKoGene}</span>
            )}
          </div>
        )}
      </div>

      <DeliveryReportCard project={project} />

      <div className="studio-layout">
        {/* 左侧步骤树 */}
        <div className="studio-left">
          {LINES.map((line) => {
            const figs = figuresByLine[line] || [];
            if (figs.length === 0) return null;
            return (
              <div key={line} className="studio-tree-group">
                <div className="studio-tree-group-title">
                  {LINE_LABELS[line as keyof typeof LINE_LABELS]}（{figs.length}）
                </div>
                {figs.map((fig) => (
                  <div
                    key={fig.name}
                    className={`studio-tree-item${selectedFig?.name === fig.name && selectedFig?.line === line ? ' studio-tree-item-active' : ''}`}
                    onClick={() => setSelectedFig({ name: fig.name, line })}
                  >
                    {fig.name}
                  </div>
                ))}
              </div>
            );
          })}
          {Object.values(figuresByLine).every((arr) => arr.length === 0) && !loading && (
            <p className="hint">暂无图件。先跑 *_figures 步骤。</p>
          )}
        </div>

        {/* 中间图廊 */}
        <div className="studio-center">
          {selectedFig && selectedFigEntry ? (
            <>
              <div style={{ marginBottom: 12 }}>
                <span className="subtle">当前选中：</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedFig.name}</span>
                <span className="subtle" style={{ marginLeft: 8 }}>
                  {LINE_LABELS[selectedFig.line as keyof typeof LINE_LABELS]}
                </span>
              </div>
              <div className="studio-fig-grid" style={{ gridTemplateColumns: '1fr' }}>
                <div className="studio-fig-card" onClick={() => setZoom(selectedFig)}>
                  <img src={imgUrl(selectedFig.name, selectedFig.line)} alt={selectedFig.name} loading="lazy" />
                  <div className="studio-fig-cap">
                    <span className="studio-fig-name">{selectedFig.name}</span>
                    {selectedFigEntry.caption && <span className="studio-fig-desc">{selectedFigEntry.caption}</span>}
                    {selectedFigEntry.sizeLabel && <span className="subtle">{selectedFigEntry.sizeLabel}</span>}
                  </div>
                </div>
              </div>

              {/* Top TSV 表格预览占位 */}
              <div className="tsv-preview">
                <h3 className="card-subtitle">Top TSV 表格预览</h3>
                <p className="hint">TSV 表格预览通过 /api/files/tree 在该线 results/ 目录下查找 .tsv 文件后展示。</p>
              </div>
            </>
          ) : (
            <>
              {/* 默认展示全部图件 */}
              {LINES.map((line) => {
                const figs = figuresByLine[line] || [];
                if (figs.length === 0) return null;
                return (
                  <div key={line} style={{ marginBottom: 20 }}>
                    <h3 className="card-subtitle">
                      {LINE_LABELS[line as keyof typeof LINE_LABELS]}（{figs.length} 张）
                    </h3>
                    <div className="studio-fig-grid">
                      {figs.map((fig) => {
                        const tag = getGeneTypeTag(fig.name);
                        return (
                          <div key={fig.name} className="studio-fig-card"
                            onClick={() => { setSelectedFig({ name: fig.name, line }); }}>
                            <img src={imgUrl(fig.name, line)} alt={fig.name} loading="lazy" />
                            <div className="studio-fig-cap">
                              {tag.label && <span className={`gene-type-tag ${tag.cls}`}>{tag.label}</span>}
                              <span className="studio-fig-name">{fig.name}</span>
                              {fig.caption && <span className="studio-fig-desc">{fig.caption}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {Object.values(figuresByLine).every((arr) => arr.length === 0) && !loading && (
                <p className="hint">暂无图件。</p>
              )}
            </>
          )}
        </div>

        {/* 右侧三段式解读卡片 */}
        <div className="studio-right">
          {selectedFig && interpretation ? (
            <div className="interpretation-card">
              {interpretation.tag.label && (
                <span className={`gene-type-tag ${interpretation.tag.cls}`}>{interpretation.tag.label}</span>
              )}
              {interpretation.sections.map((sec, i) => (
                <div key={i} className="interpretation-section">
                  <div className="interpretation-section-title">{sec.title}</div>
                  <div className="interpretation-section-body">{sec.body}</div>
                </div>
              ))}
              {/* 第三段：元数据 */}
              <div className="interpretation-section">
                <div className="interpretation-section-title">图件元数据</div>
                <div className="interpretation-section-body">
                  文件名：{selectedFig.name}<br />
                  大小：{selectedFigEntry?.sizeLabel || '—'}<br />
                  分析线：{LINE_LABELS[selectedFig.line as keyof typeof LINE_LABELS]}
                </div>
              </div>
            </div>
          ) : (
            <div className="interpretation-card">
              <p className="hint">点击左侧步骤树或中间图件，查看三段式解读。</p>
              <p className="subtle" style={{ marginTop: 8 }}>
                顶部强制醒目标签区分 DEG vs DR Genes。
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 图件放大模态 */}
      {zoom && (
        <div className="modal-overlay" onClick={() => setZoom(null)}>
          <div className="modal-inner" onClick={(e) => e.stopPropagation()}>
            <div className="modal-bar">
              <span>{zoom.name} — {LINE_LABELS[zoom.line as keyof typeof LINE_LABELS]}</span>
              <button className="btn" onClick={() => setZoom(null)}>关闭</button>
            </div>
            <img className="modal-img" src={imgUrl(zoom.name, zoom.line)} alt={zoom.name} />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 客户交付报告卡片（A4/R3）：一个按钮补齐手工断点 2/3
// ============================================================

type DeliverableFile = { name: string; bytes: number };
type ReportFilesResponse = { ok: boolean; projectId: string; files: DeliverableFile[] };
type ReportBuildResponse = {
  ok: boolean;
  error?: string;
  files?: DeliverableFile[];
  report_md_bytes?: number;
  report_html_bytes?: number;
};

const formatDeliverBytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB`
    : `${bytes} B`;

const deliverDownloadUrl = (project: string, name: string) =>
  `/api/report/download?projectId=${encodeURIComponent(project)}&file=${encodeURIComponent(name)}`;

function DeliveryReportCard({ project }: { project: string }) {
  const [files, setFiles] = useState<DeliverableFile[]>([]);
  const [building, setBuilding] = useState(false);
  // 服务端 error 原样透出（引擎的退出码/stderr 是排查依据，不美化不截断）
  const [errorText, setErrorText] = useState('');
  const [note, setNote] = useState('');

  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/report/files?projectId=${encodeURIComponent(project)}`);
      const payload = (await res.json()) as ReportFilesResponse & { error?: string };
      if (payload.error) {
        setErrorText(payload.error);
        return;
      }
      setFiles(payload.files || []);
    } catch (cause) {
      setErrorText(cause instanceof Error ? cause.message : String(cause));
    }
  }, [project]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const buildReport = useCallback(async () => {
    setBuilding(true);
    setErrorText('');
    setNote('');
    try {
      const res = await fetch('/api/report/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project }),
      });
      const payload = (await res.json()) as ReportBuildResponse;
      if (!res.ok || !payload.ok) {
        // 失败原因（引擎 stderr / 缺失文件名）原样展示
        setErrorText(payload.error || `HTTP ${res.status}`);
        return;
      }
      setNote(`交付件已生成并回搬本地：${(payload.files || []).map((f) => `${f.name}（${formatDeliverBytes(f.bytes)}）`).join('、')}`);
      await loadFiles();
    } catch (cause) {
      setErrorText(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBuilding(false);
    }
  }, [project, loadFiles]);

  return (
    <div className="card" style={{ marginBottom: 12, paddingBottom: 12 }}>
      <div className="card-head">
        <h2 className="card-title">客户交付报告</h2>
        <button className="btn" onClick={() => void buildReport()} disabled={building}>
          {building ? '生成中...' : '生成交付报告'}
        </button>
      </div>
      <p className="subtle">
        在服务器上组装七章解读报告（Analysis_Report.md / .html + Client_Delivery.tar.gz），
        完成后自动回搬本地；生成需在服务器读取全部产物，可能需要数分钟。
      </p>
      {note && <p className="subtle">{note}</p>}
      {errorText && (
        <p className="hint" style={{ color: '#b91c1c', whiteSpace: 'pre-wrap' }}>
          {errorText}
        </p>
      )}
      {files.length > 0 && (
        <div>
          {files.map((file) => (
            <div key={file.name} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '4px 0' }}>
              <span style={{ fontFamily: 'Consolas, monospace', fontSize: 12 }}>{file.name}</span>
              <span className="subtle">{formatDeliverBytes(file.bytes)}</span>
              <a href={deliverDownloadUrl(project, file.name)} download>下载</a>
            </div>
          ))}
        </div>
      )}
      {files.length === 0 && !building && !errorText && (
        <p className="hint">本地暂无交付文件。分析产物齐全后点「生成交付报告」。</p>
      )}
    </div>
  );
}

// ============================================================
// 任务面板（复用现有逻辑，改为 CSS class）
// ============================================================

/**
 * 客户端路径形态预检（S29 / R9）：只提示，不阻断提交。
 * 判据在服务端 validateTaskPaths；这里只挑"明显缺 projects/ 段"的行提醒，
 * 历史三线形态与 processed/ 下的相对文件名仍可提交。
 */
function pathShapeWarnings(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item !== '' && !item.includes('projects/'));
}

function TaskPanel({ project }: { project: string }) {
  const [line, setLine] = useState<string>(LINES[0]);
  const [step, setStep] = useState('');
  // 契约固定种子（aims §一.3）：默认值就是台账复现所需的种子，改动需用户自己负责
  const [seed, setSeed] = useState('20261013');
  const [inputs, setInputs] = useState('');
  const [outputs, setOutputs] = useState('');
  // 步骤清单（/api/projects/steps）与"自定义步骤"开关：下拉是便利入口，不收回手填
  const [stepsData, setStepsData] = useState<StepsResponse['steps'] | null>(null);
  const [stepCustom, setStepCustom] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [exitInfo, setExitInfo] = useState<{ code: number | null; entry: TaskEntry | null; note?: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const box = logBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [logs]);

  useEffect(() => () => eventSourceRef.current?.close(), []);

  // 步骤清单来自 /api/projects/steps（三线步骤由 src/ 母版定义）。
  // 拉不到就静默退回纯手填，不阻塞下发（R10：自由文本入口保留）。
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/projects/steps');
        const payload = (await res.json()) as StepsResponse;
        setStepsData(payload.steps);
      } catch {
        // 静默：下拉为空时用户仍可"自定义"手填命令名
      }
    })();
  }, []);

  const appendLog = useCallback((stream: LogLine['stream'], text: string) => {
    setLogs((prev) => [...prev, { stream, text }]);
  }, []);

  const openLogStream = useCallback(
    (id: string) => {
      eventSourceRef.current?.close();
      const source = new EventSource(`/api/tasks/logs?id=${encodeURIComponent(id)}`);
      source.addEventListener('stdout', (event) => appendLog('stdout', (event as MessageEvent<string>).data));
      source.addEventListener('stderr', (event) => appendLog('stderr', (event as MessageEvent<string>).data));
      source.addEventListener('exit', (event) => {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          code: number | null;
          entry?: TaskEntry;
          note?: string;
        };
        setExitInfo({ code: payload.code, entry: payload.entry ?? null, note: payload.note });
        setRunning(false);
        source.close();
        eventSourceRef.current = null;
      });
      eventSourceRef.current = source;
    },
    [appendLog]
  );

  const submit = useCallback(async () => {
    setSubmitError(null);
    setLogs([]);
    setExitInfo(null);
    if (!step.trim()) {
      setSubmitError('step 必填');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/tasks/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project,
          lineId: line,
          step: step.trim(),
          inputs: inputs.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
          outputs: outputs.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
          seed: seed.trim() === '' ? undefined : Number(seed),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setSubmitError(payload.error || `HTTP ${response.status}`);
        return;
      }
      setTaskId(payload.taskId);
      setRunning(true);
      openLogStream(payload.taskId);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }, [line, step, seed, inputs, outputs, openLogStream, project]);

  const stop = useCallback(async () => {
    if (!taskId) return;
    try {
      await fetch(`/api/tasks/stop?id=${encodeURIComponent(taskId)}`, { method: 'POST' });
    } catch (cause) {
      appendLog('stderr', `[ui] 中止请求失败: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    }
  }, [taskId, appendLog]);

  const exitPalette =
    exitInfo === null
      ? null
      : exitInfo.code === 0
        ? { cls: 'badge-pass', text: 'exit 0（成功）' }
        : exitInfo.code === null
          ? { cls: 'badge-unknown', text: '已中止' }
          : { cls: 'badge-fail', text: `exit ${exitInfo.code}（失败）` };

  const lineSteps: string[] = stepsData ? (stepsData[line as keyof typeof stepsData] ?? []) : [];
  const shapeWarnings = [...pathShapeWarnings(inputs), ...pathShapeWarnings(outputs)];

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">任务下发 + 日志流</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={submitting || running}>
            {submitting ? '提交中...' : running ? '运行中...' : '下发任务'}
          </button>
          <button className="btn" onClick={() => void stop()} disabled={!running}>中止</button>
        </div>
      </div>

      <div className="chip-row">
        {LINES.map((item) => (
          <button key={item} type="button"
            className={`chip${line === item ? ' chip-active' : ''}`}
            onClick={() => {
              setLine(item);
              // 换线后旧步骤名不属于新线，清空避免带着上一条线的步骤提交
              if (!stepCustom) setStep('');
            }}>
            {LINE_LABELS[item as keyof typeof LINE_LABELS]}
          </button>
        ))}
      </div>

      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">步骤名</label>
          <select className="form-input"
            value={stepCustom ? '__custom__' : (lineSteps.includes(step) ? step : '')}
            onChange={(e) => {
              const value = e.target.value;
              if (value === '__custom__') {
                setStepCustom(true);
                setStep('');
              } else {
                setStepCustom(false);
                setStep(value);
              }
            }}>
            <option value="">{lineSteps.length > 0 ? '选择步骤（或自定义）' : '步骤清单未加载，可选自定义'}</option>
            {lineSteps.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
            <option value="__custom__">自定义（手动输入命令名）</option>
          </select>
          {stepCustom && (
            <input className="form-input" style={{ marginTop: 8 }} value={step}
              onChange={(e) => setStep(e.target.value)}
              placeholder="命令名，仅限字母数字与 . _ -" />
          )}
        </div>
        <div className="form-group">
          <label className="form-label">随机种子</label>
          <input className="form-input" value={seed}
            onChange={(e) => setSeed(e.target.value)} inputMode="numeric" />
          <p className="subtle">契约固定种子 20261013（aims §一.3）；改动将使结果不可复现</p>
        </div>
      </div>
      <p className="hint">
        步骤名即远端执行的命令名（只能包含字母数字与 . _ -），参数请走下方输入/输出文件。
        下拉清单来自 /api/projects/steps，取不到或需要新步骤时选「自定义」手填。
      </p>

      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label">输入文件（每行一个）</label>
          <textarea className="form-input" rows={3} value={inputs}
            onChange={(e) => setInputs(e.target.value)}
            placeholder={`/mnt/ssd/bio_data/projects/${project}/${line}/processed/data/expr.tsv`}
            style={{ fontFamily: 'monospace' }} />
        </div>
        <div className="form-group">
          <label className="form-label">输出文件（每行一个）</label>
          <textarea className="form-input" rows={3} value={outputs}
            onChange={(e) => setOutputs(e.target.value)}
            placeholder={`/mnt/ssd/bio_data/projects/${project}/${line}/results/deg.tsv`}
            style={{ fontFamily: 'monospace' }} />
        </div>
      </div>
      <p className="hint">
        路径须属于当前项目 {project}；提交前会校验归属与形态（跨项目、含 ..、系统目录一律 400），
        存在性由远端任务自行报错。历史三线形态与 processed/ 下的相对文件名仍可提交。
      </p>

      {shapeWarnings.length > 0 && (
        <div className="block-box" style={{ background: '#fffbe6', borderColor: '#f5d9a8', color: '#8a5a00' }}>
          <strong>路径形态提醒（仅提示，不阻断提交）</strong>
          <p className="hint" style={{ color: '#8a5a00' }}>
            以下 {shapeWarnings.length} 条路径缺少 projects/&lt;项目&gt; 段：
            {shapeWarnings.slice(0, 5).join('、')}
            {shapeWarnings.length > 5 ? ` 等 ${shapeWarnings.length} 条` : ''}。
            可能是历史三线形态或 processed/ 下的相对文件名，请确认是刻意使用。
          </p>
        </div>
      )}

      {submitError && (
        <div className="block-box" style={{ background: '#fdecea', borderColor: '#f5b7b1', color: '#b3261e' }}>
          <strong>下发被拒绝</strong>
          <p className="hint" style={{ color: '#b3261e' }}>{submitError}</p>
        </div>
      )}

      {taskId && (
        <p className="subtle">任务 ID：{taskId}（{line} / {step}）</p>
      )}

      {logs.length > 0 && (
        <div ref={logBoxRef} className="log-box">
          {logs.map((log, index) => (
            <div key={index} className={log.stream === 'stderr' ? 'log-stderr' : 'log-stdout'}>
              {log.text}
            </div>
          ))}
        </div>
      )}

      {exitInfo && exitPalette && (
        <div style={{ marginTop: 12 }}>
          <span className={`badge ${exitPalette.cls}`}>{exitPalette.text}</span>
          {exitInfo.note && <span className="hint"> {exitInfo.note}</span>}
          {exitInfo.entry && (
            <table className="data-table">
              <tbody>
                <tr><td>台账 task_id</td><td>{exitInfo.entry.task_id}</td></tr>
                <tr><td>状态 / checkpoint</td><td>{exitInfo.entry.status} / {exitInfo.entry.checkpoint_status}</td></tr>
                <tr><td>种子</td><td>{exitInfo.entry.environment.random_seed ?? '未记录'}</td></tr>
                <tr><td>error_log</td><td style={{ color: exitInfo.entry.error_log ? '#b3261e' : '#52606d' }}>
                  {exitInfo.entry.error_log ? exitInfo.entry.error_log.slice(-500) : '无'}
                </td></tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {logs.length === 0 && !exitInfo && !submitError && (
        <p className="hint">下发后这里实时显示远端 stdout/stderr；任务结束自动回显退出码与台账摘要。跨线内容会被审计直接拒绝（HTTP 400）。</p>
      )}
    </div>
  );
}

// ============================================================
// 文件浏览面板
// ============================================================

function FilesPanel({ project }: { project: string }) {
  const [activeLine, setActiveLine] = useState<string>(LINES[0]);
  const [subdir, setSubdir] = useState<string>('processed');
  const [result, setResult] = useState<FilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const browse = useCallback(
    async (line: string, sub: string) => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/files/tree?project=${encodeURIComponent(project)}&line=${encodeURIComponent(line)}&sub=${encodeURIComponent(sub)}`
        );
        setResult(await response.json());
      } catch (cause) {
        setResult({ error: cause instanceof Error ? cause.message : String(cause) });
      } finally {
        setLoading(false);
      }
    },
    [project]
  );

  useEffect(() => {
    void browse(activeLine, subdir);
  }, [activeLine, subdir, browse]);

  const toggle = (path: string) => setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));

  const renderNode = (node: TreeNode, depth: number) => {
    const isOpen = expanded[node.path] ?? depth < 2;
    const isDir = node.type === 'd';
    return (
      <div key={node.path}>
        <div className="tree-row" style={{ paddingLeft: 8 + depth * 16 }} onClick={() => isDir && toggle(node.path)}>
          <span className="tree-icon">{isDir ? (isOpen ? '▾' : '▸') : ''}</span>
          <span style={{ color: isDir ? '#1f2933' : '#52606d' }}>{node.name}</span>
          {!isDir && <span className="tree-size">{(node.size / 1024).toFixed(1)} KB</span>}
          {isDir && node.children.length === 0 && <span className="tree-size">空</span>}
        </div>
        {isDir && isOpen && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">数据面文件浏览</h2>
        <button className="btn" onClick={() => void browse(activeLine, subdir)} disabled={loading}>
          {loading ? '读取中...' : '刷新'}
        </button>
      </div>

      <div className="chip-row">
        {LINES.map((line) => (
          <button key={line} type="button"
            className={`chip${activeLine === line ? ' chip-active' : ''}`}
            onClick={() => setActiveLine(line)}>
            {LINE_LABELS[line as keyof typeof LINE_LABELS]}
          </button>
        ))}
      </div>

      <div className="chip-row">
        {SUBDIRS.map((sub) => (
          <button key={sub} type="button"
            className={`chip${subdir === sub ? ' chip-active' : ''}`}
            onClick={() => setSubdir(sub)}>
            {sub}
          </button>
        ))}
      </div>

      {(() => {
        const state = readApiState<Exclude<FilesResponse, { error: string }>>(result as never);
        if (state.kind === 'loading') return <p className="hint">读取中...</p>;
        if (state.kind === 'failed') return <p className="error-text">后端错误：{state.message}</p>;
        if (state.data.blocked) {
          return (
            <div className="block-box">
              <strong>阻塞：{state.data.reason}</strong>
              <p className="hint">{state.data.hint}</p>
            </div>
          );
        }
        return (
          <>
            <p className="subtle">根：{state.data.root}</p>
            {state.data.tree.children.length === 0 ? (
              <p className="hint">该目录为空。</p>
            ) : (
              <div className="file-tree">{state.data.tree.children.map((node) => renderNode(node, 0))}</div>
            )}
          </>
        );
      })()}
    </div>
  );
}

// ============================================================
// 图件面板
// ============================================================

function FiguresPanel({ project }: { project: string }) {
  const [activeLine, setActiveLine] = useState<string>(LINES[0]);
  const [result, setResult] = useState<FiguresResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  const load = useCallback(async (line: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/figures/list?project=${encodeURIComponent(project)}&line=${encodeURIComponent(line)}`
      );
      setResult(await response.json());
    } catch (cause) {
      setResult({ error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void load(activeLine);
  }, [activeLine, load]);

  const imgUrl = (name: string) =>
    `/api/figures/image?project=${encodeURIComponent(project)}&line=${encodeURIComponent(activeLine)}&name=${encodeURIComponent(name)}`;

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">结果图件浏览</h2>
        <button className="btn" onClick={() => void load(activeLine)} disabled={loading}>
          {loading ? '读取中...' : '刷新'}
        </button>
      </div>

      <div className="chip-row">
        {LINES.map((line) => (
          <button key={line} type="button"
            className={`chip${activeLine === line ? ' chip-active' : ''}`}
            onClick={() => setActiveLine(line)}>
            {LINE_LABELS[line as keyof typeof LINE_LABELS]}
          </button>
        ))}
      </div>

      {(() => {
        const state = readApiState<Exclude<FiguresResponse, { error: string }>>(result as never);
        if (state.kind === 'loading') return <p className="hint">读取中...</p>;
        if (state.kind === 'failed') return <p className="error-text">后端错误：{state.message}</p>;
        if (state.data.blocked) {
          return (
            <div className="block-box">
              <strong>阻塞：{state.data.reason}</strong>
              <p className="hint">{state.data.hint}</p>
            </div>
          );
        }
        if (state.data.figures.length === 0) {
          return <p className="hint">该线 figures/ 目录暂无图件。先跑该线的 *_figures 步骤。</p>;
        }
        return (
          <>
            <p className="subtle">
              目录：{state.data.dir}（{state.data.figures.length} 张，点击放大）
            </p>
            <div className="studio-fig-grid">
              {state.data.figures.map((fig) => (
                <div key={fig.name} className="studio-fig-card" onClick={() => setZoom(fig.name)}>
                  <img src={imgUrl(fig.name)} alt={fig.name} loading="lazy" />
                  <div className="studio-fig-cap">
                    <span className="studio-fig-name">{fig.name}</span>
                    {fig.caption && <span className="studio-fig-desc">{fig.caption}</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        );
      })()}

      {zoom && (
        <div className="modal-overlay" onClick={() => setZoom(null)}>
          <div className="modal-inner" onClick={(e) => e.stopPropagation()}>
            <div className="modal-bar">
              <span>{zoom}</span>
              <button className="btn" onClick={() => setZoom(null)}>关闭</button>
            </div>
            <img className="modal-img" src={imgUrl(zoom)} alt={zoom} />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 上传面板
// ============================================================

/** 查服务端已落盘分片；任何失败（网络错、400、非 JSON）都按「没有会话」处理 */
async function fetchUploadStatus(uploadId: string): Promise<UploadStatus | null> {
  try {
    const response = await fetch(`/api/upload/status?uploadId=${encodeURIComponent(uploadId)}`);
    if (!response.ok) return null;
    return (await response.json()) as UploadStatus;
  } catch {
    return null;
  }
}

function UploadPanel({ project }: { project: string }) {
  const [lineId, setLineId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [resumeNote, setResumeNote] = useState('');
  const [result, setResult] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async () => {
    if (!lineId) { setStatus('请先选择归属线'); return; }
    if (!file) { setStatus('请先选择文件'); return; }
    if (file.size === 0) { setStatus('文件为空'); return; }
    const fingerprint = fileFingerprint(project, lineId, file);
    // 确定性 id：同一文件（项目 + 线 + 名字 + 大小 + 修改时间）在任何浏览器算出的 id 都相同，
    // 所以刷新、换浏览器、换设备都能直接按它查已落盘分片接着传。
    const deterministicId = uploadIdFromFingerprint(fingerprint);
    setBusy(true); setResult(null); setProgress(0); setResumeNote('');
    setStatus('检查断点...');
    try {
      // 1) 确定性 id 优先：服务端有这个会话就直接续传，没有就走 init。
      let uploadId: string | null = deterministicId || null;
      let chunkSize = 0;
      let nextIndex = 0;
      if (uploadId) {
        const previous = await fetchUploadStatus(uploadId);
        if (previous && previous.exists && typeof previous.chunkSize === 'number') {
          chunkSize = previous.chunkSize;
          nextIndex = typeof previous.nextIndex === 'number' ? previous.nextIndex : 0;
        } else {
          uploadId = null;   // 首次传 / 会话已被 GC：走 init
        }
      }
      // 2) 升级兼容：老版本把 init 返回的 randomUUID 缓存在 localStorage 里。
      //    确定性 id 没命中时再用旧缓存 id 探一次，命中也续传，同一个文件不白重传。
      if (!uploadId) {
        const legacyId = readStoredUploadId(fingerprint);
        if (legacyId && legacyId !== deterministicId) {
          const legacy = await fetchUploadStatus(legacyId);
          if (legacy && legacy.exists && typeof legacy.chunkSize === 'number') {
            uploadId = legacyId;
            chunkSize = legacy.chunkSize;
            nextIndex = typeof legacy.nextIndex === 'number' ? legacy.nextIndex : 0;
          } else {
            forgetUploadId(fingerprint);
          }
        }
      }
      if (!uploadId) {
        const initRes = await fetch('/api/upload/init', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          // 带上指纹：服务端用同一个纯函数派生 uploadId，老服务端会忽略这个字段。
          body: JSON.stringify({ projectId: project, lineId, filename: file.name, fingerprint }),
        });
        const init = await initRes.json();
        if (init.error) throw new Error(init.error);
        uploadId = (init as { uploadId: string }).uploadId;
        chunkSize = (init as { chunkSize: number }).chunkSize;
        // 新建会话后仍查一次 status：init 只建目录，正常 nextIndex=0；
        // 若目录里已有分片（同一 id 被复用的边界情况）也能兜住，不白重传。
        const initial = await fetchUploadStatus(uploadId);
        if (initial && typeof initial.nextIndex === 'number') nextIndex = initial.nextIndex;
        if (initial && typeof initial.chunkSize === 'number') chunkSize = initial.chunkSize;
        // 只缓存非确定性 id（老服务端回落 UUID 时才有意义）；确定性 id 由指纹现算，不必缓存。
        if (uploadId !== deterministicId) storeUploadId(fingerprint, uploadId);
      }
      if (!chunkSize || chunkSize <= 0) throw new Error('服务端未返回分片大小');
      const total = Math.ceil(file.size / chunkSize);
      const startIndex = resumeStartIndex({ nextIndex }, total);
      if (startIndex > 0) {
        setResumeNote(`已从第 ${startIndex + 1} 片续传（共 ${total} 片，跳过已收 ${startIndex} 片）`);
        setProgress(Math.round((startIndex / total) * 100));
      }
      setStatus(startIndex >= total
        ? '分片已全部就绪，直接合并...'
        : (startIndex > 0 ? `续传中...（已收 ${startIndex}/${total} 片）` : '上传中...'));
      for (let i = startIndex; i < total; i += 1) {
        const blob = file.slice(i * chunkSize, (i + 1) * chunkSize);
        const r = await fetch(
          `/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${i}`,
          { method: 'POST', body: blob }
        );
        if (!r.ok) throw new Error(`分片 ${i} 上传失败`);
        setProgress(Math.round(((i + 1) / total) * 100));
      }
      const compRes = await fetch('/api/upload/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project, uploadId, lineId, filename: file.name }),
      });
      const comp: UploadResult = await compRes.json();
      setResult(comp);
      // complete 走到合并/校验就说明服务端已清理暂存目录，缓存 id 作废；
      // scp 失败（只有 error 无 validation）时目录还在，保留 id 以便重试直接合并。
      if (comp.ok || comp.validation) forgetUploadId(fingerprint);
      setStatus(comp.error ? `失败：${comp.error}`
        : (comp.ok ? '上传完成，字节校验通过' : (comp.hint || '未通过')));
    } catch (cause) {
      setResumeNote('已传分片已保留，点「继续上传」从断点续传');
      setStatus('失败：' + (cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, [lineId, file, project]);

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">数据导入</h2>
      </div>
      <p className="hint">上传原始数据到服务器对应线的 raw_data/。4MB 分片上传 + 断点续传 + 格式校验 + 强制归属线。</p>
      <p className="hint">断点续传：上传会话 id 由「项目 + 归属线 + 文件名 + 大小 + 修改时间」确定性派生，刷新、换浏览器、换设备都会先查 GET /api/upload/status，从已落盘分片之后继续；服务端 24 小时没动过的会话会被自动清理。</p>

      <div className="form-group">
        <label className="form-label">归属线（必选）</label>
        <div className="chip-row">
          {LINES.map((line) => (
            <button key={line} type="button"
              className={`chip${lineId === line ? ' chip-active' : ''}`}
              onClick={() => setLineId(line)}>
              {LINE_LABELS[line as keyof typeof LINE_LABELS]}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">选择文件</label>
        <input ref={inputRef} type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file && <span className="subtle">{file.name}（{(file.size / 1024 / 1024).toFixed(2)} MB）</span>}
      </div>

      <div className="chip-row">
        <button className="btn btn-primary" onClick={() => void upload()} disabled={busy}>
          {busy ? `上传中 ${progress}%` : (resumeNote ? '继续上传' : '开始上传')}
        </button>
        {file && !busy && (
          <button className="btn" onClick={() => {
            setFile(null); setResult(null); setStatus('');
            if (inputRef.current) inputRef.current.value = '';
          }}>清空</button>
        )}
      </div>

      {busy && (
        <div className="progress-outer">
          <div className="progress-inner" style={{ width: `${progress}%` }} />
        </div>
      )}
      {resumeNote && <p className="subtle">{resumeNote}</p>}
      {status && <p className={result?.error ? 'error-text' : 'subtle'}>{status}</p>}

      {result?.validation && (
        <div className="block-box">
          <strong>格式校验：{result.validation.ok ? '通过' : '未通过'}</strong>
          <p className="subtle">magic={result.validation.magic}　模态建议={result.validation.modality}</p>
          {result.validation.reasons.length > 0 && (
            <p className="error-text">问题：{result.validation.reasons.join('；')}</p>
          )}
          {result.validation.warnings.length > 0 && (
            <p className="subtle">提醒：{result.validation.warnings.join('；')}</p>
          )}
          {result.remotePath && (
            <p className="subtle">
              已落盘：{result.remotePath}（本地 {result.localSize} 字节 / 远端 {result.remoteSize} 字节，
              {result.sizeMatch ? '一致' : '不一致'}）
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 台账巡检面板
// ============================================================

function LedgerPanel() {
  const [result, setResult] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/ledger/check');
      setResult(await response.json());
    } catch (cause) {
      setResult({ error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setLoading(false);
    }
  }, []);

  const exportReport = useCallback(() => {
    if (!result || !('blocked' in result) || result.blocked) return;
    const lines: string[] = [
      `# 台账合规巡检报告`,
      `目录: ${result.dir}`,
      `时间: ${new Date().toLocaleString('zh-CN')}`,
      `总计 ${result.summary.total} 条，合法 ${result.summary.legal}，违规 ${result.summary.violations}`,
      '',
    ];
    for (const entry of result.entries) {
      lines.push(`${entry.legal ? 'OK' : 'VIOLATION'}  ${entry.file}  line_id=${entry.lineId} step=${entry.stepName} status=${entry.status}`);
      for (const problem of entry.problems) lines.push(`    - ${problem}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `ledger_audit_${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }, [result]);

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">台账合规巡检</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => void run()} disabled={loading}>
            {loading ? '巡检中...' : '开始巡检'}
          </button>
          <button className="btn" onClick={exportReport}
            disabled={!result || !('blocked' in result) || result.blocked}>
            导出报告
          </button>
        </div>
      </div>

      {!result && <p className="hint">点"开始巡检"读取服务器台账并逐条判定。</p>}

      {result && 'error' in result && <p className="error-text">后端错误：{result.error}</p>}

      {result && 'blocked' in result && result.blocked && (
        <div className="block-box">
          <strong>阻塞：{result.reason}</strong>
          <p className="hint">{result.hint}</p>
        </div>
      )}

      {result && 'summary' in result && !result.blocked && result.summary && (
        <>
          <div className="compute-row">
            <div className="compute-cell">
              <div className="compute-cell-label">台账总数</div>
              <div className="compute-cell-value">{result.summary.total}</div>
            </div>
            <div className="compute-cell">
              <div className="compute-cell-label">合法</div>
              <div className="compute-cell-value" style={{ color: '#0f7b3f' }}>{result.summary.legal}</div>
            </div>
            <div className="compute-cell">
              <div className="compute-cell-label">违规</div>
              <div className="compute-cell-value" style={{ color: result.summary.violations > 0 ? '#b3261e' : '#1f2933' }}>
                {result.summary.violations}
              </div>
            </div>
          </div>

          <h3 className="card-subtitle">按线统计</h3>
          <table className="data-table">
            <thead>
              <tr><th>线</th><th>合法</th><th>违规</th><th>已记录步骤</th></tr>
            </thead>
            <tbody>
              {LINES.map((line) => {
                const bucket = result.summary.byLine[line];
                return (
                  <tr key={line}>
                    <td>{LINE_LABELS[line as keyof typeof LINE_LABELS]}</td>
                    <td style={{ color: '#0f7b3f' }}>{bucket.legal}</td>
                    <td style={{ color: bucket.violations > 0 ? '#b3261e' : '#52606d' }}>{bucket.violations}</td>
                    <td>
                      {Object.keys(bucket.steps).length === 0
                        ? '无'
                        : Object.entries(bucket.steps)
                            .map(([step, state]) => `${step}（${state === 'legal' ? '合法' : '违规'}）`)
                            .join('；')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {result.entries.length > 0 && (
            <>
              <h3 className="card-subtitle">逐条明细</h3>
              <table className="data-table">
                <thead>
                  <tr><th>文件</th><th>判定</th><th>原因</th></tr>
                </thead>
                <tbody>
                  {result.entries.map((entry) => (
                    <tr key={entry.file}>
                      <td>
                        {entry.file}
                        <div className="subtle">{entry.lineId} / {entry.stepName} / {entry.status}</div>
                      </td>
                      <td style={{ color: entry.legal ? '#0f7b3f' : '#b3261e' }}>
                        {entry.legal ? 'OK' : 'VIOLATION'}
                      </td>
                      <td>
                        {entry.problems.length === 0 ? '无' : entry.problems.map((p) => <div key={p}>{p}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}
