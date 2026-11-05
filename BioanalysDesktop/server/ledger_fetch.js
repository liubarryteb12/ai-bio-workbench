import { SYSTEM_LOGS } from "./domain.js";
import { runRemote } from "./remote_exec.js";
import { shellQuote } from "./proc.js";
import { posix as pathPosix } from "node:path";

/**
 * 拉取远端台账。
 *
 * logsDir 来自 URL 参数（diagnostics.routes.js 的 /api/ledger/check），
 * 拼接必须过 shellQuote，否则引号闭合权交给调用方（第三十二轮 T0-4 余震实测）。
 *
 * 为什么是单次往返（真机缺陷）：旧实现先 ls 一次，再对每个 .json 文件
 * 单独发一次 base64 -w0，N 个文件 = N+1 次 SSH 往返。台账涨到几十个文件后
 * /api/ledger/check 实测 30 秒仍超时（每个文件各自 40 秒上限叠加）。
 * 现在远端用一条 for 循环把所有文件编码成「文件名<TAB>内容」逐行输出，
 * 本地一次 ssh 拿全量再解析，往返次数恒为 1。
 */
export async function fetchLedgerFromServer(logsDir = SYSTEM_LOGS) {
  const dir = shellQuote(logsDir);
  // 每行格式 <文件名base64><TAB><内容base64>；文件名也编码避免 TAB/换行歧义
  const remoteScript = [
    "for f in " + dir + "/*.json; do",
    "  [ -f \"$f\" ] || continue",
    "  n=$(printf '%s' \"$(basename \"$f\")\" | base64 -w0)",
    "  b=$(base64 -w0 \"$f\" 2>/dev/null || true)",
    "  printf '%s\\t%s\\n' \"$n\" \"$b\"",
    "done",
  ].join("; ");
  const batch = runRemote(remoteScript);
  const entries = [];
  for (const line of batch.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tab = trimmed.indexOf("\t");
    if (tab < 0) continue;
    const nameEncoded = trimmed.slice(0, tab);
    const bodyEncoded = trimmed.slice(tab + 1);
    if (!bodyEncoded) continue;
    let fileName;
    let text;
    try {
      fileName = Buffer.from(nameEncoded, "base64").toString("utf8");
      text = Buffer.from(bodyEncoded, "base64").toString("utf8");
    } catch { continue; }
    if (!fileName.endsWith(".json")) continue;
    try {
      entries.push({
        file: fileName,
        path: pathPosix.join(logsDir, fileName),
        data: JSON.parse(text),
      });
    } catch {
      // 单个台账文件损坏：跳过它而不是让整个巡检 500（保持旧行为兼容）
      continue;
    }
  }
  return { names: entries.map((entry) => entry.file), entries };
}