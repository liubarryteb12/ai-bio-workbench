/**
 * L3 空间域母版图源契约。
 *
 * 默认必须用 obsm['spatial'] 的 cKDTree 6 邻空间图跑 Leiden，
 * 表达 PCA kNN 只在 BIO_SPATIAL_GRAPH=0 时作为显式对照保留。
 * BANKSY 只做可选的特征平滑，空间邻接图的开关与报告口径由独立变量控制。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(REPO, "src", "line3_spatial", "scripts", "spatial_domains");

function read() {
  return fs.readFileSync(SRC, "utf8");
}

function codeOnly(src) {
  return src.split(/\r?\n/).filter((line) => !line.trim().startsWith("#")).join("\n");
}

function sliceBetween(src, start, end) {
  const from = src.indexOf(start);
  assert.ok(from >= 0, "缺少起始锚点: " + start);
  const to = src.indexOf(end, from + start.length);
  assert.ok(to > from, "缺少结束锚点: " + end);
  return src.slice(from, to);
}

test("默认图源是 obsm['spatial'] 的 cKDTree 6 邻空间图", () => {
  const src = codeOnly(read());
  assert.match(src, /SPATIAL_GRAPH="\$\{BIO_SPATIAL_GRAPH:-1\}"/,
    "bash 侧默认必须是 1");
  assert.match(src, /os\.environ\.get\(\s*"BIO_SPATIAL_GRAPH"\s*,\s*"1"\s*\)/,
    "python 侧默认必须是 1");
  assert.match(src, /SPATIAL_K\s*=\s*6/, "空间图必须是 6 邻");
  assert.match(src, /cKDTree\(coords\)\.query/, "必须用 cKDTree 建空间近邻");
  assert.match(src, /obsm\["spatial"\]/, "坐标必须来自 obsm['spatial']");
  assert.match(src, /conn\.maximum\(conn\.T\)/, "连接矩阵必须对称化");
  assert.match(src, /dists\.maximum\(dists\.T\)/, "距离矩阵必须对称化");
  assert.match(src, /obsp\["connectivities"\]\s*=\s*conn/,
    "空间邻接必须写入 obsp['connectivities']");
  assert.match(src, /obsp\["distances"\]\s*=\s*dist/,
    "空间距离必须写入 obsp['distances']");
});

test("默认分支调用空间图 Leiden，不走表达 kNN", () => {
  const src = codeOnly(read());
  const block = sliceBetween(
    src,
    "if SPATIAL_GRAPH:\n            conn, dist = _spatial_knn",
    "        else:\n            sc.pp.neighbors(",
  );
  assert.match(block, /_spatial_knn/, "默认分支必须建空间图");
  assert.match(block, /sc\.tl\.leiden\(sub,\s*adjacency=sub\.obsp\["connectivities"\]/,
    "默认 Leiden 必须显式使用空间连接矩阵");
  assert.doesNotMatch(block, /sc\.pp\.neighbors/, "默认分支不得调用表达 kNN");
});

test("BIO_SPATIAL_GRAPH=0 保留纯表达 PCA Leiden 对照", () => {
  const src = codeOnly(read());
  const block = sliceBetween(
    src,
    "else:\n            sc.pp.neighbors(",
    'if "connectivities" not in sub.obsp',
  );
  assert.match(block, /sc\.pp\.neighbors\(/, "对照分支必须保留旧建图");
  assert.match(block, /sc\.tl\.leiden\(/, "对照分支必须保留 Leiden");
  assert.match(src, /graph_source=expression_knn_control/,
    "报告必须能写出表达 kNN 对照口径");
  assert.match(src, /GRAPH_SOURCE\s*=\s*"spatial_cKDTree"\s+if\s+SPATIAL_GRAPH\s+else\s+"expression_knn_control"/,
    "图源必须由 BIO_SPATIAL_GRAPH 单一判定");
});

test("报告同时记录 graph_source 与 banksy_lambda", () => {
  const src = codeOnly(read());
  assert.match(src, /graph_source=spatial_cKDTree/, "报告必须能写出默认空间图源");
  assert.match(src, /graph_source=expression_knn_control/, "报告必须能写出对照图源");
  assert.match(src, /banksy_lambda=%.2f/, "报告必须写 banksy_lambda 实际取值");
  assert.match(src, /"graph_source":\s*GRAPH_SOURCE/, "uns['domains'] 必须留图源台账");
});

test("BANKSY 只平滑特征，不写空间邻接图", () => {
  const src = codeOnly(read());
  const block = sliceBetween(src, "def _banksy_smooth", "REQUIRED_OBS =");
  assert.match(block, /X_pca\[isolated\]/, "孤立点必须保留原始 PCA");
  assert.doesNotMatch(block, /obsp\["connectivities"\]\s*=/, "BANKSY 不得接管空间邻接图");
  assert.doesNotMatch(block, /obsp\["distances"\]\s*=/, "BANKSY 不得接管空间距离图");
  assert.doesNotMatch(block, /sc\.pp\.neighbors/, "BANKSY 不得切到表达 kNN 建图");
  assert.match(src, /BIO_BANKSY_LAMBDA/, "BANKSY 开关必须独立存在");
  assert.match(src, /BIO_SPATIAL_GRAPH/, "空间图开关必须独立存在");
});

test("既有自校验仍然保留", () => {
  const src = codeOnly(read());
  assert.match(src, /X_pca 被改动/, "必须保留 X_pca 不变量");
  assert.match(src, /counts 层 nnz 被改变/, "必须保留 counts nnz 不变量");
  assert.match(src, /spatial 坐标或样本图丢失/, "必须保留 spatial 存在性检查");
  assert.match(src, /obs 列丢失/, "必须保留 obs 列检查");
});
