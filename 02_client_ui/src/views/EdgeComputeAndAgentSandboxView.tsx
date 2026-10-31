import React, { useEffect, useState } from 'react';

export interface TelemetryData {
  node_id: string;
  battery_temp_c: number;
  mem_available_mb: number;
  thermal_state: 'NORMAL' | 'THROTTLED_PAUSED' | 'RESUMED_ACTIVE';
  throttle_count: number;
  active_jobs_count: number;
}

export const EdgeComputeAndAgentSandboxView: React.FC = () => {
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    node_id: 'k40-ubuntu-node01',
    battery_temp_c: 38.2,
    mem_available_mb: 4250.0,
    thermal_state: 'NORMAL',
    throttle_count: 0,
    active_jobs_count: 1,
  });

  const [loading, setLoading] = useState(false);

  const fetchTelemetry = async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/pi-agent/overview');
      const data = await resp.json();
      if (data.ok && data.telemetry) {
        setTelemetry({
          node_id: data.telemetry.node_id || 'k40-ubuntu-node01',
          battery_temp_c: data.telemetry.battery_temp_c ?? 38.0,
          mem_available_mb: data.telemetry.mem_available_mb ?? 4000.0,
          thermal_state: data.telemetry.thermal_state || 'NORMAL',
          throttle_count: data.telemetry.throttle_count ?? 0,
          active_jobs_count: data.telemetry.active_jobs_count ?? 0,
        });
      }
    } catch {
      // Telemetry offline fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const timer = setInterval(fetchTelemetry, 10000);
    return () => clearInterval(timer);
  }, []);

  const isHot = telemetry.battery_temp_c >= 43.0;

  return (
    <div className="edge-compute-sandbox-view" style={{ padding: '20px' }}>
      <h2>K40 边缘算力与 Agent 决策沙盒（视图 3）</h2>
      <p style={{ color: '#666' }}>
        监控 Redmi K40 (骁龙 870, ARM64) 硬件健康指标与 Role 1~Role 4 智能体决策流。
      </p>

      <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
        <div style={{ flex: 1, border: '1px solid #ddd', borderRadius: '6px', padding: '16px', background: isHot ? '#fff3cd' : '#f8f9fa' }}>
          <h3>Redmi K40 硬件遥测卡片</h3>
          <p><strong>计算节点:</strong> {telemetry.node_id} (ARM64 Ubuntu chroot)</p>
          <p>
            <strong>电池温度:</strong>{' '}
            <span style={{ color: isHot ? '#d9534f' : '#5cb85c', fontWeight: 'bold' }}>
              {telemetry.battery_temp_c.toFixed(1)}°C
            </span>{' '}
            (43.0°C 热熔断挂起阈值 / 39.0°C 自动恢复)
          </p>
          <p><strong>可用内存 (RAM):</strong> {(telemetry.mem_available_mb / 1024).toFixed(2)} GB / 8.0 GB</p>
          <p><strong>热状态:</strong> <code>{telemetry.thermal_state}</code> (累计热熔断次数: {telemetry.throttle_count})</p>
          <p><strong>当前运行任务:</strong> {telemetry.active_jobs_count} 个 (上限: 2)</p>
          <button onClick={fetchTelemetry} disabled={loading} style={{ padding: '4px 8px' }}>
            {loading ? '刷新中...' : '刷新遥测'}
          </button>
        </div>

        <div style={{ flex: 1, border: '1px solid #ddd', borderRadius: '6px', padding: '16px', background: '#f8f9fa' }}>
          <h3>AI 决策透明沙盒 (Role 1 ➔ Role 4)</h3>
          <ul>
            <li><strong>前置算力筛:</strong> 单细胞 &gt; 20,000 细胞自动插入 geosketch 降采样至 15,000</li>
            <li><strong>确定性锁定:</strong> 全局随机种子锁死 <code>seed=20261013</code>，线程锁死 3</li>
            <li><strong>故障自愈环:</strong> OOM (Exit 137) 自动降变异基因至 1500 并开启 backed 模式 (上限 2 次自愈)</li>
            <li><strong>两阶段终验:</strong> 机器魔数 + 0~100 分生物学评分卡 (75 分放行)</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
