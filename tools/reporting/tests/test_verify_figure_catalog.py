#!/usr/bin/env python3

import hashlib
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

OPS_ROOT = Path(__file__).resolve().parents[1]
if str(OPS_ROOT) not in sys.path:
    sys.path.insert(0, str(OPS_ROOT))

from verify_figure_catalog import (
    CommandResult,
    build_execute_command,
    main,
    verify_catalog,
)


TEST_DIR = Path(__file__).resolve().parent


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class FakeTransport:
    def __init__(
        self,
        remote_root,
        image_mode="valid",
        exit_code=0,
        stdout="RENDER_OK\n",
        stderr="",
        timed_out=False,
    ):
        self.remote_root = Path(remote_root)
        self.image_mode = image_mode
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr
        self.timed_out = timed_out
        self.executions = []

    def prepare(self, remote_dir):
        Path(remote_dir).mkdir(parents=True, exist_ok=True)

    def upload(self, local_path, remote_path):
        target = Path(remote_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(local_path, target)

    def execute(self, remote_dir, script_name, output_name, env, timeout_seconds):
        self.executions.append(
            {
                "remote_dir": str(remote_dir),
                "script_name": script_name,
                "output_name": output_name,
                "env": dict(env),
                "timeout_seconds": timeout_seconds,
            }
        )
        output_path = Path(env["BIO_FIGURE_OUTPUT"])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if self.image_mode == "valid":
            image = Image.new("RGB", (320, 240), "white")
            ImageDraw.Draw(image).rectangle((40, 40, 280, 200), fill="#336699")
            image.save(output_path)
        elif self.image_mode == "blank":
            Image.new("RGB", (320, 240), "white").save(output_path)
        elif self.image_mode == "corrupt":
            output_path.write_bytes(b"not a png")
        return CommandResult(
            exit_code=self.exit_code,
            stdout=self.stdout,
            stderr=self.stderr,
            timed_out=self.timed_out,
        )

    def download(self, remote_path, local_path):
        target = Path(local_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(remote_path, target)

    def cleanup(self, remote_dir):
        shutil.rmtree(remote_dir, ignore_errors=True)


class VerifyFigureCatalogTest(unittest.TestCase):
    def _make_catalog(self, root):
        library = root / "library"
        code_dir = library / "code"
        figure_dir = library / "figures"
        code_dir.mkdir(parents=True)
        figure_dir.mkdir(parents=True)

        entries = []
        for catalog_id, status in (
            ("pgg_0001", "materialized"),
            ("pgg_0002", "k40_verified"),
        ):
            code_path = code_dir / f"{catalog_id}.py"
            code_path.write_text(
                "import os\n"
                "assert os.environ.get('BIOANALYS_SEED')\n"
                "assert os.environ.get('BIO_FIGURE_OUTPUT')\n",
                encoding="utf-8",
                newline="\n",
            )
            preview_path = figure_dir / f"{catalog_id}.png"
            Image.new("RGB", (320, 240), "white").save(preview_path)
            entries.append(
                {
                    "catalog_id": catalog_id,
                    "status": status,
                    "lang": "Python",
                    "title": catalog_id,
                    "code_path": f"code/{catalog_id}.py",
                    "preview_path": f"figures/{catalog_id}.png",
                    "code_file_sha256": sha256_file(code_path),
                }
            )

        r_code = code_dir / "rgg_0003.R"
        r_code.write_text("plot(1:3)\n", encoding="utf-8", newline="\n")
        entries.append(
            {
                "catalog_id": "rgg_0003",
                "status": "code_ready",
                "lang": "R",
                "title": "R candidate",
                "code_path": "code/rgg_0003.R",
                "preview_path": "figures/rgg_0003.png",
                "code_file_sha256": sha256_file(r_code),
            }
        )
        catalog_path = library / "catalog.json"
        catalog_path.write_text(
            json.dumps(
                {"schema_version": 1, "entries": entries},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
            newline="\n",
        )
        return catalog_path

    def test_batch_verifies_materialized_and_verified_python_candidates(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            catalog_path = self._make_catalog(root)
            output_root = root / "python_batch"
            transport = FakeTransport(root / "remote")

            report = verify_catalog(
                catalog_path=catalog_path,
                output_root=output_root,
                seed=20261013,
                host="k40-ubuntu",
                remote_root=Path("/mnt/ssd/bio_data"),
                timeout_seconds=30,
                transport=transport,
            )

            self.assertEqual(report["summary"]["total"], 2)
            self.assertEqual(report["summary"]["pass"], 2)
            self.assertEqual(report["summary"]["failed"], 0)
            self.assertEqual(
                [item["catalog_id"] for item in report["entries"]],
                ["pgg_0001", "pgg_0002"],
            )
            self.assertTrue((output_root / "batch_report.json").is_file())
            self.assertTrue((output_root / "summary.tsv").is_file())

            for execution in transport.executions:
                self.assertEqual(execution["env"]["BIOANALYS_SEED"], "20261013")
                self.assertEqual(execution["env"]["MPLBACKEND"], "Agg")
                self.assertEqual(execution["env"]["OMP_NUM_THREADS"], "4")
                self.assertEqual(execution["env"]["OPENBLAS_NUM_THREADS"], "4")
                self.assertEqual(execution["env"]["MKL_NUM_THREADS"], "4")
                self.assertTrue(execution["env"]["BIO_FIGURE_OUTPUT"].endswith(".png"))
                self.assertEqual(execution["timeout_seconds"], 30)

            for item in report["entries"]:
                evidence_dir = output_root / item["evidence_dir"]
                self.assertTrue((evidence_dir / "source.py").is_file())
                self.assertTrue((evidence_dir / "stdout.txt").is_file())
                self.assertTrue((evidence_dir / "stderr.txt").is_file())
                self.assertTrue((evidence_dir / "artifact.png").is_file())
                self.assertTrue((evidence_dir / "verification.json").is_file())
                self.assertTrue((evidence_dir / "report.txt").is_file())
                self.assertEqual(item["verdict"], "pass")
                self.assertEqual(item["artifact"]["sha256"], sha256_file(evidence_dir / "artifact.png"))
                self.assertGreater(item["artifact"]["width"], 0)
                self.assertGreater(item["artifact"]["height"], 0)

            summary_lines = (output_root / "summary.tsv").read_text(
                encoding="utf-8"
            ).splitlines()
            self.assertEqual(len(summary_lines), 3)
            self.assertIn("catalog_id", summary_lines[0])
            self.assertIn("verdict", summary_lines[0])

    def test_execute_command_keeps_remote_paths_posix(self):
        command = build_execute_command(
            remote_dir=Path("/mnt/ssd/bio_data/tmp/figure_catalog_validation/run/pgg_0001"),
            script_name="source.py",
            output_name="pgg_0001.png",
            env={
                "BIOANALYS_SEED": "20261013",
                "BIO_FIGURE_OUTPUT": (
                    "/mnt/ssd/bio_data/tmp/figure_catalog_validation/run/"
                    "pgg_0001/output/pgg_0001.png"
                ),
                "MPLBACKEND": "Agg",
                "OMP_NUM_THREADS": "4",
            },
            timeout_seconds=30,
            remote_python="/root/venvs/bio-py/bin/python3",
        )
        self.assertIn(
            "mkdir -p -- /mnt/ssd/bio_data/tmp/figure_catalog_validation/run/"
            "pgg_0001/output",
            command,
        )
        self.assertIn(
            "cd /mnt/ssd/bio_data/tmp/figure_catalog_validation/run/pgg_0001",
            command,
        )
        self.assertIn("BIOANALYS_SEED=20261013", command)
        self.assertIn("MPLBACKEND=Agg", command)
        self.assertIn("OMP_NUM_THREADS=4", command)
        self.assertIn("timeout --signal=TERM --kill-after=10s 30s", command)
        self.assertNotIn("\\", command)

    def test_blank_png_is_image_failure(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            catalog_path = self._make_catalog(root)
            transport = FakeTransport(root / "remote", image_mode="blank")
            report = verify_catalog(
                catalog_path=catalog_path,
                output_root=root / "batch",
                seed=20261013,
                statuses=("materialized",),
                transport=transport,
            )
            self.assertEqual(report["summary"]["image_failure"], 1)
            self.assertEqual(report["entries"][0]["verdict"], "fail")
            self.assertEqual(report["entries"][0]["validation_exit"], 1)

    def test_dependency_failure_is_classified(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            catalog_path = self._make_catalog(root)
            transport = FakeTransport(
                root / "remote",
                image_mode="missing",
                exit_code=1,
                stderr="ModuleNotFoundError: No module named 'squarify'\n",
            )
            report = verify_catalog(
                catalog_path=catalog_path,
                output_root=root / "batch",
                seed=20261013,
                statuses=("materialized",),
                transport=transport,
            )
            self.assertEqual(report["summary"]["dependency_failure"], 1)
            self.assertEqual(report["entries"][0]["failure_kind"], "dependency_failure")

    def test_network_failure_is_classified(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            catalog_path = self._make_catalog(root)
            transport = FakeTransport(
                root / "remote",
                image_mode="missing",
                exit_code=1,
                stderr="urllib.error.URLError: ConnectionResetError: reset by peer\n",
            )
            report = verify_catalog(
                catalog_path=catalog_path,
                output_root=root / "batch",
                seed=20261013,
                statuses=("materialized",),
                transport=transport,
            )
            self.assertEqual(report["summary"]["network_failure"], 1)
            self.assertEqual(report["entries"][0]["failure_kind"], "network_failure")

    def test_stdout_and_stderr_are_redacted(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            catalog_path = self._make_catalog(root)
            transport = FakeTransport(
                root / "remote",
                stdout="API_KEY=abc123\n",
                stderr="TOKEN=xyz789\n",
            )
            verify_catalog(
                catalog_path=catalog_path,
                output_root=root / "batch",
                seed=20261013,
                statuses=("materialized",),
                transport=transport,
            )
            stdout = (root / "batch" / "pgg_0001" / "stdout.txt").read_text(
                encoding="utf-8"
            )
            stderr = (root / "batch" / "pgg_0001" / "stderr.txt").read_text(
                encoding="utf-8"
            )
            self.assertIn("<REDACTED>", stdout)
            self.assertIn("<REDACTED>", stderr)
            self.assertNotIn("abc123", stdout)
            self.assertNotIn("xyz789", stderr)

    def test_timeout_is_classified(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            catalog_path = self._make_catalog(root)
            transport = FakeTransport(
                root / "remote",
                image_mode="missing",
                exit_code=124,
                timed_out=True,
            )
            report = verify_catalog(
                catalog_path=catalog_path,
                output_root=root / "batch",
                seed=20261013,
                statuses=("materialized",),
                transport=transport,
            )
            self.assertEqual(report["summary"]["timeout"], 1)
            self.assertEqual(report["entries"][0]["failure_kind"], "timeout")

    def test_source_hash_mismatch_does_not_execute(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            catalog_path = self._make_catalog(root)
            document = json.loads(catalog_path.read_text(encoding="utf-8"))
            document["entries"][0]["code_file_sha256"] = "0" * 64
            catalog_path.write_text(
                json.dumps(document, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
                newline="\n",
            )
            transport = FakeTransport(root / "remote")
            report = verify_catalog(
                catalog_path=catalog_path,
                output_root=root / "batch",
                seed=20261013,
                statuses=("materialized",),
                transport=transport,
            )
            self.assertEqual(report["summary"]["source_mismatch"], 1)
            self.assertEqual(transport.executions, [])

    def test_missing_seed_returns_contract_exit_three(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            catalog_path = self._make_catalog(root)
            self.assertEqual(
                main(
                    [
                        "--catalog",
                        str(catalog_path),
                        "--output",
                        str(root / "batch"),
                    ]
                ),
                3,
            )


if __name__ == "__main__":
    unittest.main()
