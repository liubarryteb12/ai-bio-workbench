/**
 * 单任务轻量持久化队列 (BioanalysDesktop/server/services/queue.service.js)
 *
 * 核心设计：
 * 1. 严格单任务串行调度 (maxConcurrent: 1)，物理保护 8GB ARM 设备内存不被并发压垮；
 * 2. 状态落盘在 .ops_state/task_queue.json，服务重启任务不丢；
 * 3. 自动拉起 tools/dev/work_order_orchestrator.mjs 启动 ADB 算力通道。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const QUEUE_FILE = path.resolve(REPO_ROOT, '.ops_state', 'task_queue.json');

class TaskQueue {
  constructor() {
    this.queue = [];
    this.activeTask = null;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(QUEUE_FILE)) {
        this.queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
        // 重启后如果之前的任务被中断，重置为 queued 待重试
        this.queue.forEach((item) => {
          if (item.status === 'running') {
            item.status = 'queued';
            item.interruptedAt = new Date().toISOString();
          }
        });
      }
    } catch {
      this.queue = [];
    }
  }

  _persist() {
    fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(this.queue, null, 2), 'utf8');
  }

  enqueue(orderId, meta = {}) {
    const existing = this.queue.find((t) => t.orderId === orderId);
    if (existing) return existing;

    const entry = {
      orderId,
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      meta,
    };
    this.queue.push(entry);
    this._persist();
    this.processNext();
    return entry;
  }

  getQueue(projectId = null) {
    if (!projectId) return this.queue;
    return this.queue.filter((t) => t.meta?.project_id === projectId);
  }

  updateStatus(orderId, status, extra = {}) {
    const item = this.queue.find((t) => t.orderId === orderId);
    if (item) {
      item.status = status;
      Object.assign(item, extra);
      this._persist();
    }
  }

  processNext() {
    if (this.activeTask) return; // 单任务保护
    const next = this.queue.find((t) => t.status === 'queued');
    if (!next) return;

    this.activeTask = next;
    next.status = 'running';
    next.startedAt = new Date().toISOString();
    this._persist();

    const orchestratorScript = path.resolve(REPO_ROOT, 'tools', 'dev', 'work_order_orchestrator.mjs');
    const workOrderPath = path.resolve(REPO_ROOT, 'workspace', 'projects', next.meta?.project_id || '', 'work_orders', `${next.orderId}.json`);

    const child = spawn('node', [orchestratorScript, '--work-order', workOrderPath], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const runLogPath = path.resolve(REPO_ROOT, '.ops_state', `orchestrator_${next.orderId}.log`);
    const logStream = fs.createWriteStream(runLogPath, { flags: 'a' });
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    child.on('exit', (code) => {
      next.finishedAt = new Date().toISOString();
      next.exitCode = code;
      next.status = code === 0 ? 'completed' : 'failed';
      this._persist();
      this.activeTask = null;
      this.processNext(); // 推进下一个排队工单
    });
  }
}

export const taskQueue = new TaskQueue();
