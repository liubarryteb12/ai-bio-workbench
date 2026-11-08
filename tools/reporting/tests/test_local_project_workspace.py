#!/usr/bin/env python3
"""Contract tests for tools/ops/local_project_workspace.py.

These run only on the K40 compute plane. They cover the minimal workspace
contract without touching production data.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "tools" / "ops" / "local_project_workspace.py"
INIT_SCRIPT = REPO_ROOT / "tools" / "ops" / "init_project_scaffold.py"
TEST_ROOT = REPO_ROOT / "artifacts" / "local_project_workspace_tests"


def run_cli(args, root, script=SCRIPT):
    command = [
        sys.executable,
        str(script),
        "--root",
        str(root),
    ] + args
    proc = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    return proc


def parse_json(proc):
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    return json.loads("\n".join(lines))


def scaffold(root, project_id="demo_project"):
    return run_cli(["scaffold", "--project-id", project_id], root)


def init_scaffold(root, project_id="demo_project", line="line1_bulk"):
    command = [
        sys.executable,
        str(INIT_SCRIPT),
        "--root",
        str(root),
        "--project",
        project_id,
        "--line",
        line,
    ]
    return subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )


def make_fixture_repo(base, name="fixture_repo"):
    fixture_repo = base / name
    fixture_ops = fixture_repo / "tools" / "ops"
    fixture_ops.mkdir(parents=True)
    fixture_script = fixture_ops / SCRIPT.name
    shutil.copy2(SCRIPT, fixture_script)
    return fixture_repo, fixture_script


class LocalProjectWorkspaceTest(unittest.TestCase):
    def setUp(self):
        TEST_ROOT.mkdir(parents=True, exist_ok=True)
        self.root = Path(tempfile.mkdtemp(prefix="local_workspace_", dir=str(TEST_ROOT)))

    def tearDown(self):
        # Test temp dirs are isolated from production roots.
        for child in sorted(self.root.rglob("*"), reverse=True):
            if child.is_symlink() or child.is_file():
                child.unlink()
            elif child.is_dir():
                child.rmdir()
        self.root.rmdir()

    def test_scaffold_creates_required_contract(self):
        proc = scaffold(self.root)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        payload = parse_json(proc)
        self.assertTrue(payload["ok"])
        project_root = self.root / "workspace/projects" / "demo_project"
        self.assertTrue(project_root.is_dir())
        for name in ("project.json", "handoff.md", "README.md", "INDEX.json"):
            self.assertTrue((project_root / name).is_file())
        for line in ("line1_bulk", "line2_scrna", "line3_spatial"):
            for subdir in ("processed", "results"):
                self.assertTrue((project_root / "data" / line / subdir).is_dir())
            self.assertTrue((project_root / "figures" / line).is_dir())
        self.assertTrue((project_root / "figures" / "adapt").is_dir())
        for name in ("deliverables", "debug"):
            self.assertTrue((project_root / name).is_dir())
        ledger_dir = project_root / "ledger"
        for name in ("actions", "changes", "errors", "fixes", "pitfalls"):
            self.assertTrue((ledger_dir / (name + ".jsonl")).is_file())
            self.assertEqual((ledger_dir / (name + ".jsonl")).read_text(encoding="utf-8"), "")
        meta = json.loads((project_root / "project.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["project_id"], "demo_project")
        self.assertEqual(meta["lines"], ["line1_bulk", "line2_scrna", "line3_spatial"])

    def test_init_project_scaffold_is_compatible_with_parent_validate(self):
        init_proc = init_scaffold(self.root)
        self.assertEqual(init_proc.returncode, 0, init_proc.stderr)
        validate_proc = run_cli(["validate", "--project-id", "demo_project"], self.root)
        self.assertEqual(validate_proc.returncode, 0, validate_proc.stderr)
        payload = parse_json(validate_proc)
        self.assertTrue(payload["ok"])
        self.assertFalse((self.root / "workspace/projects" / "demo_project" / "data" / "line1_bulk" / "figures").exists())

    def test_scaffold_is_idempotent_and_keeps_user_content(self):
        self.assertEqual(scaffold(self.root).returncode, 0)
        project_root = self.root / "workspace/projects" / "demo_project"
        (project_root / "README.md").write_text("KEEP_ME\n", encoding="utf-8", newline="\n")
        (project_root / "ledger" / "actions.jsonl").write_text(
            json.dumps({"id": "A-1", "kind": "init"}) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        proc = scaffold(self.root)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((project_root / "README.md").read_text(encoding="utf-8"), "KEEP_ME\n")
        self.assertEqual(
            (project_root / "ledger" / "actions.jsonl").read_text(encoding="utf-8"),
            json.dumps({"id": "A-1", "kind": "init"}) + "\n",
        )

    def test_scaffold_rejects_existing_project_id_mismatch(self):
        self.assertEqual(scaffold(self.root).returncode, 0)
        project_root = self.root / "workspace/projects" / "demo_project"
        (project_root / "project.json").write_text(
            json.dumps({"project_id": "different_project", "schema_version": 1,
                        "lines": ["line1_bulk", "line2_scrna", "line3_spatial"]}) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        proc = scaffold(self.root, "demo_project")
        self.assertEqual(proc.returncode, 2)
        payload = parse_json(proc)
        self.assertFalse(payload["ok"])
        self.assertIn("project_id mismatch", payload["error"])

    def test_scaffold_rejects_invalid_project_id(self):
        for project_id in ("../outside", "foo/bar", ".hidden", ""):
            proc = scaffold(self.root, project_id)
            self.assertEqual(proc.returncode, 2, project_id)
            self.assertFalse(parse_json(proc)["ok"])

    def test_scaffold_rejects_unknown_flag(self):
        proc = run_cli(["scaffold", "--project-id", "demo_project", "--unknown"], self.root)
        self.assertEqual(proc.returncode, 2)

    def test_scaffold_rejects_corrupt_project_json(self):
        self.assertEqual(scaffold(self.root).returncode, 0)
        project_root = self.root / "workspace/projects" / "demo_project"
        (project_root / "project.json").write_text("{broken", encoding="utf-8", newline="\n")
        proc = scaffold(self.root)
        self.assertEqual(proc.returncode, 2)
        self.assertFalse(parse_json(proc)["ok"])

    @unittest.skipIf(os.name == "nt", "symlink contract runs on K40 Linux")
    def test_scaffold_rejects_symlink_parent(self):
        projects_root = self.root / "workspace/projects"
        outside = self.root / "outside"
        outside.mkdir()
        projects_root.mkdir(parents=True)
        target = projects_root / "demo_project"
        target.symlink_to(outside, target_is_directory=True)
        proc = scaffold(self.root)
        self.assertEqual(proc.returncode, 2)
        self.assertFalse(parse_json(proc)["ok"])

    def test_index_generates_local_and_global_machine_readable_views(self):
        self.assertEqual(scaffold(self.root).returncode, 0)
        proc = run_cli(["index"], self.root)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        project_root = self.root / "workspace/projects" / "demo_project"
        index = json.loads((project_root / "INDEX.json").read_text(encoding="utf-8"))
        self.assertEqual(index["project_id"], "demo_project")
        self.assertIn("path_map", index)
        self.assertIn("artifact_counts", index)
        self.assertIn("ledger_summary", index)
        self.assertTrue((self.root / "workspace/projects" / "INDEX.md").is_file())

    def test_index_project_id_keeps_global_index_for_all_projects(self):
        self.assertEqual(scaffold(self.root, "project_a").returncode, 0)
        self.assertEqual(scaffold(self.root, "project_b").returncode, 0)
        proc = run_cli(["index", "--project-id", "project_b"], self.root)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        payload = parse_json(proc)
        self.assertEqual(payload["projects"], ["project_a", "project_b"])
        global_index = (self.root / "workspace/projects" / "INDEX.md").read_text(encoding="utf-8")
        self.assertIn("| project_a |", global_index)
        self.assertIn("| project_b |", global_index)

    def test_index_project_id_rejects_missing_project_without_limiting_scope(self):
        self.assertEqual(scaffold(self.root, "project_a").returncode, 0)
        self.assertEqual(scaffold(self.root, "project_b").returncode, 0)
        proc = run_cli(["index", "--project-id", "missing_project"], self.root)
        self.assertEqual(proc.returncode, 2)
        payload = parse_json(proc)
        self.assertFalse(payload["ok"])
        self.assertIn("requested project not found", payload["error"])

    @unittest.skipIf(os.name == "nt", "symlink contract runs on K40 Linux")
    def test_index_rejects_symlinked_project_workspace(self):
        projects_root = self.root / "workspace/projects"
        outside = self.root / "outside"
        outside.mkdir()
        projects_root.mkdir(parents=True)
        (projects_root / "demo_project").symlink_to(outside, target_is_directory=True)
        proc = run_cli(["index"], self.root)
        self.assertEqual(proc.returncode, 2)
        payload = parse_json(proc)
        self.assertFalse(payload["ok"])
        self.assertIn("symlink", payload["error"])

    def test_index_rejects_project_without_ledger(self):
        self.assertEqual(scaffold(self.root).returncode, 0)
        project_root = self.root / "workspace/projects" / "demo_project"
        (project_root / "ledger" / "errors.jsonl").unlink()
        proc = run_cli(["index"], self.root)
        self.assertEqual(proc.returncode, 2)
        payload = parse_json(proc)
        self.assertFalse(payload["ok"])
        self.assertIn("missing ledger file", payload["error"])

    def test_index_rejects_root_escape_in_project_id(self):
        proc = run_cli(["index", "--project-id", "../outside"], self.root)
        self.assertEqual(proc.returncode, 2)
        payload = parse_json(proc)
        self.assertFalse(payload["ok"])
        self.assertIn("invalid project_id", payload["error"])

    @unittest.skipIf(os.name == "nt", "symlink contract runs on K40 Linux")
    def test_index_does_not_touch_preexisting_atomic_tmp_sentinel(self):
        self.assertEqual(scaffold(self.root).returncode, 0)
        projects_root = self.root / "workspace/projects"
        outside = self.root / "outside"
        outside.mkdir()
        sentinel = outside / "SENTINEL"
        sentinel.write_text("OUTSIDE\n", encoding="utf-8", newline="\n")
        project_root = projects_root / "demo_project"
        tmp_path = project_root / "INDEX.json.tmp"
        tmp_path.symlink_to(sentinel, target_is_directory=False)
        proc = run_cli(["index"], self.root)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(tmp_path.is_symlink())
        self.assertEqual(os.readlink(tmp_path), str(sentinel))
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "OUTSIDE\n")
        self.assertIn("| demo_project |", (projects_root / "INDEX.md").read_text(encoding="utf-8"))

    def test_index_is_idempotent_across_two_runs(self):
        self.assertEqual(scaffold(self.root, "project_a").returncode, 0)
        self.assertEqual(scaffold(self.root, "project_b").returncode, 0)
        first = run_cli(["index"], self.root)
        self.assertEqual(first.returncode, 0, first.stderr)
        global_path = self.root / "workspace/projects" / "INDEX.md"
        first_text = global_path.read_text(encoding="utf-8")
        second = run_cli(["index"], self.root)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(parse_json(second)["projects"], ["project_a", "project_b"])
        self.assertEqual(global_path.read_text(encoding="utf-8"), first_text)

    def test_index_does_not_trust_out_of_bounds_existing_paths(self):
        self.assertEqual(scaffold(self.root).returncode, 0)
        project_root = self.root / "workspace/projects" / "demo_project"
        (project_root / "INDEX.json").write_text(
            json.dumps({"path_map": {"data": "../outside"}}) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        proc = run_cli(["index"], self.root)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        index = json.loads((project_root / "INDEX.json").read_text(encoding="utf-8"))
        self.assertNotIn("../outside", json.dumps(index))

    def test_validate_accepts_valid_workspace(self):
        self.assertEqual(scaffold(self.root).returncode, 0)
        proc = run_cli(["validate"], self.root)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(parse_json(proc)["ok"])

    def test_root_cli_accepts_fixture_repo_and_rejects_outside_sibling(self):
        fixture_repo, fixture_script = make_fixture_repo(self.root)

        scaffold_proc = run_cli(
            ["scaffold", "--project-id", "demo_project"],
            fixture_repo,
            script=fixture_script,
        )
        self.assertEqual(scaffold_proc.returncode, 0, scaffold_proc.stderr)

        allowed_proc = run_cli(["validate"], fixture_repo, script=fixture_script)
        self.assertEqual(allowed_proc.returncode, 0, allowed_proc.stderr)
        self.assertTrue(parse_json(allowed_proc)["ok"])

        outside_root = fixture_repo.parent / "outside"
        outside_root.mkdir()
        rejected_proc = run_cli(["validate"], outside_root, script=fixture_script)
        self.assertEqual(rejected_proc.returncode, 2, rejected_proc.stderr)
        rejected_payload = parse_json(rejected_proc)
        self.assertFalse(rejected_payload["ok"])
        self.assertIn("outside allowed workspace roots", rejected_payload["error"])

    def assert_empty_root_rejected(self, raw_root, fixture_name):
        fixture_repo, fixture_script = make_fixture_repo(self.root, fixture_name)
        proc = run_cli(
            ["scaffold", "--project-id", "empty_root_probe"],
            raw_root,
            script=fixture_script,
        )
        self.assertEqual(proc.returncode, 2, proc.stderr)
        payload = parse_json(proc)
        self.assertIs(payload["ok"], False)
        for name in ("workspace/projects", "qa", "ledger"):
            self.assertFalse(
                (fixture_repo / name).exists(),
                "empty root created %s in the script REPO_ROOT" % name,
            )

    def test_scaffold_rejects_empty_root_without_defaulting_to_script_repo(self):
        self.assert_empty_root_rejected("", "empty_root_fixture")

    def test_scaffold_rejects_whitespace_root_without_defaulting_to_script_repo(self):
        self.assert_empty_root_rejected("   \t   ", "whitespace_root_fixture")

    def test_scaffold_accepts_explicit_fixture_repo_root(self):
        fixture_repo, fixture_script = make_fixture_repo(self.root)
        proc = run_cli(
            ["scaffold", "--project-id", "empty_root_probe"],
            fixture_repo,
            script=fixture_script,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        payload = parse_json(proc)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["root"], str(fixture_repo))
        self.assertTrue(
            (fixture_repo / "workspace/projects" / "empty_root_probe").is_dir()
        )

    def test_validate_rejects_corrupt_project_json(self):
        self.assertEqual(scaffold(self.root).returncode, 0)
        project_root = self.root / "workspace/projects" / "demo_project"
        (project_root / "project.json").write_text("{broken", encoding="utf-8", newline="\n")
        proc = run_cli(["validate"], self.root)
        self.assertEqual(proc.returncode, 2)
        self.assertFalse(parse_json(proc)["ok"])

    def test_validate_rejects_missing_or_symlinked_project_files(self):
        self.assertEqual(scaffold(self.root).returncode, 0)
        project_root = self.root / "workspace/projects" / "demo_project"
        for name in ("README.md", "handoff.md"):
            with self.subTest(file=name, scenario="missing"):
                path = project_root / name
                original = path.read_bytes()
                try:
                    path.unlink()
                    proc = run_cli(["validate"], self.root)
                    self.assertEqual(proc.returncode, 2)
                    payload = parse_json(proc)
                    self.assertFalse(payload["ok"])
                    self.assertIn(name, payload["error"])
                finally:
                    if path.exists() or path.is_symlink():
                        path.unlink()
                    path.write_bytes(original)
        for name in ("README.md", "handoff.md"):
            with self.subTest(file=name, scenario="symlink"):
                if os.name == "nt":
                    continue
                path = project_root / name
                original = path.read_bytes()
                try:
                    path.unlink()
                    path.symlink_to(project_root / "project.json")
                    proc = run_cli(["validate"], self.root)
                    self.assertEqual(proc.returncode, 2)
                    payload = parse_json(proc)
                    self.assertFalse(payload["ok"])
                    self.assertIn(name, payload["error"])
                finally:
                    if path.exists() or path.is_symlink():
                        path.unlink()
                    path.write_bytes(original)

    def test_ledger_aggregation_uses_last_record_by_id(self):
        self.assertEqual(scaffold(self.root).returncode, 0)
        ledger = self.root / "workspace/projects" / "demo_project" / "ledger"
        records = [
            {"id": "E-1", "status": "open", "title": "first"},
            {"id": "E-1", "status": "resolved", "title": "last"},
        ]
        (ledger / "errors.jsonl").write_text(
            "\n".join(json.dumps(record) for record in records) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        proc = run_cli(["validate"], self.root)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        payload = parse_json(proc)
        self.assertEqual(
            payload["projects"][0]["ledger_summary"]["errors"]["aggregated"][0]["status"],
            "resolved",
        )


if __name__ == "__main__":
    unittest.main()
