import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MASTER = path.join(REPO, "src/line3_spatial/scripts/ingest_spatial");
const TAR = path.join(REPO, ".tmp/gse233814/GSE233814_RAW.tar");

test("真实 GSE233814 tar：五样本各四类齐全且零未匹配", (t) => {
  if (!fs.existsSync(TAR)) {
    t.skip("HOST_MISSING_LOCAL_DATA: .tmp/gse233814/GSE233814_RAW.tar 不在位");
    return;
  }
  // 从母版抽出 member_re 原文，交给 python 在真实 tar 上跑
  const text = fs.readFileSync(MASTER, "utf8");
  const start = text.indexOf("member_re = re.compile(");
  assert.ok(start >= 0, "母版必须含 member_re 定义");
  let depth = 0;
  let end = start;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  const block = text.slice(start, end);

  const probe = [
    "import re, os, tarfile, json",
    "ns = {'re': re}",
    "exec(" + JSON.stringify(block) + ", ns)",
    "member_re = ns['member_re']",
    "samples = {}",
    "unmatched = []",
    "with tarfile.open(" + JSON.stringify(TAR) + ", 'r:') as tf:",
    "    for m0 in tf:",
    "        if not m0.isfile():",
    "            continue",
    "        base = os.path.basename(m0.name)",
    "        m = member_re.match(base)",
    "        if not m:",
    "            unmatched.append(base)",
    "            continue",
    "        gd = m.groupdict()",
    "        gsm = next((g for g in m.groups() if g and g.startswith('GSM')), None)",
    "        if gd.get('kind1'): kind = gd['kind1']",
    "        elif gd.get('sf2'): kind = 'json'",
    "        elif gd.get('sf4'): kind = 'tif'",
    "        else: kind = gd['kind3']",
    "        samples.setdefault(gsm, {}).setdefault('files', {})[kind] = 1",
    "print(json.dumps({",
    "    'samples': len(samples),",
    "    'unmatched': unmatched,",
    "    'kinds': {g: sorted(v['files']) for g, v in samples.items()},",
    "}))",
  ].join(String.fromCharCode(10));

  const out = execFileSync("python", ["-c", probe], { encoding: "utf8", timeout: 120000 });
  const result = JSON.parse(out.trim().split(String.fromCharCode(10)).pop());
  assert.equal(result.samples, 5, "必须有 5 个样本");
  assert.deepEqual(result.unmatched, [], "不得有未匹配成员");
  for (const gsm of Object.keys(result.kinds)) {
    for (const k of ["barcodes", "features", "matrix", "json"]) {
      assert.ok(result.kinds[gsm].includes(k), gsm + " 缺 " + k);
    }
  }
});
