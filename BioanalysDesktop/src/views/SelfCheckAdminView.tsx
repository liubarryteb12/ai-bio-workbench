import { useCallback, useEffect, useState } from 'react';
import type { SelfCheckResponse } from './shared/types';
import { fetchJson, httpStatusOf, errorMessage } from '../lib/fetchJson';

// ============================================================
// 视图3：服务端五维自检面板（Pre-flight Dashboard）
// ============================================================

export function PreFlightDashboard() {
  const [result, setResult] = useState<SelfCheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    try {
      const payload = await fetchJson<SelfCheckResponse>('/api/selfcheck');
      setResult({
        ...payload,
        // 契约漂移兜底：checks 缺失或不是数组时降级为空数组，
        // 否则下面的 map 抛 TypeError（历史白屏的直接来源）
        checks: Array.isArray(payload?.checks) ? payload.checks : [],
        all_pass: Boolean(payload?.all_pass),
      });
    } catch (cause) {
      setResult(null);
      setError(errorMessage(cause));
      setErrorStatus(httpStatusOf(cause));
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
  const checks = result?.checks ?? [];
  const hasFail = checks.some((c) => c?.status === 'fail');
  const hasWarn = checks.some((c) => c?.status === 'warn');

  return (
    <div className="view-container">
      <div className="card">
        <div className="card-head">
          <h2 className="card-title">服务端五维自检面板</h2>
          <button className="btn" onClick={() => void run()} disabled={loading}>
            {loading ? '检测中...' : '重新检测'}
          </button>
        </div>

        {error && (
          <div className="error-card" role="alert" data-testid="error-state" data-error-kind="selfcheck">
            <h3 className="error-card-title">检测失败</h3>
            <p className="error-text">{error}</p>
            <p className="hint">
              {errorStatus === 0
                ? '服务端没有响应，请确认工作台后端仍在运行后重试。'
                : '自检结果取不到时，本页不会显示任何"通过"结论；请重试或查看服务端日志。'}
            </p>
            <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={loading}>
              {loading ? '重试中...' : '重试'}
            </button>
          </div>
        )}

        {loading && !result && (
          <p className="hint" role="status" data-testid="loading-state" data-loading-kind="selfcheck">正在读取自检结果...</p>
        )}

        {!loading && !result && !error && (
          <p className="hint" data-testid="empty-state" data-empty-kind="selfcheck">尚未执行自检，点击"重新检测"开始。</p>
        )}

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
            {checks.map((item) => (
              <div key={item.id} className="selfcheck-light">
                <div className={`selfcheck-dot ${dotClass(item.status)}`}>{dotText(item.status)}</div>
                <div className="selfcheck-label">{item.label}</div>
                <div className="selfcheck-value">{item.value || ' - '}</div>
                <div className="selfcheck-detail">{item.detail}</div>
                {(item.sub_checks ?? []).length > 0 && (
                  <div className="selfcheck-subs">
                    {(item.sub_checks ?? []).map((sub) => (
                      <div key={sub.id} className="selfcheck-sub">
                        <span className={`selfcheck-sub-dot ${dotClass(sub.status)}`}>{dotText(sub.status)}</span>
                        <span className="selfcheck-sub-label">{sub.label}</span>
                        <span className="selfcheck-sub-value">{sub.value || ' - '}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!result && !error && !loading && (
          <p className="hint">点击"重新检测"重新收集本机与计算面的体检结果。</p>
        )}
      </div>
    </div>
  );
}