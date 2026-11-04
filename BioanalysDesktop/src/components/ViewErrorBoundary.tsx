import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/**
 * 视图级错误边界（T0-5 第三项）。
 *
 * 为什么需要：src 下没有 ErrorBoundary，任何渲染期 TypeError（例如
 * /api/selfcheck 回了 {error} 却被当 SelfCheckResponse 渲染）都会把整页
 * React 树卸掉，用户看到纯白屏、连切换 tab 都做不到。
 *
 * 为什么包在每个 tab 视图外层而不是整页一层：一层只会把六个视图一起打死，
 * 而这里的目标是「一个视图坏了，外壳和其他视图照常可用」。
 *
 * 为什么必须给按钮绑定 onClick 重试：降级卡只报错不给出口，用户只能刷新整页。
 * key 由外层递增，重试即重新挂载失败的子树（componentDidMount 会重新拉数据）。
 */

type Props = {
  /** 出问题时显示在降级卡上的视图名，用户要知道是哪一块坏了 */
  viewName: string;
  children: ReactNode;
  /** 外部改变这个值时重置错误态并重新挂载子树 */
  onRetry?: () => void;
};

type State = {
  error: Error | null;
};

export class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 保留在控制台：降级卡给人看，堆栈给开发看；两者不能互相替代
    console.error('[ViewErrorBoundary] ' + this.props.viewName + ' 渲染失败', error, info.componentStack);
  }

  private retry = (): void => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="view-error-card" role="alert">
        <h2 className="view-error-title">{this.props.viewName} 加载失败</h2>
        <p className="error-text">{error.message || String(error)}</p>
        <p className="hint">其他标签页仍可正常使用；重试只会重新加载这一块视图。</p>
        <button type="button" className="btn btn-primary" onClick={this.retry}>
          重试
        </button>
      </div>
    );
  }
}
