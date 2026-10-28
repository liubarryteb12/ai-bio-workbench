#!/usr/bin/env python3

import math
import sys
import unittest
from pathlib import Path

OPS_ROOT = Path(__file__).resolve().parents[1]
if str(OPS_ROOT) not in sys.path:
    sys.path.insert(0, str(OPS_ROOT))

from verify_r453_l2 import compare_float_bits, compare_headers


class VerifyR453L2Test(unittest.TestCase):
    def test_compare_headers_requires_exact_order(self):
        self.assertTrue(compare_headers(["基因", "样本"], ["基因", "样本"]))
        self.assertFalse(compare_headers(["样本", "基因"], ["基因", "样本"]))

    def test_compare_float_bits_detects_ulp_difference(self):
        self.assertTrue(compare_float_bits([0.1, 1 / 3, math.pi], [0.1, 1 / 3, math.pi]))
        self.assertFalse(compare_float_bits([1.0], [math.nextafter(1.0, 2.0)]))


if __name__ == "__main__":
    unittest.main()
