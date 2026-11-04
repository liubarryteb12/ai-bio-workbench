/**
 * T3-1 第一刀：从 OnboardingView.tsx 抽出的纯展示受控子组件。
 *
 * 硬约束：Props 进、JSX 出，零状态机；不 import 任何 store / hook / fetch。
 * 这里只放不读写 state 的静态结构，父组件（向导）负责提供文案与保留流程控制。
 * 注意：内部调度术语只留在调用点注释里，不进入本文件任何可见文案。
 */
import type { ReactNode } from 'react';

type ModuleHeadingProps = {
  title: string;
  description: ReactNode;
};

/** 模块卡片头：标题 + 说明。父组件保留外层 <div className="module-card"> 包裹。 */
export function ModuleHeading({ title, description }: ModuleHeadingProps) {
  return (
    <>
      <h2 className="module-title">{title}</h2>
      <p className="module-desc">{description}</p>
    </>
  );
}

type ComputeShieldCardProps = {
  title: string;
  items: readonly string[];
};

/** 算力保护提示卡片：标题 + 静态要点列表。 */
export function ComputeShieldCard({ title, items }: ComputeShieldCardProps) {
  return (
    <div className="form-group">
      <label className="form-label">{title}</label>
      <div className="compute-shield-card">
        <div className="compute-shield-icon">🛡</div>
        <ul className="compute-shield-list">
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </div>
  );
}

type SelectedStepsIndicatorProps = {
  count: number;
};

/** 已选步骤数指示器。父组件保留「count > 0 才渲染」的条件。 */
export function SelectedStepsIndicator({ count }: SelectedStepsIndicatorProps) {
  return (
    <p className="subtle" style={{ marginTop: 8 }}>已选 {count} 个步骤</p>
  );
}
