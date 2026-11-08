#!/usr/bin/env python3

import gzip
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

OPS_ROOT = Path(__file__).resolve().parents[1]
if str(OPS_ROOT) not in sys.path:
    sys.path.insert(0, str(OPS_ROOT))

from verify_public_references import count_lines, sha256, verify_gzip


class VerifyPublicReferencesTest(unittest.TestCase):
    def test_hash_and_gzip_checks(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sample.tsv.gz"
            with gzip.open(path, "wb") as handle:
                handle.write(b"a\tb\n1\t2\n")
            expected = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(sha256(path), expected)
            self.assertTrue(verify_gzip(path))

            broken = Path(tmp) / "broken.gz"
            broken.write_bytes(b"not-gzip")
            self.assertFalse(verify_gzip(broken))

    def test_count_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "matrix.tsv"
            path.write_text("gene\tS1\tS2\ng1\t1\t2\ng2\t3\t4\n", encoding="utf-8")
            self.assertEqual(count_lines(path), 3)


if __name__ == "__main__":
    unittest.main()
