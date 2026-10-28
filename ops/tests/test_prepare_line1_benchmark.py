#!/usr/bin/env python3

import io
import gzip
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

OPS_ROOT = Path(__file__).resolve().parents[1]
if str(OPS_ROOT) not in sys.path:
    sys.path.insert(0, str(OPS_ROOT))

from prepare_line1_benchmark import (
    classify_sample,
    build_benchmark,
    collapse_probes,
    parse_platform_table,
    parse_series_matrix,
)


SERIES_TEXT = """!Series_geo_accession\t"GSE_TEST"
!Series_platform_id\t"GPL_TEST"
!Sample_title\t"sample_stroke"\t"sample_control"
!Sample_geo_accession\t"GSM2"\t"GSM1"
!series_matrix_table_begin
"ID_REF"\t"GSM2"\t"GSM1"
"probe1"\t"10.0"\t"1.0"
"probe2"\t"20.0"\t"2.0"
!series_matrix_table_end
"""

SOFT_TEXT = """!platform_table_begin
ID\tSymbol
probe1\tSTAT3
probe2\tSTAT3 /// MIR1
probe3\t
!platform_table_end
"""


class PrepareLine1BenchmarkTest(unittest.TestCase):
    def test_classify_sample_is_case_insensitive(self):
        self.assertEqual(classify_sample("BLOOD_Control_Rep1"), "CTRL")
        self.assertEqual(classify_sample("3100083_Stroke"), "LS")
        self.assertIsNone(classify_sample("unknown"))

    def test_parse_series_matrix_reads_metadata_table_and_samples(self):
        data = parse_series_matrix(io.StringIO(SERIES_TEXT))
        self.assertEqual(data["accession"], "GSE_TEST")
        self.assertEqual(data["platform"], "GPL_TEST")
        self.assertEqual(data["samples"], ["GSM2", "GSM1"])
        self.assertEqual(data["groups"], {"GSM2": "LS", "GSM1": "CTRL"})
        self.assertEqual(data["values"]["probe1"], [10.0, 1.0])

    def test_parse_platform_table_and_collapse_choose_highest_mean_probe(self):
        mapping = parse_platform_table(io.StringIO(SOFT_TEXT))
        self.assertEqual(mapping["probe1"], "STAT3")
        self.assertEqual(mapping["probe2"], "STAT3")
        self.assertNotIn("probe3", mapping)
        collapsed = collapse_probes(
            {"probe1": [1.0, 2.0], "probe2": [8.0, 9.0], "probe3": [100.0, 100.0]},
            mapping,
        )
        self.assertEqual(collapsed["STAT3"], [8.0, 9.0])

    def test_build_benchmark_writes_common_gene_matrices_and_manifest(self):
        genes = ["GENE%04d" % index for index in range(1001)]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = {}
            for dataset in ("train", "val"):
                series = root / ("%s_series.txt.gz" % dataset)
                soft = root / ("%s_soft.txt.gz" % dataset)
                with gzip.open(series, "wt", encoding="utf-8", newline="\n") as handle:
                    handle.write('!Series_geo_accession\t"GSET_%s"\n' % dataset)
                    handle.write('!Series_platform_id\t"GPL_%s"\n' % dataset)
                    handle.write('!Sample_title\t"%s_stroke"\t"%s_control"\n' % (dataset, dataset))
                    handle.write('!Sample_geo_accession\t"GSM_%s_1"\t"GSM_%s_0"\n' % (dataset, dataset))
                    handle.write("!series_matrix_table_begin\n")
                    handle.write('"ID_REF"\t"GSM_%s_1"\t"GSM_%s_0"\n' % (dataset, dataset))
                    for index, gene in enumerate(genes):
                        handle.write('"probe%04d"\t"%s"\t"%s"\n' % (index, index + 2, index + 1))
                    handle.write("!series_matrix_table_end\n")
                with gzip.open(soft, "wt", encoding="utf-8", newline="\n") as handle:
                    handle.write("!platform_table_begin\nID\tGene Symbol\n")
                    for index, gene in enumerate(genes):
                        handle.write("probe%04d\t%s\n" % (index, gene))
                    handle.write("!platform_table_end\n")
                paths[dataset] = (series, soft)
            output = root / "benchmark"
            manifest = build_benchmark(SimpleNamespace(
                train_series=paths["train"][0],
                train_soft=paths["train"][1],
                val_series=paths["val"][0],
                val_soft=paths["val"][1],
                output=output,
            ))
            self.assertEqual(manifest["genes"], 1001)
            self.assertTrue((output / "processed" / "train" / "train_expr.tsv").is_file())
            self.assertTrue((output / "processed" / "val" / "val_expr.tsv").is_file())
            self.assertTrue((output / "benchmark_manifest.json").is_file())


if __name__ == "__main__":
    unittest.main()
