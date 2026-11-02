/**
 * 测试临时区统一入口（5.11 修复，2026-11-01）。
 *
 * 背景（README 第 1 条 / 第三十二轮）：外部 TEMP 首跑会让 wrapper_* 等真跑类测试
 * 成片假红（8.3 短路径、跨盘符软链、目录不可写）。靠文档纪律不如代码自省：
 * 优先 BIO_TEST_TMP，其次工作区 .tmp（可写即选），最后 os.tmpdir() 兜底；
 * 返回值过 realpathSync 归一，杜绝短路径与软链漂移。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function writableDir(candidate) {
  if (!candidate) return null;
  try {
    fs.mkdirSync(candidate, { recursive: true });
    const probe = fs.mkdtempSync(path.join(candidate, 'bio-probe-'));
    fs.rmSync(probe, { recursive: true, force: true });
    return fs.realpathSync(candidate);
  } catch {
    return null;
  }
}

export const TEST_TMP =
  writableDir(process.env.BIO_TEST_TMP)
  || writableDir(path.resolve(process.cwd(), '.tmp'))
  || writableDir(path.resolve(process.cwd(), '..', '.tmp'))
  || writableDir(os.tmpdir())
  || fs.realpathSync(os.tmpdir());