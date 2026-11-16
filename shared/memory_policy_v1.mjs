/**
 * memory_policy/v1：受限运行面的三级内存水位（Gemini Argon 判决，2026-11-15）。
 *
 * 修正「容器 7.5GB / 单任务 8.0GB」的参数倒挂：
 *   物理设备 12GB → 容器硬上限 7.5GB → 单任务硬上限 6.5GB。
 * 单细胞/空间模块的并行 worker 不得超过 2，为堆内存与 fork 预留缓冲。
 */

export const DEVICE_MEMORY_GB = 12;
export const CONTAINER_MEMORY_GB = 7.5;
export const TASK_MEMORY_GB = 6.5;
export const MAX_PARALLEL_WORKERS = 2;

/**
 * 校验一组内存预算是否满足严格递减与 worker 上限。
 * 返回 { ok, errors[] }。
 */
export function validateMemoryBudget({ deviceGb, containerGb, taskGb, workers } = {}) {
  const errors = [];
  const device = Number(deviceGb);
  const container = Number(containerGb);
  const task = Number(taskGb);
  const workerCount = Number(workers);

  if (!Number.isFinite(device) || device !== DEVICE_MEMORY_GB) {
    errors.push(`deviceGb 必须为 ${DEVICE_MEMORY_GB}（当前 ${deviceGb}）`);
  }
  if (!Number.isFinite(container) || container !== CONTAINER_MEMORY_GB) {
    errors.push(`containerGb 必须为 ${CONTAINER_MEMORY_GB}（当前 ${containerGb}）`);
  }
  if (!Number.isFinite(task) || task !== TASK_MEMORY_GB) {
    errors.push(`taskGb 必须为 ${TASK_MEMORY_GB}（当前 ${taskGb}）`);
  }
  if (Number.isFinite(device) && Number.isFinite(container) && Number.isFinite(task)) {
    if (!(task < container && container < device)) {
      errors.push(`内存水位必须严格递减：task(${task}) < container(${container}) < device(${device})`);
    }
  }
  if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > MAX_PARALLEL_WORKERS) {
    errors.push(`workers 必须是 1 到 ${MAX_PARALLEL_WORKERS} 的整数（当前 ${workers}）`);
  }
  return { ok: errors.length === 0, errors };
}
