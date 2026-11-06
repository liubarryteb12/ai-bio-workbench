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
  // 这条断言首版写的是 55.0，把错误口径锁成了「必须如此」——
  // 断言替缺陷作证的典型例子。第 69 轮元宝调研查明 spot_diameter_fullres
  // 对应的是 65um 光学包络直径，55um 只是捕获孔径，按 55 折算比例尺偏短 17%。
  assert.match(src, /return\s+SPOT_ENVELOPE_UM\s*\/\s*d_px/,
    "必须按 65um 光斑包络常量折算 um/px 并返回");
});

test("逐样本空间图（01 域图 / 02 目标基因 / 03 KO DR）都要画比例尺", () => {
  const src = read();
  const calls = src.match(/add_scalebar\(/g) || [];
  // 定义处 1 次 + 至少 3 张图各 1 次
  assert.ok(calls.length >= 4,
    "add_scalebar 至少被调用 3 次（01/02/03 各一），加上定义共 >=4，实际 " + calls.length);
});

test("scalefactors 缺失时必须优雅跳过而不是抛异常", () => {
  const src = codeOnly(read());
  const i = src.indexOf("def _spot_um_per_px");
  assert.ok(i > 0, "应有 _spot_um_per_px 辅助函数");
  const block = src.slice(i, i + 900);
  // 锚到「except 分支体里就是 return None」：块里别处也有 return None，
  // 只查 /return None/ 会被另一分支满足（MUT-C 曾存活）。
  assert.match(block, /except\s*\([^)]*\)\s*:\s*\n\s*return None/,
    "except 分支必须直接 return None（缺失即跳过，不抛异常）");
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
test("比例尺口径必须与标定模块一致（65um 光斑包络）", () => {
  const sf = fs.readFileSync(SF, "utf8");
  const cal = fs.readFileSync(path.join(REPO, "ops", "spatial_calibration.py"), "utf8");
  // 两处必须同为 65.0：比例尺与微米阈值一旦口径分叉，图上的 500um 与代码里的 200um
  // 就不是同一个长度（实测按 55 折算会让比例尺偏短 17%）。
  assert.match(sf, /SPOT_ENVELOPE_UM\s*=\s*65\.0/, "spatial_figures 必须定义 65.0 光斑包络常量");
  assert.match(sf, /return\s+SPOT_ENVELOPE_UM\s*\/\s*d_px/, "比例尺必须用包络常量折算");
  assert.match(cal, /SPOT_ENVELOPE_UM\s*=\s*65\.0/, "标定模块必须同为 65.0");
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
