import React, { useState } from 'react';

export interface RequirementFormState {
  disease_or_trait: string;
  isolation_line: 'line1_bulk' | 'line2_scrna' | 'line3_spatial';
  species: 'Homo_sapiens' | 'Mus_musculus' | 'Rattus_norvegicus';
  target_genes: string;
  control_samples: string;
  treatment_samples: string;
  utm_source: string;
  tier: 'PRO_URGENT' | 'STANDARD' | 'TRIAL';
}

export const PortalIntakeAndDeliveryView: React.FC = () => {
  const [form, setForm] = useState<RequirementFormState>({
    disease_or_trait: 'Lung_Adenocarcinoma',
    isolation_line: 'line1_bulk',
    species: 'Homo_sapiens',
    target_genes: 'TP53, EGFR, KRAS',
    control_samples: 'CTRL_1, CTRL_2, CTRL_3',
    treatment_samples: 'TREAT_1, TREAT_2, TREAT_3',
    utm_source: 'academic_outreach',
    tier: 'STANDARD',
  });

  const [ticketId, setTicketId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);

    const ctrlArr = form.control_samples.split(',').map((s) => s.trim()).filter(Boolean);
    const treatArr = form.treatment_samples.split(',').map((s) => s.trim()).filter(Boolean);

    if (form.isolation_line === 'line1_bulk' && (ctrlArr.length < 3 || treatArr.length < 3)) {
      setErrorMsg('Role 0 门禁拦截: Bulk 差异分析要求对照组与处理组重复数均 >= 3');
      setSubmitting(false);
      return;
    }

    const payload = {
      req_id: `REQ-${Date.now()}`,
      created_at: new Date().toISOString(),
      mode: 'MODE_B_CUSTOM_MATRIX',
      isolation_line: form.isolation_line,
      species: form.species,
      project_metadata: {
        disease_or_trait: form.disease_or_trait,
        target_genes: form.target_genes.split(',').map((g) => g.trim()).filter(Boolean),
        sample_groups: {
          control_samples: ctrlArr,
          treatment_samples: treatArr,
        },
      },
      _attribution: {
        utm_source: form.utm_source,
        partner_id: 'default_partner',
        tier: form.tier,
      },
    };

    try {
      const resp = await fetch('/api/v1/requirements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        setTicketId(data.req_id);
      } else {
        setErrorMsg(data.error || '提交失败');
      }
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="portal-intake-delivery-view" style={{ padding: '20px' }}>
      <h2>科研门户与需求提交（视图 1）</h2>
      <p style={{ color: '#666' }}>
        基于 requirement.schema.json 驱动的前端动态表单，外包团队与科研用户提交需求入口。
      </p>

      {errorMsg && (
        <div style={{ color: '#d9534f', background: '#fdf7f7', padding: '10px', borderRadius: '4px', marginBottom: '15px' }}>
          {errorMsg}
        </div>
      )}

      {ticketId && (
        <div style={{ color: '#5cb85c', background: '#f0f9f0', padding: '10px', borderRadius: '4px', marginBottom: '15px' }}>
          需求提交成功！任务单号: <strong>{ticketId}</strong>，可在右侧成果区查看交付四大件。
        </div>
      )}

      <div style={{ display: 'flex', gap: '24px' }}>
        <form onSubmit={handleSubmit} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label>
            疾病或表型名称:
            <input
              type="text"
              value={form.disease_or_trait}
              onChange={(e) => setForm({ ...form, disease_or_trait: e.target.value })}
              required
              style={{ width: '100%', padding: '6px' }}
            />
          </label>

          <label>
            分析产线:
            <select
              value={form.isolation_line}
              onChange={(e) => setForm({ ...form, isolation_line: e.target.value as any })}
              style={{ width: '100%', padding: '6px' }}
            >
              <option value="line1_bulk">line1_bulk (转录组差异与功能)</option>
              <option value="line2_scrna">line2_scrna (单细胞质控降维与敲除)</option>
              <option value="line3_spatial">line3_spatial (空间转录组分析)</option>
            </select>
          </label>

          <label>
            物种:
            <select
              value={form.species}
              onChange={(e) => setForm({ ...form, species: e.target.value as any })}
              style={{ width: '100%', padding: '6px' }}
            >
              <option value="Homo_sapiens">Homo sapiens (人)</option>
              <option value="Mus_musculus">Mus musculus (小鼠)</option>
              <option value="Rattus_norvegicus">Rattus norvegicus (大鼠)</option>
            </select>
          </label>

          <label>
            目标基因列表 (逗号分隔):
            <input
              type="text"
              value={form.target_genes}
              onChange={(e) => setForm({ ...form, target_genes: e.target.value })}
              style={{ width: '100%', padding: '6px' }}
            />
          </label>

          <label>
            对照组样本 (逗号分隔，要求 n &gt;= 3):
            <input
              type="text"
              value={form.control_samples}
              onChange={(e) => setForm({ ...form, control_samples: e.target.value })}
              required
              style={{ width: '100%', padding: '6px' }}
            />
          </label>

          <label>
            处理组样本 (逗号分隔，要求 n &gt;= 3):
            <input
              type="text"
              value={form.treatment_samples}
              onChange={(e) => setForm({ ...form, treatment_samples: e.target.value })}
              required
              style={{ width: '100%', padding: '6px' }}
            />
          </label>

          <label>
            算力优先级队列:
            <select
              value={form.tier}
              onChange={(e) => setForm({ ...form, tier: e.target.value as any })}
              style={{ width: '100%', padding: '6px' }}
            >
              <option value="PRO_URGENT">PRO_URGENT (高优先级算力插队)</option>
              <option value="STANDARD">STANDARD (标准算力队列)</option>
              <option value="TRIAL">TRIAL (试用试跑队列)</option>
            </select>
          </label>

          <button type="submit" disabled={submitting} style={{ padding: '10px', background: '#0275d8', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            {submitting ? '提交并由 Role 0 门禁校验中...' : '提交生信分析需求'}
          </button>
        </form>

        <div style={{ flex: 1, border: '1px solid #ddd', borderRadius: '6px', padding: '16px', background: '#fafafa' }}>
          <h3>交付四大件成果区 (Deliverables)</h3>
          <ul>
            <li><strong>01_Executive_Bio_Report.pdf</strong>: AI 独立终验报告，含统计学摘要与方法学</li>
            <li><strong>02_Publication_Ready_Figures</strong>: 期刊级高清图表包 (通过 PNG IEND 魔数核验)</li>
            <li><strong>03_Processed_Tables</strong>: 全量统计结果表 (差异表达与富集 TSV)</li>
            <li><strong>04_Reproducibility_Capsule.zip</strong>: 学术复现胶囊 (参数锁死、环境签名快照与哈希账本)</li>
          </ul>
          {ticketId && (
            <a
              href={`/api/v1/deliverables/${ticketId}/download`}
              style={{ display: 'inline-block', marginTop: '12px', padding: '8px 16px', background: '#5cb85c', color: '#fff', textDecoration: 'none', borderRadius: '4px' }}
            >
              一键下载完整交付包与复现胶囊
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
