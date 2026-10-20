/**
 * 任务下发：把一次步骤执行变成"可下发命令 + 可归档台账"
 *
 * 两条铁律在这里收口：
 *   1. 命令只触及本线，含其他线 line_id 的一律不出这道门（audit.js 是兜底，这里是构造时就保证）；
 *   2. 台账必须能被 ledger.js 自己判合法，否则写出去的账自己就违规，成了讽刺。
 */

import { randomUUID } from 'node:crypto';
import { LINES, DEFAULT_PROJECT, projectLineDir, binDir, sanitizeProjectId } from './domain.js';

/**
 * 项目元数据文件路径。任务脚本要把 project.json 的位置告诉出图模板外挂，
 * 它才能读到客户选的 plot_layout_config。
 */
function projectMetaPath(projectId) {
  const id = sanitizeProjectId(projectId) || DEFAULT_PROJECT;
  return `/mnt/ssd/bio_data/projects/${id}/project.json`;
}

/** 单引号转义成 '\''，保证远端 shell 不把命令拆断 */
function shellQuote(text) {
  return `'${String(text).replace(/'/g, String.raw`'\''`)}'`;
}

/**
 * 生成远端执行脚本。
 *
 * 工作目录固定在该项目该线的 processed/（项目隔离，命令不会跑到别的项目去）。
 * PATH 里注入本线的全局 bin/：步骤脚本由部署通道（ops/06_deploy_scripts.ps1）从本地
 * src/<line>/scripts/ 落到服务器 bin/<line>/ 并置可执行位，step 名即可执行文件名。
 * bin 全局一份，所有项目共用（代码本体不随项目复制）。
 * 没有这一行，服务器上找不到命令，一切 step 都是 command not found。
 *
 * @param {{projectId?: string, lineId: string, step: string, inputs: string[], outputs: string[], seed?: number, throttled?: boolean}} task
 * @returns {string}
 */
export function buildTaskScript(task) {
  const { projectId = DEFAULT_PROJECT, lineId, step, inputs = [], outputs = [], seed, throttled = false } = task;
  if (!LINES.includes(lineId)) {
    throw new Error(`line_id 非法: ${lineId}`);
  }

  const lineDir = projectLineDir(projectId, lineId);
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `cd ${lineDir}/processed`,
    `SEED=${Number(seed) || 0}`,
  ];

  if (seed !== undefined && seed !== null) {
    // 写进环境而不是塞进命令行，是为了让 R/Python 侧读取方式统一
    lines.push('export BIOANALYS_SEED="$SEED"');
  }

  // R 端还需要一个 Rscript 垫片：母版 R 脚本统一写 `Rscript --vanilla`，
  // 而 --vanilla 会跳过 R_PROFILE_USER，模板挂载会静默失效（踩坑 #169）。
  // 垫片把 --vanilla 降级为等价组合并保留 user profile，必须排在 PATH 最前。
  lines.push('export PATH="/mnt/ssd/bio_data/ops/layout_autoload/bin:${PATH}"');
  lines.push(`export PATH="${binDir(lineId)}:$PATH"`);

  // 出图模板注入：客户在需求单选的 plot_layout_config 必须真的生效。
  // 母版脚本按"绝对只读"不能改，所以把模板应用做成解释器启动时的外挂：
  //   Python → PYTHONPATH 里有 layout_autoload/，sitecustomize 自动加载
  //   R      → R_PROFILE_USER 指向 layout_autoload/Rprofile
  // 两者都只在 BIOANALYS_PROJECT_JSON 存在时介入，非出图步骤零影响。
  lines.push(`export BIOANALYS_PROJECT_JSON="${projectMetaPath(projectId)}"`);
  lines.push('export BIOANALYS_LAYOUT_LIB="/mnt/ssd/bio_data/bin"');
  lines.push('export PYTHONPATH="/mnt/ssd/bio_data/ops/layout_autoload:${PYTHONPATH:-}"');
  lines.push('export R_PROFILE_USER="/mnt/ssd/bio_data/ops/layout_autoload/Rprofile"');

  // inputs/outputs 必须是数组；调用方传了裸字符串时归一化为空数组而不是抛 TypeError
  // （TypeError 会顺着事件回调打死整个 Node 进程，2026-10-19 实测踩到）。
  const inputList = Array.isArray(inputs) ? inputs : [];
  const outputList = Array.isArray(outputs) ? outputs : [];
  const inputArgs = inputList.map((path) => `--input ${shellQuote(path)}`).join(' ');
  const outputArgs = outputList.map((path) => `--output ${shellQuote(path)}`).join(' ');
  const seedArgs = seed === undefined || seed === null ? '' : `--seed ${Number(seed)}`;

  // 构建原始 step 命令
  const rawCmd = [
    shellQuote(step),
    inputArgs,
    outputArgs,
    seedArgs,
  ].filter(Boolean).join(' ');

  if (throttled) {
    // 通过 ops/run_throttled_task.sh 包装：默认不绑核（EAS 动态调度，2026-10-20 契约变更，实测更快）+ nice/ionice 降权 + 门禁 + 台账 JSON
    const taskId = `task_$(date +%s)_${Math.random().toString(36).slice(2, 8)}`;
    lines.push(
      `bash /mnt/ssd/bio_data/ops/run_throttled_task.sh ${taskId} ${lineId} ${shellQuote(step)} self ${rawCmd}`
    );
  } else {
    lines.push(rawCmd);
  }

  return lines.join('\n');
}

/**
 * 构造一条任务台账 JSON（字段见 docs/ledger-schema.md）。
 *
 * environment 四字段由调用方从 src/<line>/envs/manifest.txt 读后传入（manifest.js），
 * 这里的默认值只是 manifest 缺失时的退化路径，正常台账不写死。
 *
 * @param {object} params
 * @returns {object} 台账对象
 */
export function buildLedgerEntry(params) {
  const {
    projectId = DEFAULT_PROJECT,
    lineId,
    step,
    seed,
    inputs = [],
    outputs = [],
    status,
    checkpointStatus = 'skipped',
    exitCode,
    errorLog = null,
    startedAt,
    endedAt,
    language = 'R',
    version = '4.3.3',
    envName = `${lineId}_env`,
    containerImage = 'proot-ubuntu24.04-aarch64',
  } = params;

  if (!LINES.includes(lineId)) {
    throw new Error(`line_id 非法: ${lineId}`);
  }
  if (!sanitizeProjectId(projectId)) {
    throw new Error(`project_id 非法: ${projectId}`);
  }
  if (status === 'failed' && !errorLog) {
    // 失败的账不带 error_log 等于白记，这里直接拒绝而不是放它出去
    throw new Error('status=failed 必须提供 errorLog');
  }

  return {
    task_id: randomUUID(),
    project_id: projectId,
    line_id: lineId,
    step_name: step,
    status,
    start_time: startedAt || new Date().toISOString(),
    end_time: endedAt || new Date().toISOString(),
    environment: {
      language,
      version,
      env_name: envName,
      container_image: containerImage,
      random_seed: seed ?? null,
    },
    resource_usage: {
      max_cpu_percent: null,
      max_memory_gb: null,
      disk_io_peak_mb_s: null,
    },
    io_files: {
      input: inputs,
      output: outputs,
    },
    checkpoint_status: checkpointStatus,
    error_log: errorLog,
    exit_code: exitCode ?? null,
    next_action_suggested: null,
  };
}
