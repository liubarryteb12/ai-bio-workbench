/**
 * 报告脱敏契约（2026-11-06 用户明确要求）。
 *
 * 用户原话：「以后出报告不允许出现这些字眼（类似的也不允许，这是属于透露机器信息和
 * 商业机密的行为，立马整改重新导出报告）」，并点名了这一句：
 *   「本报告由 ops/ 下的抽取与渲染脚本自动生成，所有统计量取自 K40 真机产物，无手写数字。」
 *
 * 因此对「交付给客户/外部」的报告正文，禁止出现：
 *   - 机器名与硬件标识（K40 等）
 *   - 运行环境（Termux / proot / aarch64 / dropbear / adb / ssh / bio-py）
 *   - 主机绝对路径（/mnt/... /root/... /data/data/...）
 *   - 内部脚本目录（ops/）
 *   - 暗示「真机」「服务器」等设施用语
 *
 * 判据作用在**报告正文**上：扫描时先剥离 base64 图片载荷，否则 base64 里的
 * 随机字符会误命中（实测 'adb' 在图片数据里能命中几十次）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 禁止出现在报告正文里的字样（含同义设施用语）。 */
const FORBIDDEN = [
  "K40", "k40",
  "Termux", "termux", "proot", "PRoot", "aarch64", "dropbear",
  "/mnt/ssd", "/mnt/", "/root/", "/data/data",
  "真机", "ops/", "adb", "ssh", "bio-py", "nice -n",
];

/** 去掉 base64 图片载荷后的正文。 */
function textOf(html) {
  return html.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, "DATA_URI");
}

function reportFiles() {
  const base = path.join(REPO, "local_projects");
  const out = [];
  if (!fs.existsSync(base)) return out;
  for (const proj of fs.readdirSync(base)) {
    const dir = path.join(base, proj, "report");
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".html")) out.push(path.join(dir, f));
    }
  }
  return out;
}

test("已导出的报告正文不得出现机器信息与内部路径", () => {
  const files = reportFiles();
  assert.ok(files.length >= 2, "至少应有两份已导出报告，实际 " + files.length);
  const offenders = [];
  for (const f of files) {
    const text = textOf(fs.readFileSync(f, "utf8"));
    for (const token of FORBIDDEN) {
      if (text.includes(token)) {
        const i = text.indexOf(token);
        offenders.push(path.basename(path.dirname(path.dirname(f))) + " / "
          + token + " @ ..." + text.slice(Math.max(0, i - 40), i + 40).replace(/\n/g, " ") + "...");
      }
    }
  }
  assert.deepEqual(offenders, [], "报告正文含禁止字样：" + offenders.join(" ｜ "));
});

test("报告渲染器不得再写入机器信息与内部路径", () => {
  const renderer = fs.readFileSync(path.join(REPO, "ops/report_render_html.py"), "utf8");
  // 只检查会被写进 HTML 的字符串字面量：整份源码里的中文注释提到这些词不算违规，
  // 但 footer 这类直接进报告的段落必须干净。
  const footer = renderer.match(/parts\.append\("<footer>[\s\S]{0,600}?<\/footer>"\)/);
  assert.ok(footer, "渲染器必须有 footer 段落");
  for (const token of FORBIDDEN) {
    assert.equal(footer[0].includes(token), false,
      "footer 含禁止字样 " + token + "，会直接进交付报告");
  }
});

test("脱敏判据本身要能抓住旧文案（负对照）", () => {
  const oldFooter = "本报告由 ops/ 下的抽取与渲染脚本自动生成，所有统计量取自 K40 真机产物，"
    + "无手写数字。图件与中间表原始位置：/mnt/ssd/bio_data/projects/X/line3_spatial/";
  const hits = FORBIDDEN.filter((t) => oldFooter.includes(t));
  assert.ok(hits.length >= 4,
    "负对照失败：旧文案应至少命中 4 个禁止词，实际 " + hits.length);
  assert.ok(hits.includes("K40") && hits.includes("ops/") && hits.includes("/mnt/ssd")
    && hits.includes("真机"), "旧文案的四个关键违规点必须都能被识别");
});
