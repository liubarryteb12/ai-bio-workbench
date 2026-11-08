#!/usr/bin/env python3
"""line2 normalize_hvg 的内存形态回归（2026-11-05 GSE185100 实测暴露）。

背景：母版原先直接调 sc.pp.normalize_total，其实现会造一个与 nnz 等长的临时数组
（x.data = op(x.data, np.repeat(scaling, np.diff(indptr)))。在 74,883 细胞、nnz 2.1 亿的
真实数据上该临时数组 802 MiB，叠加原始矩阵与 layers['counts'] 后顶破 7.5GB RLIMIT，
实测 _ArrayMemoryError，整步 failed。

本测试钉住两件事（都是行为级，不靠注释）：
  1. 可执行代码里不得再出现全矩阵 sc.pp.normalize_total( 调用；
  2. 必须存在分块就地缩放的三件套：indptr 差值、按块 np.repeat、log1p。
注释里的说明文字不参与判定（strip_comments），避免「注释提到就算接线」的假绿。
"""

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "src" / "line2_scrna" / "scripts" / "normalize_hvg"


def strip_comments(text):
    """去掉 Python 注释（# 到行尾），保留字符串与代码。"""
    out = []
    for line in text.splitlines():
        quote = None
        cut = len(line)
        for idx, ch in enumerate(line):
            if quote is not None:
                if ch == quote:
                    quote = None
                continue
            if ch in ("'", '"'):
                quote = ch
                continue
            if ch == "#":
                cut = idx
                break
        out.append(line[:cut])
    return "\n".join(out)


class NormalizeHvgMemoryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = SCRIPT.read_text(encoding="utf-8")
        cls.code = strip_comments(cls.raw)

    def test_script_exists_and_has_embedded_python(self):
        self.assertTrue(SCRIPT.is_file(), "母版 normalize_hvg 不存在: %s" % SCRIPT)
        self.assertIn("<<'PYSCRIPT'", self.raw, "母版应保留内嵌 python 段")

    def test_no_full_matrix_normalize_total(self):
        offenders = [line.strip() for line in self.code.splitlines()
                     if re.search(r"sc\.pp\.normalize_total\s*\(", line)]
        self.assertEqual(
            offenders, [],
            "可执行代码里不得再调 sc.pp.normalize_total（nnz 等长临时数组会 OOM）: %s" % offenders)

    def test_chunked_scaling_present(self):
        self.assertRegex(self.code, r"np\.diff\(\s*indptr\s*\)",
                         "缺少 indptr 行非零数计算（分块缩放的依据）")
        self.assertRegex(self.code, r"np\.repeat\(\s*scaling\[",
                         "缺少按块 np.repeat 缩放（块内临时量才可控）")
        self.assertRegex(self.code, r"np\.log1p\(\s*data\s*,\s*out\s*=\s*data\s*\)",
                         "缺少就地 log1p（避免再分配一份矩阵）")

    def test_lib_size_check_before_log1p(self):
        # 库大小必须等于 target_sum 的检查只能落在 log1p 之前：log 之后行和没有 1e4 语义。
        check_pos = self.code.find("lib_after")
        log1p_pos = self.code.find("np.log1p(")
        self.assertGreater(check_pos, 0, "缺少 lib_after 库大小检查")
        self.assertGreater(log1p_pos, 0, "缺少 log1p")
        self.assertLess(check_pos, log1p_pos,
                        "库大小检查必须早于 log1p（顺序反了会误判/漏判）")


if __name__ == "__main__":
    unittest.main()