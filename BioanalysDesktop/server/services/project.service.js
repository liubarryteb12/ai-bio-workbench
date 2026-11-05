/**
 * project.service.js —— 项目域业务逻辑（第 43 轮 Q2，从 projects.routes.js 剥离）。
 *
 * 设计原则（抄 Fastify 的 service 分层）：本模块只做业务，**不碰 req/res**。
 * 输入是已校验的参数，输出是 { status, payload } 的领域结果，
 * HTTP 状态码映射由路由层负责。这样 service 可被单测直接调用，无需伪造请求对象。
 */

import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_PROJECT } from '../domain.js';
import { LINE_STEPS, PIPELINE_STEP_META, buildReadProjectMetaCommand, parseProjectMeta } from '../project.js';
import { describeSeries, loadWorkflows, validateRegistry } from '../workflow_graph.js';

/**
 * 读本地项目元数据（local_projects/<id>/project.json）。
 *
 * T3-5：meta 接口历史上只读远端 K40 的 project.json，而默认项目 default 在本机
 * local_projects/default/project.json 是有内容的。远端没有该文件时接口直接 404，
 * 前端因此永远拿不到出图配置。回落只读本地这一个确定位置，不猜路径、不越界。
 */
export function readLocalProjectMeta(repoRoot, projectId) {
  if (!repoRoot) return null;
  const file = path.join(repoRoot, 'local_projects', projectId, 'project.json');
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/* ─────────────── 母版步骤清单（兼容旧前端的母版名视图） ─────────────── */
export function getProjectSteps() {
  return { status: 200, payload: { steps: LINE_STEPS, meta: PIPELINE_STEP_META } };
}

/* ─────────────── mod 注册表本体（单一事实源 src/workflows.json） ─────────────── */
export function getWorkflows() {
  const wf = loadWorkflows();
  const check = validateRegistry();
  return {
    status: 200,
    payload: {
      // 客户端一次拿全：系列清单 + 每条线的阶段与 mod + 全局约束
      series: wf.series.map((s) => describeSeries(s.id)),
      constraints: wf.constraints,
      // 注册表自洽状态一并下发：坏了客户端能看到，而不是静默拿到半份图
      registry_ok: check.ok,
      registry_errors: check.errors,
    },
  };
}

/* ─────────────── 项目元数据（远端优先、本地兜底） ─────────────── */
export function getProjectMeta(projectId, { runRemote, repoRoot }) {
  let meta = null;
  try {
    const encoded = runRemote(buildReadProjectMetaCommand(projectId));
    if (encoded.trim()) {
      meta = parseProjectMeta(Buffer.from(encoded.trim(), 'base64').toString('utf8'));
    }
  } catch (cause) {
    return {
      status: 500,
      payload: { error: `读取 project.json 失败: ${cause instanceof Error ? cause.message : String(cause)}` },
    };
  }
  // T3-5：远端读不到时回落本地。顺序刻意是「远端优先、本地兜底」：
  // 远端才是算力面真源，本地只是没同步时的可读副本。
  if (!meta) meta = readLocalProjectMeta(repoRoot, projectId);
  if (!meta) {
    return { status: 404, payload: { error: `项目 ${projectId} 不存在或缺少 project.json` } };
  }
  return {
    status: 200,
    payload: {
      projectId,
      // 只回出图相关与解读需要的字段，避免把整份 meta（含备注原文）透给只读视图
      plotLayoutConfig: meta.plot_layout_config || null,
      analysisCutoffs: meta.analysis_cutoffs || null,
      dataSourceMode: meta.data_source?.data_source_mode || 'PUBLIC_DB',
      focusGenes: meta.biological_priors?.focus_genes || [],
      targetKoGene: meta.biological_priors?.target_ko_gene || '',
      stepCount: Array.isArray(meta.pipeline_dag) ? meta.pipeline_dag.length : 0,
      // T3-8：首屏要判断「这个项目到底配了什么」，光有出图配置不够。
      // 缺字段一律给 null/[]，不编默认值：默认值会让「没配」和「配了空」不可区分。
      projectName: meta.name || null,
      schemaVersion: meta.schema_version ?? null,
      datasets: Array.isArray(meta.data_source?.datasets) ? meta.data_source.datasets : [],
      groupingDesign: meta.grouping_design || null,
    },
  };
}

/* ─────────────── 项目列表 ─────────────── */
export function listProjects({ listProjectsWithMeta }) {
  try {
    const projects = listProjectsWithMeta();
    return { status: 200, payload: { defaultProject: DEFAULT_PROJECT, projects } };
  } catch (cause) {
    return {
      status: 500,
      payload: {
        error: cause instanceof Error ? cause.message : String(cause),
        hint: '读项目列表失败；链路不通时先跑 /api/link/check',
      },
    };
  }
}