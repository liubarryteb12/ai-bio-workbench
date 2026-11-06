/**
 * 空间图比例尺契约（方案 B 之后的下一步，2026-11-06）。
 *
 * sci.md v3.0 要求：空间转录组组织切片图必须内嵌整数物理比例尺（标明 µm）。
 * 数据依据：uns['spatial'][sample]['scalefactors']['spot_diameter_fullres']
 * 给出 spot 在 fullres 像素下的直径；按 Visium 标称点径 55 µm 折算 µm/px。
 * 实测本数据集 spot_diameter_fullres = 87.16509 → 0.631 µm/px。
 *
 * 判据：
 *   1. 母版必须实现比例尺函数并真的在逐样本空间图上调用；
 *   2. 必须从 scalefactors 读 spot 直径，不得写死常数；
 *   3. scalefactors 缺失时必须优雅跳过（返回假值），不得让整图失败。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SF = path.join(REPO, "src/line3_spatial/scripts/spatial_figures");

function read() {
  return fs.readFileSync(SF, "utf8");
}

/** 剥掉整行注释：本仓库多次出现「注释里的字样替实现作证」的假绿。 */
function codeOnly(src) {
  return src.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
}

test("必须实现比例尺函数，且从 scalefactors 取 spot 直径", () => {
  const src = codeOnly(read());
  assert.match(src, /def add_scalebar\(/, "必须有 add_scalebar 函数");
  // 锚到赋值语句本身：只查「文件里出现 spot_diameter_fullres」会被文档字符串满足
  assert.match(src, /d_px\s*=\s*float\(\s*sf\[\s*["']spot_diameter_fullres["']\s*\]\s*\)/,
    "必须真的从 scalefactors 的 spot_diameter_fullres 取值赋给 d_px");
  // 第 73 轮改判：spot_diameter_fullres 只用于平台护栏（反推光斑直径是否在 50~70um 带内），
  // 不再作标定分子（它逐图波动 3.6%，用作基准会让比例尺偏长 1.5~5.1%）。
  assert.match(src, /implied_spot_um\s*=\s*d_px\s*\*\s*um_per_px/,
    "d_px 必须参与平台护栏的反推计算");
});

test("逐样本空间图（01 域图 / 02 目标基因 / 03 KO DR）都要画比例尺", () => {
  const src = read();
  const calls = src.match(/add_scalebar\(/g) || [];
  // 定义处 1 次 + 至少 3 张图各 1 次
  assert.ok(calls.length >= 4,
    "add_scalebar 至少被调用 3 次（01/02/03 各一），加上定义共 >=4，实际 " + calls.length);
});

test("scalefactors 缺失时必须优雅降级而不是抛异常", () => {
  const src = codeOnly(read());
  const i = src.indexOf("def _spot_um_per_px");
  assert.ok(i > 0, "应有 _spot_um_per_px 辅助函数");
  // 用函数边界切，不用固定字符窗口：窗口会随函数变长而截断，
  // 本轮加晶格标定后就断在中间，导致「找不到 except」的假红。
  const nextDef = src.indexOf("\ndef ", i + 1);
  const block = src.slice(i, nextDef > 0 ? nextDef : i + 4000);
  // 第 73 轮改判后的语义：scalefactors 缺失不再是「整条跳过」，而是仍可走晶格标定；
  // 晶格也不可用时必须 fail-closed（DeepSeek 裁定：静默回退等于出一张已知偏 5% 的图）。
  assert.match(block, /except\s*\([^)]*\)\s*:\s*\n\s*d_px\s*=\s*None/,
    "读取 scalefactors 的 except 分支必须把 d_px 置 None（不抛异常）");
  assert.match(block, /fail\(/, "晶格不可用必须 fail-closed，不得静默回退");
});

test("比例尺长度按数据范围自适应，且文字标注单位", () => {
  const src = read();
  // 锚到实际执行绘制的 _draw_scalebar_now：重构后 add_scalebar 只做登记，
  // 绘制体已移到 _draw_scalebar_now。继续从 add_scalebar 起窗口会随代码长度漂移
  // 而截断在 ax.text 之前（本轮实测踩到）。
  const i = src.indexOf("def _draw_scalebar_now");
  assert.ok(i > 0, "必须存在 _draw_scalebar_now 绘制体");
  const block = src.slice(i, i + 2200);
  assert.match(block, /bar\s*=\s*um\s*\/\s*um_per_px/, "必须用 um/px 换算条长");
  assert.match(block, /span_x|span_y/, "必须按数据范围定位/限长，不能写死像素");
  assert.match(block, /ax\.plot\(/, "必须真的画线");
  assert.match(block, /ax\.text\(/, "必须有文字标注");
});

test("add_scalebar 只登记，绘制必须后置到布局完成之后", () => {
  const src = read();
  const i = src.indexOf("def add_scalebar");
  assert.ok(i > 0, "必须存在 add_scalebar");
  const reg = src.slice(i, i + 400);
  // 登记器不得自己画线：否则又回到「先画后扩轴限」的几何漂移
  assert.match(reg, /_PENDING_SCALEBARS\.append\(/, "add_scalebar 必须只入队");
  assert.equal(/ax\.plot\(/.test(reg), false, "add_scalebar 内不得直接画线");
  // layout_fix 必须在 fit_text_edges 之后调用延迟绘制
  const lf = src.indexOf("def layout_fix");
  assert.ok(lf > 0, "必须存在 layout_fix");
  const body = src.slice(lf, lf + 1400);
  const fitAt = body.indexOf("fit_text_edges(fig, ax0)");
  const drawAt = body.indexOf("_draw_deferred_scalebars(fig)");
  assert.ok(fitAt > 0 && drawAt > fitAt,
    "延迟绘制必须排在 fit_text_edges 之后，否则比例尺仍会被轴限改动压缩");
});
test("比例尺与标定模块必须共用同一晶格口径（100um / 实测 pitch）", () => {
  const sf = fs.readFileSync(SF, "utf8");
  const cal = fs.readFileSync(path.join(REPO, "ops", "spatial_calibration.py"), "utf8");
  // 两处一旦口径分叉，图上的 500um 与代码里的 200um 就不是同一个长度。
  // 第 73 轮起主口径统一为晶格 100um；65um 只保留为交叉校验常量。
  assert.match(sf, /SPOT_PITCH_UM\s*=\s*100\.0/, "spatial_figures 必须定义 100um 晶格常量");
  assert.match(sf, /SPOT_ENVELOPE_UM\s*=\s*65\.0/, "spatial_figures 仍需 65um 用于平台护栏");
  assert.match(cal, /LATTICE_PITCH_UM\s*=\s*100\.0/, "标定模块必须同为 100um");
  assert.match(cal, /SPOT_ENVELOPE_UM\s*=\s*65\.0/, "标定模块仍需 65um 用于双口径校验");
  // 不得残留 55.0 折算（55 只允许作为捕获孔径被记录）
  assert.equal(/return\s+55\.0\s*\/\s*d_px/.test(sf), false, "比例尺不得再用 55.0 作分子");
});
test("自检误差门槛必须锁死在 3%%，不得被放宽", () => {
  const src = read();
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
  // 门槛是这条防线的全部价值所在：放宽到 50%% 就等于没有防线。
  // 首版没锁这个常量，把 0.03 改成 0.50 后所有契约仍全绿（MUT-H 存活）。
  assert.match(code, /abs\(actual_um - um\) \/ um > 0\.03\b/,
    "比例尺自检误差门槛必须是 0.03");
  assert.equal(/abs\(actual_um - um\) \/ um > 0\.(0[4-9]|[1-9]\d)/.test(code), false,
    "误差门槛被放宽（>0.03），防线失效");
});
test("自检必须读真实 artist 端点，不得用 bar 重算（否则是恒等式）", () => {
  const src = read();
  const i = src.indexOf("def _draw_scalebar_now");
  assert.ok(i > 0, "必须有 _draw_scalebar_now");
  const block = src.slice(i, i + 5000);
  // 第 73 轮实测踩到：用 (x1 - margin_x - bar) 重算端点时，dxb-dxa 恒等于 bar
  // 的像素长度，自检在数学上必然通过，条被收边压缩 6% 也照样报 500.000。
  assert.match(block, /get_xdata\(\)/, "必须读 artist 的真实 xdata 才叫量测");
  assert.equal(
    /dxa\s*=\s*float\(ax\.transData\.transform\(\(x1 - margin_x - bar/.test(block),
    false,
    "不得用 bar 重算端点：那是恒等式，测不出收边压缩",
  );
});

test("收边循环必须按轴限收敛，而不是固定轮数", () => {
  const src = read();
  const i = src.indexOf("def _draw_scalebar_now");
  const block = src.slice(i, i + 5000);
  // 固定两轮时，最后一轮收边仍可能再扩 xlim，条停在扩张前坐标上（实测短 5%）
  assert.match(block, /xlim_prev/, "必须记录上一轮轴限用于收敛判定");
  assert.match(block, /break/, "轴限稳定后必须提前退出，不能空转");
  assert.equal(/for _round in range\(2\)/.test(block), false, "不得退回固定两轮");
});
test("savefig 必须显式传 dpi，且 rcParams 不留第二个 dpi 真源", () => {
  const src = read();
  // manifest 的 bar_px 是 figure 显示像素；落盘像素由 savefig.dpi 决定。
  // 两者若不等，bar_px 与 PNG 实测脱钩，比例尺的第三方交叉验证静默失效（DeepSeek 第 73 轮审计）。
  // 不能用 [^)]* 匹配：savefig 的第一个实参是 os.path.join(...)，右括号会提前截断。
  // 改为锚「调用行本身同时出现 fig.savefig 与 dpi=」。
  const saveLine = src.split(/\r?\n/).find((l) => l.includes("fig.savefig("));
  assert.ok(saveLine, "必须有 fig.savefig 调用");
  assert.match(saveLine, /dpi\s*=\s*_dpi_at_save/, "savefig 必须显式传 dpi，实际：" + saveLine.trim());
  assert.match(src, /_dpi_at_save\s*=\s*float\(fig\.dpi\)/, "dpi 取值必须来自 fig.dpi");
  assert.equal(/["']savefig\.dpi["']\s*:/.test(src), false,
    "rcParams 不得再保留 savefig.dpi：同一含义只留 figure.dpi 一个真源");
});
test("比例尺标定必须以晶格 pitch 为准，65um 光斑包络只作回退", () => {
  const src = codeOnly(read());
  assert.match(src, /SPOT_PITCH_UM\s*=\s*100\.0/, "必须有 100um 晶格常量");
  const i = src.indexOf("def _spot_um_per_px");
  const nextDef = src.indexOf("\ndef ", i + 1);
  const block = src.slice(i, nextDef > 0 ? nextDef : i + 4000);
  // 第 73 轮实测：spot_diameter_fullres 在 87.06~90.19 间波动，而最近邻恒为 132.0；
  // 用 65/d_px 会让 500um 的条实际画出 507.9~525.5um（偏长 1.5~5.1%）。
  assert.match(block, /SPOT_PITCH_UM\s*\/\s*nn/, "必须按 100um / 最近邻标定");
  // 第 73 轮 DeepSeek 裁定：不再保留静默回退到 65/d_px 的路径。
  assert.equal(/SPOT_ENVELOPE_UM\s*\/\s*d_px/.test(block), false,
    "不得保留静默回退：65/d_px 已知偏 1.5~5.1%，回退应 fail-closed");
});
test("平台护栏：反推光斑直径必须落在 Visium 的 50~70 µm 带内", () => {
  const src = codeOnly(read());
  const i = src.indexOf("def _spot_um_per_px");
  const nextDef = src.indexOf("\ndef ", i + 1);
  const block = src.slice(i, nextDef > 0 ? nextDef : i + 5000);
  // 防「把 Visium 的 100um 常量套到 HD / Slide-seq / MERFISH 上」：
  // 那些平台反推的光斑直径会远离 50~70 um，必须当场失败而不是静默出错图。
  assert.match(block, /implied_spot_um\s*=\s*d_px\s*\*\s*um_per_px/, "必须计算反推光斑直径");
  // 带宽必须从 SPOT_ENVELOPE_UM 推出来（50 = 65-15，70 = 65+5），
  // 否则 65 会变成「定义了但没人用」的死常量。
  assert.match(block, /SPOT_DIAMETER_MIN_UM\s*<=\s*implied_spot_um\s*<=\s*SPOT_DIAMETER_MAX_UM/,
    "护栏必须用 SPOT_DIAMETER_MIN_UM / MAX_UM 判定");
  assert.match(src, /SPOT_DIAMETER_MIN_UM\s*=\s*SPOT_ENVELOPE_UM\s*-\s*15\.0/, "下界必须由 65-15 推出");
  assert.match(src, /SPOT_DIAMETER_MAX_UM\s*=\s*SPOT_ENVELOPE_UM\s*\+\s*5\.0/, "上界必须由 65+5 推出");
  assert.match(block, /fail\(/, "越界必须 fail-closed");
});
test("破碎阵列护栏：显著偏离第一壳层的 spot 超过 5% 必须 fail", () => {
  const src = codeOnly(read());
  const i = src.indexOf("def _spot_um_per_px");
  const nextDef = src.indexOf("\ndef ", i + 1);
  const block = src.slice(i, nextDef > 0 ? nextDef : i + 6000);
  // 破碎切片会让中位最近邻被边缘点抬高，um/px 被压小，比例尺偏长。
  assert.match(block, /far_frac\s*=\s*float\(\(dist\[:, 1\]\s*>\s*1\.2\s*\*\s*nn\)\.mean\(\)\)/,
    "必须统计显著偏离第一壳层的占比");
  assert.match(block, /far_frac\s*>\s*0\.05/, "阈值必须是 5%");
  // 与 ops/spatial_calibration._first_shell_pitch 必须同算法：
  // 只取前 6 个邻居都在第一壳层的内部点。两处口径不同会让图上的 500um
  // 与代码里的 200um 在不同切片上分叉。
  assert.match(block, /interior\s*=\s*\(dist\[:, 1:7\]\s*<\s*1\.2\s*\*\s*nn\)\.all\(axis=1\)/,
    "必须用内部点（前 6 邻居都在第一壳层）算 pitch，与标定模块同算法");
  assert.match(block, /dist\[interior, 1\]/, "必须取内部点的最近邻中位");
  assert.match(block, /fail\(/, "越界必须 fail-closed");
});
