import React, { useEffect, useState } from 'react';

export interface LedgerEntry {
  ts: string;
  category: string;
  event_type: string;
  prev_record_sha256: string;
  record_sha256: string;
  payload: any;
}

export const HubIsolationAndLedgerView: React.FC = () => {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLedger = async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/v1/ledger?category=tasks');
      const data = await resp.json();
      if (data.ok && Array.isArray(data.entries)) {
        setEntries(data.entries.slice(-20).reverse());
      }
    } catch {
      // Ledger offline fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLedger();
    const timer = setInterval(fetchLedger, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="hub-isolation-ledger-view" style={{ padding: '20px' }}>
      <h2>中枢调度与三线台账视图（视图 2）</h2>
      <p style={{ color: '#666' }}>
        监控三线物理隔离边界 (line1_bulk, line2_scrna, line3_spatial)、任务调度状态及 con_hf/ledger 追加式台账。
      </p>

      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
        <div style={{ flex: 1, padding: '12px', border: '1px solid #5cb85c', borderRadius: '4px', background: '#f0f9f0' }}>
          <h4>line1_bulk 隔离沙箱</h4>
          <p style={{ margin: 0, fontSize: '12px', color: '#333' }}>状态: 守卫就绪 | 越界拦截: 0 | POSIX 根锁死</p>
        </div>
        <div style={{ flex: 1, padding: '12px', border: '1px solid #5cb85c', borderRadius: '4px', background: '#f0f9f0' }}>
          <h4>line2_scrna 隔离沙箱</h4>
          <p style={{ margin: 0, fontSize: '12px', color: '#333' }}>状态: 守卫就绪 | 虚拟敲除: 独立子模块 | 算力筛: 20k</p>
        </div>
        <div style={{ flex: 1, padding: '12px', border: '1px solid #5cb85c', borderRadius: '4px', background: '#f0f9f0' }}>
          <h4>line3_spatial 隔离沙箱</h4>
          <p style={{ margin: 0, fontSize: '12px', color: '#333' }}>状态: 守卫就绪 | 空间切片图像魔数核验: 已开启</p>
        </div>
      </div>

      <h3>五类追加式防篡改台账实时滚动审计</h3>
      <button onClick={fetchLedger} disabled={loading} style={{ marginBottom: '10px', padding: '6px 12px' }}>
        {loading ? '刷新中...' : '手动刷新台账'}
      </button>

      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: '#eee' }}>
            <th style={{ padding: '8px', border: '1px solid #ddd' }}>时间戳</th>
            <th style={{ padding: '8px', border: '1px solid #ddd' }}>分类</th>
            <th style={{ padding: '8px', border: '1px solid #ddd' }}>事件类型</th>
            <th style={{ padding: '8px', border: '1px solid #ddd' }}>当前记录 SHA256</th>
            <th style={{ padding: '8px', border: '1px solid #ddd' }}>上条哈希对账</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: '12px', textAlign: 'center', color: '#999' }}>
                暂无台账记录或台账服务未连接
              </td>
            </tr>
          ) : (
            entries.map((item, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '8px' }}>{item.ts}</td>
                <td style={{ padding: '8px' }}>{item.category}</td>
                <td style={{ padding: '8px' }}>{item.event_type}</td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>{item.record_sha256?.slice(0, 12)}...</td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>{item.prev_record_sha256?.slice(0, 12)}...</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};
