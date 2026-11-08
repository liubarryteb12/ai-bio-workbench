#!/usr/bin/env python3

import argparse
import hashlib
import unittest.mock
import json
import shutil
import sys
import unittest
from pathlib import Path

from PIL import Image, ImageDraw


OPS_ROOT = Path(__file__).resolve().parents[1]
TEST_DIR = Path(__file__).resolve().parent
if str(OPS_ROOT) not in sys.path:
    sys.path.insert(0, str(OPS_ROOT))

from figure_catalog_r_adapter import (
    build_r_command,
    generate_adapter,
    load_candidates,
    read_candidate_status,
    run_batch,
)


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class FakeTransport:
    def __init__(self, remote_root, image_mode="valid", exit_code=0):
        self.remote_root = Path(remote_root)
        self.image_mode = image_mode
        self.exit_code = exit_code
        self.commands = []
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
        self.commands.append(
            build_r_command(
                remote_dir=remote_dir,
                script_name=script_name,
                output_name=output_name,
                env=env,
                timeout_seconds=timeout_seconds,
                rscript_bin=self.rscript_bin,
            )
        )
        return {
            "exit_code": self.exit_code,
            "stdout": "single_figure_output\n",
            "stderr": "",
            "timed_out": False,
        }

    rscript_bin = "/opt/R/4.5.3/bin/Rscript"

    def download(self, remote_path, local_path):
        target = Path(local_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        if self.image_mode == "valid":
            image = Image.new("RGB", (320, 240), "white")
            ImageDraw.Draw(image).rectangle((40, 40, 280, 200), fill="#336699")
            image.save(target)
        elif self.image_mode == "blank":
            Image.new("RGB", (320, 240), "white").save(target)
        else:
            target.write_bytes(b"not a png")

    def cleanup(self, remote_dir):
        shutil.rmtree(remote_dir, ignore_errors=True)


def make_catalog(root):
    library = root / "library"
    (library / "code").mkdir(parents=True)
    (library / "figures").mkdir(parents=True)
    entries = []
    for catalog_id, deps, render_kind in (
        ("rgg_0070", ["circlize"], "base_grid"),
        ("rgg_0136", ["ggplot2", "packcircles", "viridis"], "ggplot"),
        ("rgg_0117", ["tidyverse"], "ggplot"),
    ):
        code = library / "code" / f"{catalog_id}.R"
        code.write_text(
            "# Catalog-ID: %s\n" % catalog_id
            + "if (Sys.getenv('BIOANALYS_SEED') == '') quit(status = 3)\n"
            + "set.seed(as.integer(Sys.getenv('BIOANALYS_SEED')))\n",
            encoding="utf-8",
            newline="\n",
        )
        preview = library / "figures" / f"{catalog_id}.png"
        preview.write_bytes(b"preview")
        entries.append(
            {
                "catalog_id": catalog_id,
                "status": "code_ready",
                "lang": "R",
                "title": catalog_id,
                "code_path": f"code/{catalog_id}.R",
                "preview_path": f"figures/{catalog_id}.png",
                "deps": deps,
                "code_file_sha256": sha256_file(code),
            }
        )
    catalog = library / "catalog.json"
    catalog.write_text(
        json.dumps({"schema_version": 1, "entries": entries}, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return catalog


def make_catalog_in_library(root):
    return make_catalog(root)


class FigureCatalogRAdapterTest(unittest.TestCase):
    def test_missing_seed_exits_3(self):
        catalog_path = make_catalog_in_library(TEST_DIR / "seed_missing_fixture")
        try:
            with self.assertRaises(SystemExit) as caught:
                from figure_catalog_r_adapter import main

                main(["--seed", ""])
        finally:
            shutil.rmtree(catalog_path.parent, ignore_errors=True)

    def test_load_candidates_and_status(self):
        with unittest.mock.patch.dict("os.environ", {"BIOANALYS_SEED": "42"}):
            catalog_path = make_catalog_in_library(TEST_DIR / "loader_fixture")
            try:
                candidates = load_candidates(catalog_path)
                self.assertEqual(
                    [c["catalog_id"] for c in candidates],
                    ["rgg_0070", "rgg_0117", "rgg_0136"],
                )
                self.assertEqual(
                    read_candidate_status(candidates[0], "rgg_0070"), "code_ready"
                )
            finally:
                shutil.rmtree(catalog_path.parent, ignore_errors=True)

    def test_build_r_command_posix_and_threads(self):
        command = build_r_command(
            remote_dir="/mnt/ssd/bio_data/tmp/figure_catalog_validation/run/rgg_0070",
            script_name="adapter_source.R",
            output_name="rgg_0070.png",
            env={
                "BIOANALYS_SEED": "42",
                "BIO_FIGURE_OUTPUT": (
                    "/mnt/ssd/bio_data/tmp/figure_catalog_validation/run/"
                    "rgg_0070/output/rgg_0070.png"
                ),
                "OMP_NUM_THREADS": "4",
                "OPENBLAS_NUM_THREADS": "4",
                "MKL_NUM_THREADS": "4",
                "LANG": "C.UTF-8",
            },
            timeout_seconds=120,
        )
        self.assertIn("mkdir -p -- ", command)
        self.assertIn("BIOANALYS_SEED=42", command)
        self.assertIn("OMP_NUM_THREADS=4", command)
        self.assertIn("BIO_FIGURE_OUTPUT=", command)
        self.assertIn("R_LIBS_USER=/opt/R/4.5.3-site-library", command)
        self.assertIn("/opt/R/4.5.3/bin/Rscript --vanilla", command)
        self.assertIn("timeout --signal=TERM --kill-after=10s 120s", command)
        self.assertNotIn("\\", command)

    def test_generate_adapter_contract(self):
        text = generate_adapter()
        self.assertIn("BIO_FIGURE_OUTPUT", text)
        self.assertIn("BIOANALYS_SEED", text)
        self.assertIn('type = "cairo"', text)
        self.assertIn("eval(exprs, envir = plot_env, enclos = plot_env)", text)
        self.assertIn("print.eval", text)
        with (TEST_DIR / "generated_adapter.R").open(
            "w", encoding="utf-8", newline="\n"
        ) as handle:
            handle.write(text)
        self.assertTrue((TEST_DIR / "generated_adapter.R").is_file())
        (TEST_DIR / "generated_adapter.R").unlink()

    def test_batch_pass_and_report(self):
        with unittest.mock.patch.dict("os.environ", {"BIOANALYS_SEED": "42"}):
            root = TEST_DIR / "batch_fixture"
            catalog_path = make_catalog_in_library(root)
            output_root = root / "r_adapter"
            transport = FakeTransport(root / "remote")
            try:
                report = run_batch(
                    catalog_path=catalog_path,
                    output_root=output_root,
                    seed=42,
                    transport=transport,
                    timeout_seconds=120,
                )
                self.assertEqual(report["summary"]["total"], 3)
                self.assertEqual(report["summary"]["pass"], 3)
                self.assertEqual(report["summary"]["failed"], 0)
                for execution in transport.executions:
                    self.assertEqual(execution["env"]["BIOANALYS_SEED"], "42")
                    self.assertEqual(execution["env"]["OMP_NUM_THREADS"], "4")
                    self.assertEqual(execution["env"]["OPENBLAS_NUM_THREADS"], "4")
                    self.assertEqual(execution["env"]["MKL_NUM_THREADS"], "4")
                    self.assertTrue(
                        execution["env"]["BIO_FIGURE_OUTPUT"].endswith(".png")
                    )
                for item in report["entries"]:
                    self.assertEqual(item["verdict"], "pass")
                    self.assertTrue((output_root / item["evidence_dir"] / "artifact.png").is_file())
                    self.assertTrue((output_root / item["evidence_dir"] / "report.txt").is_file())
                self.assertTrue((output_root / "batch_report.json").is_file())
                self.assertTrue((output_root / "summary.tsv").read_text().startswith("catalog_id"))
            finally:
                shutil.rmtree(root, ignore_errors=True)

    def test_unsupported_failure(self):
        with unittest.mock.patch.dict("os.environ", {"BIOANALYS_SEED": "42"}):
            root = TEST_DIR / "unsupported_fixture"
            catalog_path = make_catalog_in_library(root)
            transport = FakeTransport(root / "remote", image_mode="corrupt", exit_code=0)
            try:
                report = run_batch(
                    catalog_path=catalog_path,
                    output_root=root / "r_adapter",
                    seed=42,
                    transport=transport,
                )
                self.assertEqual(report["summary"]["image_failure"], 3)
            finally:
                shutil.rmtree(root, ignore_errors=True)

    def test_workspace_boundary(self):
        with unittest.mock.patch.dict("os.environ", {"BIOANALYS_SEED": "42"}):
            root = TEST_DIR / "boundary_fixture"
            root.mkdir(parents=True, exist_ok=True)
            boundary_root = root / "inside"
            boundary_root.mkdir(parents=True, exist_ok=True)
            with self.assertRaises(ValueError) as caught:
                run_batch(
                    catalog_path=TEST_DIR / "test_figure_catalog_r_adapter.py",
                    output_root=root / "output",
                    seed=42,
                    transport=FakeTransport(root / "remote"),
                    workspace_root=boundary_root,
                )
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
