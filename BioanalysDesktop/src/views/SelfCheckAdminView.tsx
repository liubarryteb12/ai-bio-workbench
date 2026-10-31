import { useCallback, useEffect, useState } from 'react';
import type { SelfCheckResponse } from './shared/types';

// ============================================================
// 视图3：服务端五维自检面板（Pre-flight Dashboard）
// ============================================================

export function PreFlightDashboard() {
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
          <p className="hint">点击"重新检测"调用 GET /api/selfcheck。</p>
        )}
      </div>
    </div>
  );
}
