/**
 * 视图1 与视图2：新建项目向导页（Onboarding Portal）、分析输入控制台、上传面板。
 *
 * 从 App.tsx 原样搬来：函数体逐字未改，只给 App 真正渲染的两个组件加了 export。
 * fetchUploadStatus 与 UploadPanel 只在本模块内使用，故不导出。
 * import 块随搬运改写过相对路径：本文件比 App.tsx 深一层目录。
 */
import { useEffect, useState, useCallback, useRef } from 'react';

import { LINES, LINE_LABELS } from '../../server/domain.js';
import {
  fileFingerprint, forgetUploadId, readStoredUploadId, resumeStartIndex, storeUploadId,
  uploadIdFromFingerprint,
} from '../lib/uploadSession';
import type { UploadStatus } from '../lib/uploadSession';
import { UppyUploader } from '../components/UppyUploader';
import {
  SPECIES_OPTIONS,
  DOMAIN_OPTIONS,
  DATA_SOURCES,
  ID_TYPE_OPTIONS,
  VALUE_SCALE_OPTIONS,
  LAYOUT_TEMPLATE_OPTIONS,
  CUTOFF_PROFILE_OPTIONS,
  KO_FALLBACK_OPTIONS,
  DATA_TYPE_OPTIONS,
} from './shared/constants';
import { lineFromDataType } from './shared/helpers';
import type {
  BlacklistResult,
  StepMeta,
  StepsResponse,
  GroupMode,
  GroupRole,
  GroupEntry,
  Contrast,
  DatasetRow,
  ReferenceMeta,
  InboxResponse,
  PortalManifest,
  IntakeExtras,
  UploadResult,
} from './shared/types';
import { LedgerPanel, TaskPanel } from './LedgerAuditView';
import { FilesPanel } from './ResultStudioView';
import { ModuleHeading, ComputeShieldCard, SelectedStepsIndicator } from '../components/onboarding/OnboardingDisplayParts';
import { GroupDesignPanel } from '../components/onboarding/GroupDesignPanel';

// 数据来源双模态（aims v2.8，与 server/domain.js DATA_SOURCE_MODES 同值）
type DataSourceMode = 'PUBLIC_DB' | 'IN_HOUSE_UPLOAD';
const LAYOUT_LEGACY_TO_NEW: Record<string, string> = {
  template_1_nature_side: 'template_4x3',
  template_2_cell_wide: 'template_16x9',
  template_3_clinical_note: 'template_4x3',
};
// 旧阈值档位名到新档位名（server/project.js LEGACY_CUTOFF_PROFILES 同值）
const CUTOFF_LEGACY_TO_NEW: Record<string, string> = {
  standard_sci: 'standard',
  sensitive: 'loose',
};
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

// ============================================================
// 视图1：新建项目向导页（Onboarding Portal）
// ============================================================

export function OnboardingPortal({
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
  // 三态可读（P2）：原先 catch 静默吞掉失败，用户只看到空白下拉框，分不清「还在加载」「没有步骤」「后端挂了」。
  const [stepsError, setStepsError] = useState<string | null>(null);
  const [stepsMeta, setStepsMeta] = useState<Record<string, StepMeta>>({});
  const [selectedSteps, setSelectedSteps] = useState<string[]>([]);
  const [koGene, setKoGene] = useState('');

  // 模块 E · v3 intake 分析契约（R2：字段形状照 v3_intake.test.js / server/project.js 归一化契约）
  const [layoutTemplate, setLayoutTemplate] = useState('template_4x3');
  const [cutoffProfile, setCutoffProfile] = useState('standard');
  // 显著性判据：勾了用 adj.P（客户另填值），不勾用名义 p（走档位预设）
  const [useAdjP, setUseAdjP] = useState(true);
  const [adjPThreshold, setAdjPThreshold] = useState('');
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
      } catch (cause) {
        // 不再静默：失败要能显示出来，否则用户面对空下拉框无从判断。
        setStepsError(cause instanceof Error ? cause.message : String(cause));
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
        analysisCutoffs: {
          profile: cutoffProfile,
          ...cutoffOverridePayload,
          // 勾选框语义：勾了才带 adj_p_threshold，服务端据此派生 effective_p_field
          use_adj_p: useAdjP,
          ...(useAdjP && Number.isFinite(Number(adjPThreshold)) && adjPThreshold.trim() !== ''
            ? { adj_p_threshold: Number(adjPThreshold) }
            : {}),
        },
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
      setLayoutTemplate('template_4x3'); setCutoffProfile('standard');
      setUseAdjP(true); setAdjPThreshold('');
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
    dataType, datasetRows, sampleCount, tissue, layoutTemplate, cutoffProfile, useAdjP, adjPThreshold, cutoffOverrides,
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
        // 旧档位名（standard_sci / sensitive）先映射成新档位再回填，避免历史需求单落不进选项
        const rawProfile = m.analysisCutoffs.profile;
        const mappedProfile = CUTOFF_LEGACY_TO_NEW[rawProfile] ?? rawProfile;
        if (CUTOFF_PROFILE_OPTIONS.some((o) => o.id === mappedProfile)) {
          setCutoffProfile(mappedProfile);
        }
        notesList.push(`统计阈值档：${mappedProfile}`);
      }
      const incomingCutoffs = m.analysisCutoffs;
      // 显著性判据：历史需求单没有 use_adj_p，缺省按"用 adj.P"处理
      if (typeof incomingCutoffs?.use_adj_p === 'boolean') setUseAdjP(incomingCutoffs.use_adj_p);
      setAdjPThreshold(incomingCutoffs?.adj_p_threshold != null ? String(incomingCutoffs.adj_p_threshold) : '');
      if (incomingCutoffs?.use_adj_p === false) notesList.push('显著性判据：名义 p 值（未用 adj.P）');
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

  const stepsLoading = stepsData === null && stepsError === null;
  const stepsEmpty = stepsData !== null
    && Object.values(stepsData).every((list) => !Array.isArray(list) || list.length === 0);

  return (
    <div className="view-container">
      {stepsLoading && (
        <p className="hint" role="status" data-testid="loading-state" data-loading-kind="projects">正在加载分析步骤目录...</p>
      )}
      {stepsError && (
        <p className="error-text" role="alert" data-testid="error-state" data-error-kind="projects">
          步骤目录加载失败：{stepsError}
        </p>
      )}
      {stepsEmpty && (
        <p className="hint" data-testid="empty-state" data-empty-kind="projects">
          后端未返回任何分析步骤，请确认工作流清单已部署。
        </p>
      )}
      {/* 模块 0：从客户需求导入 */}
      <div className="module-card">
        <ModuleHeading
          title="从客户需求导入"
          description={<>读取 <code>portal/inbox/</code> 中用户提交台导出的需求文件，自动填充下方 A/B/C/D 四个模块。导入后仍可逐项修改。</>}
        />

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
                        ? `${dtLabel || '⚠ 未填数据类型'} · ${s.domain || ' - '} / ${s.disease || ' - '} / ${s.species || ' - '} · ${s.groupCount} 组 · ${s.stepCount} 步 · ${s.sampleCount} 样本`
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
        <ModuleHeading title="模块 A · 项目基础信息" description="项目 ID、名称、描述与研究领域。疾病/名称/描述实时校验非肿瘤黑名单。" />

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
        <ModuleHeading title="模块 B · 数据来源与分组设计" description="数据类型（决定分析线，必选）+ GEO / ArrayExpress / 自有数据，训练集与验证集 GSE、GPL 平台、样本量、组织来源，以及动态多分组 + 组内样本绑定 + 对比对。" />

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

        {/* T3-1 首刀：分组设计面板已抽到 components/onboarding/GroupDesignPanel.tsx。
            抽取边界只到纯受控渲染，全部状态与回调仍留在本组件，行为等价。 */}
        <GroupDesignPanel
          groupMode={groupMode}
          setGroupMode={setGroupMode}
          groups={groups}
          bulkPasteOpen={bulkPasteOpen}
          setBulkPasteOpen={setBulkPasteOpen}
          bulkPasteText={bulkPasteText}
          setBulkPasteText={setBulkPasteText}
          applyBulkPaste={applyBulkPaste}
          parseSampleIds={parseSampleIds}
          isGroupDuplicate={isGroupDuplicate}
          moveGroupUp={moveGroupUp}
          moveGroupDown={moveGroupDown}
          removeGroup={removeGroup}
          updateGroup={updateGroup}
          setGroupRole={setGroupRole}
          addGroup={addGroup}
          contrasts={contrasts}
          toggleContrast={toggleContrast}
          primaryContrast={primaryContrast}
          setPrimaryContrastItem={setPrimaryContrastItem}
        />
      </div>

      {/* 模块 C：分析线与步骤 */}
      <div className="module-card">
        <ModuleHeading title="模块 C · 分析线与步骤" description="先选一条分析线（物理锁死，单选），再勾选该线步骤。每个步骤展示功能名称、简介、核心工具与输入/输出。前置 QC 模块固定勾选不可取消。" />

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
              <SelectedStepsIndicator count={selectedSteps.length} />
            )}
          </>
        )}
      </div>

      {/* 模块 D：权限、算力策略与交付物配置 */}
      <div className="module-card">
        <ModuleHeading title="模块 D：项目权限、算力保护策略与预期交付物配置" description="本模块用于定义项目归属权、确认服务器端防崩运行级别，并锁定最终交付清单。" />

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
        <ComputeShieldCard
          title="子项 2 · 长任务稳定运行与断点恢复"
          items={[
            '算力节点降权执行：nice/ionice（默认不绑核，动态调度实测更快）+ 3 线程封顶',
            '7.5GB 内存软熔断与检查点续跑',
            '每步 exit 0 后自动落盘检查点与 JSON 台账',
          ]}
        />

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
        <ModuleHeading title="模块 E · 分析契约（v3 intake）" description="决定下游脚本跑什么阈值、按什么统计模型、出图套哪个模板。字段形状与服务端归一化契约逐字段一致；留空项取服务端安全默认。" />

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
          <div className="form-group" style={{ marginTop: 8 }}>
            <label className="form-label">
              <input type="checkbox" checked={useAdjP} onChange={(e) => setUseAdjP(e.target.checked)} />
              {' '}用 adj.P（校正后 p 值）判定显著性
            </label>
            <div className="hint">
              勾选则按 adj.P 判显著，并在下方填 adj.P 阈值；不勾则按档位的名义 p 判定。
              该选择在提交建项时锁死，事后不可逆，避免按结果反复调阈值。
            </div>
            {useAdjP && (
              <input className="form-input" inputMode="decimal" style={{ marginTop: 8 }}
                value={adjPThreshold}
                placeholder="adj.P 阈值，留空沿用档位预设"
                onChange={(e) => setAdjPThreshold(e.target.value)} />
            )}
          </div>
          <div className="form-grid-2" style={{ marginTop: 8 }}>
            {([
              { key: 'log2fc_threshold', label: 'log2FC 阈值（覆盖档位预设）' },
              { key: 'p_threshold', label: '名义 p 阈值（覆盖档位预设）' },
              { key: 'padj_threshold', label: 'adj.P 兼底阈值（覆盖档位预设）' },
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
          <label className="form-label">WGCNA 参数（选填，留空用算力节点安全默认）</label>
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

export function CustomerInputConsole({ project }: { project: string }) {
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
  // 默认仍是原有上传面板；勾选后走 Uppy（拖拽 / 断点重试），传输层与服务端契约不变。
  const [useUppy, setUseUppy] = useState(false);
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
        <label className="subtle" style={{ display: 'block', marginBottom: 8 }}>
          <input type="checkbox" checked={useUppy}
            onChange={(e) => setUseUppy(e.target.checked)} />{' '}
          试用新版上传面板（拖拽、进度、断点重试）
        </label>
        {useUppy ? (
          <UppyUploader
            project={project}
            lineId={lineId}
            onProgress={setProgress}
            onDone={(payload) => {
              setResult(payload as unknown as UploadResult);
              setStatus(payload.ok ? '上传完成，字节校验通过' : '上传完成，未通过校验');
            }}
            onError={(message) => setStatus('失败：' + message)}
          />
        ) : (
          <>
            <input ref={inputRef} type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <span className="subtle">{file.name}（{(file.size / 1024 / 1024).toFixed(2)} MB）</span>}
          </>
        )}
      </div>

      {!useUppy && <div className="chip-row">
        <button className="btn btn-primary" onClick={() => void upload()} disabled={busy}>
          {busy ? `上传中 ${progress}%` : (resumeNote ? '继续上传' : '开始上传')}
        </button>
        {file && !busy && (
          <button className="btn" onClick={() => {
            setFile(null); setResult(null); setStatus('');
            if (inputRef.current) inputRef.current.value = '';
          }}>清空</button>
        )}
      </div>}

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
