/**
 * 分组设计面板（T3-1 巨石首刀，2026-11-05）。
 *
 * 从 OnboardingView.tsx 抽出的第一块：分组模式选择 + 一键粘贴 + 分组卡片列表 + 对比对生成器。
 * 抽取边界刻意只到「纯受控渲染」——所有状态与变更函数仍留在 OnboardingView，
 * 由 props 注入。这样切块是行为等价的重构，不迁移任何状态机，风险最小。
 *
 * 为什么先切这块：它内部没有任何 fetch、没有 useEffect、没有跨模块耦合，
 * 只依赖 parseSampleIds / isGroupDuplicate 两个纯函数与六个回调，是最独立的一段。
 */
import type { GroupMode, GroupRole, GroupEntry, Contrast } from "../../views/shared/types";

type Props = {
  groupMode: GroupMode;
  setGroupMode: (mode: GroupMode) => void;
  groups: GroupEntry[];
  bulkPasteOpen: boolean;
  setBulkPasteOpen: (open: boolean) => void;
  bulkPasteText: string;
  setBulkPasteText: (text: string) => void;
  applyBulkPaste: () => void;
  parseSampleIds: (text: string) => string[];
  isGroupDuplicate: (group: GroupEntry) => boolean;
  moveGroupUp: (index: number) => void;
  moveGroupDown: (index: number) => void;
  removeGroup: (groupId: string) => void;
  updateGroup: (groupId: string, patch: Partial<GroupEntry>) => void;
  setGroupRole: (groupId: string, role: GroupRole) => void;
  addGroup: () => void;
  contrasts: Contrast[];
  toggleContrast: (name: string) => void;
  primaryContrast: string;
  // 与 OnboardingView 里的原函数同名，避免抽取时改名引入行为漂移
  setPrimaryContrastItem: (name: string) => void;
};

const GROUP_MODES = [
  { value: "two_group", label: "二分类对比 (2 Groups)" },
  { value: "multi_group", label: "多组无序对比 (Multi-group)" },
  { value: "ordered_stage", label: "有序病情阶段演进 (Ordered Stage)" },
] as const;

export function GroupDesignPanel({
  groupMode, setGroupMode, groups, bulkPasteOpen, setBulkPasteOpen,
  bulkPasteText, setBulkPasteText, applyBulkPaste,
  parseSampleIds, isGroupDuplicate,
  moveGroupUp, moveGroupDown, removeGroup, updateGroup, setGroupRole, addGroup,
  contrasts, toggleContrast, primaryContrast, setPrimaryContrastItem,
}: Props) {
  return (
    <>
      <div className="form-group" data-testid="group-mode-selector">
        <label className="form-label">分组模式</label>
        <div className="chip-row">
          {GROUP_MODES.map((opt) => (
            <button key={opt.value} type="button"
              className={`chip${groupMode === opt.value ? " chip-active" : ""}`}
              onClick={() => setGroupMode(opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <button type="button" className="btn" onClick={() => setBulkPasteOpen(!bulkPasteOpen)}>
          {bulkPasteOpen ? "取消粘贴" : "一键粘贴 2 列分组表"}
        </button>
      </div>
      {bulkPasteOpen && (
        <div className="bulk-paste-area">
          <textarea className="form-input" rows={5} value={bulkPasteText}
            onChange={(e) => setBulkPasteText(e.target.value)}
            placeholder={"Sample_ID,Group_Name\nGSM416528,Control\nGSM416529,Control\nGSM416530,Disease\n（逗号或 tab 分隔）"}
            style={{ fontFamily: "monospace" }} />
          <button type="button" className="btn btn-primary" onClick={applyBulkPaste} style={{ marginTop: 8 }}>
            解析并填充分组
          </button>
        </div>
      )}

      <div className="group-card-list" data-testid="group-card-list">
        {groups.map((group, index) => {
          const sampleCount = parseSampleIds(group.sampleIdsText).length;
          const hasDup = isGroupDuplicate(group);
          return (
            <div key={group.groupId} className={`group-card${hasDup ? " group-card-duplicate" : ""}`}>
              <div className="group-card-head">
                <span className="group-card-index">分组 {index + 1}</span>
                <div className="group-card-actions">
                  {groupMode === "ordered_stage" && (
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
                {groupMode === "ordered_stage" && (
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
                  style={{ fontFamily: "monospace" }} />
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

      {groups.length >= 3 && contrasts.length > 0 && (
        <div className="form-group" style={{ marginTop: 16 }} data-testid="contrast-list">
          <label className="form-label">显式对比对 (Contrasts)</label>
          <p className="subtle">自动生成所有两两对比组合，勾选启用，单选标记主对比对。</p>
          <div className="contrast-list">
            {contrasts.map((c) => (
              <div key={c.name} className={`contrast-item${c.enabled ? " contrast-enabled" : ""}`}>
                <label className="contrast-check">
                  <input type="checkbox" checked={c.enabled} onChange={() => toggleContrast(c.name)} />
                  <span className="contrast-name">{c.name}</span>
                </label>
                <label className="contrast-primary">
                  <input type="radio" name="primary-contrast" checked={c.name === primaryContrast}
                    onChange={() => setPrimaryContrastItem(c.name)} />
                  主对比
                </label>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}