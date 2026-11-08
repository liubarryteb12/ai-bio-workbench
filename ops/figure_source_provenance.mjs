#!/usr/bin/env node
/**
 * figure_source_provenance.mjs —— 出图代码与参考库的溯源诚实性门禁（生信代码专项审核）。
 *
 * 审核发现的核心问题：注册表 tools/bio/figure_templates.json 里 30 条 ready 模板都登记了
 * source 指向 reference/05.可参考出图代码，但真实出图脚本一处都没引用参考库。
 * 也就是说「溯源」目前只是元数据关系，不是代码的派生关系。
 *
 * 本门禁不强行要求「必须派生」（那是产品决定），而是要求**诚实**：
 *   1. 每份出图脚本必须显式声明它与参考库的关系（DERIVED / INSPIRED / INDEPENDENT）；
 *   2. 声明 DERIVED 的，脚本里必须真的出现参考库路径引用（否则是假溯源）；
 *   3. 任何出图脚本缺声明 -> FAIL（不允许默认沉默）。
 *
 * 覆盖面口径（Argon 第 65 轮 Q2 改判）：清单不再手写维护，改为**按实际产图调用动态发现**。
 * 手写白名单 + 文件名 *figures* 匹配都是「按名字信人」：ml_hub_analysis / ppi_string /
 * key_genes 这类名字不带 figures 却实打实调用 savefig / png( 产图的母版会合法游离在审查外。
 * 现在凡源码含产图落盘调用（且不在注释里）的母版一律纳管，集合双向恒等由契约测试钉住。
 *
 * 用法：node ops/figure_source_provenance.mjs
 */
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");

/** 三条分析线的脚本目录（隔离红线：只扫本仓 tools/bio/，不跨线取数）。 */
export const SCRIPT_LINES = Object.freeze(["line1_bulk", "line2_scrna", "line3_spatial"]);

/**
 * 产图落盘调用的判据。
 *
 * 刻意收得比较窄：只认真正会写出图件的调用，避免把 plt.plot( 这类绘制中间步骤也算进来。
 *   - Python: fig.savefig(...) / plt.savefig(...) / savefig(...)
 *   - R:      ggsave(...) / png(...) / pdf(...) / svg(...) / tiff(...)
 *   - R:      dev.copy(...)（把当前设备内容复制到文件设备）
 * 排除项：par( 与 plot( 不是落盘；readPNG 之类读入也不算。
 */
export const FIGURE_CALL_RE = /\b(?:savefig|ggsave|dev\.copy|png|pdf|svg|tiff|jpeg)\s*\(/;

/**
 * 从源码文本判定它是否真的产图。
 *
 * 关键：先剔除注释行与行尾注释。否则注释里写一句 "# fig.savefig(x)" 就会让
 * 一份纯计算母版被误判成产图母版，反之规范说明里的示例也会造成假阳性。
 */
export function hasFigureCall(text) {
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) continue;
    // 行尾注释：截断到第一个 #（R 与 Python 都用 #；这里不处理字符串内的 #，
    // 因为产图调用行极少出现含 # 的字符串，且假阳性只会多审不会漏审）
    const hashAt = rawLine.indexOf("#");
    const code = hashAt >= 0 ? rawLine.slice(0, hashAt) : rawLine;
    if (FIGURE_CALL_RE.test(code)) return true;
  }
  return false;
}

/**
 * 动态发现所有产图母版。
 *
 * @param {{ roots?: string[] }} [opts] roots 用于测试注入（给一个临时目录即只扫它）。
 * @returns {{ rel: string, abs: string, lineId: string, name: string }[]}
 */
export function discoverFigureProducers(opts = {}) {
  const out = [];
  if (Array.isArray(opts.roots)) {
    for (const root of opts.roots) {
      for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        if (!e.isFile()) continue;
        if (e.name === "README.md") continue;
        const abs = path.join(root, e.name);
        if (hasFigureCall(fs.readFileSync(abs, "utf8"))) {
          out.push({ rel: e.name, abs, lineId: "", name: e.name });
        }
      }
    }
    return out;
  }
  for (const lineId of SCRIPT_LINES) {
    const dir = path.join(REPO, "tools", "bio", lineId, "scripts");
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      if (e.name === "README.md") continue;
      // 独立脚本（.py/.R/.sh）不是母版，母版约定为无扩展名
      if (/\.(py|R|sh|md|json|tsv|csv)$/i.test(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (!hasFigureCall(fs.readFileSync(abs, "utf8"))) continue;
      out.push({ rel: lineId + "/" + e.name, abs, lineId, name: e.name });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * 出图脚本清单（相对 tools/bio/）。
 *
 * 由 discoverFigureProducers() 在模块加载时算好并冻结：新增产图母版会自动进来，
 * 不需要人工登记，也就不会出现「新增脚本悄悄脱离审查而门禁仍绿」。
 */
export const FIGURE_SCRIPTS = Object.freeze(discoverFigureProducers().map((r) => r.rel));

/** 合法的溯源声明关键字。 */
export const PROVENANCE_KINDS = Object.freeze(["DERIVED", "INSPIRED", "INDEPENDENT"]);

/** 参考库路径特征：出现即说明脚本真的读了库。 */
export const REFERENCE_PATH_MARKERS = Object.freeze([
  "05.可参考出图代码", "05.可参考生信代码", "可用代码预筛选", "reference/05", "R453_compat", "figure_library",
]);

/**
 * 解析一份出图脚本的溯源声明。约定在文件头部注释里写：
 *   # PROVENANCE: INDEPENDENT   （或 DERIVED / INSPIRED）
 * 允许 R 的 # 与 Python 的 # 两种注释前缀（都是 #）。
 * @returns {string|null}
 */
export function parseProvenance(text) {
  const m = text.match(/^\s*#\s*PROVENANCE:\s*(DERIVED|INSPIRED|INDEPENDENT)\b/m);
  return m ? m[1] : null;
}

/**
 * 该脚本是否真的引用了参考库路径。
 *
 * 关键：必须先剔除 PROVENANCE 声明行本身。声明里必然会写
 * "reference/05.可参考出图代码" 来解释关系，若不剔除，判据会被自己污染 ——
 * 一个如实声明 INDEPENDENT 的脚本反而会被判成"引用了库"。
 */
export function referencesLibrary(text) {
  const withoutDeclaration = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*#\s*PROVENANCE:/.test(line))
    .join("\n");
  return REFERENCE_PATH_MARKERS.some((marker) => withoutDeclaration.includes(marker));
}

function main() {
  const problems = [];
  const rows = [];
  for (const rel of FIGURE_SCRIPTS) {
    // rel 形如 line1_bulk/bulk_figures，实际路径是 tools/bio/<line>/scripts/<script>
    const [lineId, scriptName] = rel.split("/");
    const abs = path.join(REPO, "tools", "bio", lineId, "scripts", scriptName);
    if (!fs.existsSync(abs)) {
      problems.push(rel + ": 脚本不存在（清单过期？）");
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    const kind = parseProvenance(text);
    const refs = referencesLibrary(text);
    rows.push({ script: rel, provenance: kind || "(未声明)", referencesLibrary: refs });
    if (!kind) {
      problems.push(rel + ": 缺 PROVENANCE 声明（须为 DERIVED / INSPIRED / INDEPENDENT）");
      continue;
    }
    // 假溯源检测：声称派生却不引用库
    if (kind === "DERIVED" && !refs) {
      problems.push(rel + ": 声明 DERIVED 但脚本内未出现参考库路径（假溯源）");
    }
  }

  console.log("[figure_provenance] 按产图调用动态发现 " + rows.length + " 个出图脚本");
  for (const r of rows) {
    console.log("  " + r.script.padEnd(38) + " " + String(r.provenance).padEnd(12)
      + " referencesLibrary=" + r.referencesLibrary);
  }
  for (const p of problems) console.log("[FAIL] " + p);
  if (problems.length > 0) {
    console.log("FIGURE_PROVENANCE_FAIL " + problems.length + " 处不诚实或缺声明");
    process.exit(1);
  }
  console.log("FIGURE_PROVENANCE_OK " + rows.length + " 个产图母版均有诚实溯源声明");
}

// 入口判定用 fileURLToPath（URL.pathname 在 Windows 上带 %编码与正斜杠，直接比对会失败，
// 导致看起来"门禁跑了但没输出"）。与 ops 下其它门禁保持同一种写法。
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SELF)) {
  main();
}
