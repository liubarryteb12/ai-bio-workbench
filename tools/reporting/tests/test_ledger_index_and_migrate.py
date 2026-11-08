#!/usr/bin/env python3
"""Contract tests for JSONL ledger indexing and legacy migration."""

import json
import os
import subprocess
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "tools" / "ops" / "ledger_indexer.py"
MIGRATE_SCRIPT = REPO_ROOT / "tools" / "ops" / "migrate_to_workspace_projects.py"
LOCAL_WS_SCRIPT = REPO_ROOT / "tools" / "ops" / "local_project_workspace.py"
TEST_ROOT = REPO_ROOT / "artifacts" / "local_project_workspace_tests" / "wp21_ledger_index_tests"


def run_cli(script, root, args):
    command = [sys.executable, str(script), "--root", str(root)] + list(args)
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
    return json.loads(proc.stdout)


def write_jsonl(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_machine_log(path, task_id, project_id, line_id="line1_bulk"):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "task_id": task_id,
        "project_id": project_id,
        "line_id": line_id,
        "step_name": "example_step",
        "status": "completed",
    }
    path.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


class LedgerIndexAndMigrationTest(unittest.TestCase):
    def setUp(self):
        TEST_ROOT.mkdir(parents=True, exist_ok=True)
        self.root = Path(tempfile.mkdtemp(prefix="case_", dir=str(TEST_ROOT)))

    def tearDown(self):
        shutil.rmtree(self.root)

    def scaffold(self, project_id="PRJ_WP21"):
        proc = run_cli(LOCAL_WS_SCRIPT, self.root, ["scaffold", "--project-id", project_id])
        self.assertEqual(proc.returncode, 0, proc.stderr)

    @property
    def ledger_dir(self):
        return self.root / "workspace/projects" / "PRJ_WP21" / "ledger"

    def test_append_only_ledger_uses_last_record_by_id(self):
        self.scaffold()
        write_jsonl(self.ledger_dir / "actions.jsonl", [
            {"id": "ACT-1", "kind": "init", "title": "first"},
            {"id": "ACT-1", "kind": "run", "title": "second"},
        ])
        write_jsonl(self.ledger_dir / "errors.jsonl", [
            {"id": "ERR-1", "status": "open", "title": "first"},
            {"id": "ERR-1", "status": "resolved", "title": "second"},
        ])
        proc = run_cli(SCRIPT, self.root, ["index", "--project-id", "PRJ_WP21"])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        index = json.loads((self.root / "workspace/projects" / "PRJ_WP21" / "INDEX.json").read_text(encoding="utf-8"))
        self.assertEqual(index["ledger_summary"]["actions"]["aggregated"][0]["title"], "second")
        self.assertEqual(index["ledger_summary"]["errors"]["aggregated"][0]["status"], "resolved")

    def test_refs_link_errors_and_fixes_many_to_many(self):
        self.scaffold()
        write_jsonl(self.ledger_dir / "errors.jsonl", [
            {"id": "ERR-1", "status": "open", "title": "first"},
            {"id": "ERR-2", "status": "open", "title": "second"},
            {"id": "ERR-3", "status": "open", "title": "third"},
        ])
        write_jsonl(self.ledger_dir / "fixes.jsonl", [
            {"id": "F-1", "status": "resolved", "title": "fix one", "refs": ["ERR-1", "ERR-2"]},
            {"id": "F-2", "status": "resolved", "title": "fix two", "refs": ["ERR-2"]},
        ])
        proc = run_cli(SCRIPT, self.root, ["index", "--project-id", "PRJ_WP21"])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        index = json.loads((self.root / "workspace/projects" / "PRJ_WP21" / "INDEX.json").read_text(encoding="utf-8"))
        issues_by_id = {issue["id"]: issue for issue in index["issues"]}
        self.assertEqual([item["id"] for item in issues_by_id["ERR-1"]["related_fixes"]], ["F-1"])
        self.assertEqual([item["id"] for item in issues_by_id["ERR-2"]["related_fixes"]], ["F-1", "F-2"])
        self.assertEqual([item["id"] for item in issues_by_id["F-1"]["related_errors"]], ["ERR-1", "ERR-2"])
        self.assertEqual([item["id"] for item in issues_by_id["F-2"]["related_errors"]], ["ERR-2"])

    def test_index_counts_artifacts_and_machine_logs(self):
        self.scaffold()
        figures = self.root / "workspace/projects" / "PRJ_WP21" / "figures"
        (figures / "line1_bulk" / "a.png").write_text("png-a\n", encoding="utf-8", newline="\n")
        (figures / "line2_scrna" / "b.png").write_text("png-b\n", encoding="utf-8", newline="\n")
        write_machine_log(self.root / "outputs" / "system_logs" / "case_a.json", "task-a", "PRJ_WP21")
        write_machine_log(self.root / "outputs" / "system_logs" / "case_b.json", "task-b", "PRJ_WP21")
        write_machine_log(self.root / "outputs" / "system_logs" / "other.json", "task-other", "OTHER")
        write_machine_log(self.root / "outputs" / "system_logs" / "legacy.json", "task-legacy", "")
        proc = run_cli(SCRIPT, self.root, ["index", "--project-id", "PRJ_WP21"])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        index = json.loads((self.root / "workspace/projects" / "PRJ_WP21" / "INDEX.json").read_text(encoding="utf-8"))
        self.assertEqual(index["artifact_counts"]["figures"], 2)
        self.assertEqual(index["machine_logs"]["count"], 2)
        readme = (self.root / "workspace/projects" / "PRJ_WP21" / "README.md").read_text(encoding="utf-8")
        self.assertIn("| figures | 2 |", readme)
        self.assertIn("条目数：`2`。", readme)

    def test_check_handoff_requires_four_substantive_sections(self):
        self.scaffold()
        handoff = self.root / "workspace/projects" / "PRJ_WP21" / "handoff.md"

        missing = run_cli(
            SCRIPT,
            self.root,
            ["--check-handoff", "--project", "PRJ_WP21"],
        )
        self.assertEqual(missing.returncode, 2)
        self.assertEqual(parse_json(missing)["ok"], False)

        handoff.write_text(
            "# 项目交接\n\n"
            "## 项目背景\n\nAIMS v3.1 项目背景说明。\n\n"
            "## 当前进度\n\n当前进度说明，包含已完成门禁。\n\n"
            "## 已知坑\n\n已知坑说明，引用 P-26、P-27、P-29。\n\n"
            "## 下一步\n\n下一步执行说明，包含明确责任人和验收命令。\n",
            encoding="utf-8",
            newline="\n",
        )
        passed = run_cli(
            SCRIPT,
            self.root,
            ["--check-handoff", "--project", "PRJ_WP21"],
        )
        self.assertEqual(passed.returncode, 0, passed.stdout + passed.stderr)
        payload = parse_json(passed)
        self.assertEqual(payload["ok"], True)
        self.assertEqual(
            payload["sections"],
            ["项目背景", "当前进度", "已知坑", "下一步"],
        )

    def test_ledger_migration_preserves_existing_id_and_is_idempotent(self):
        ledger_dir = self.root / "ledger"
        ledger_dir.mkdir(parents=True, exist_ok=True)
        custom_p30 = {"id": "P-30", "title": "KEEP_ME", "detail": "KEEP_ME"}
        write_jsonl(ledger_dir / "pitfalls.jsonl", [custom_p30])
        atomic_write = self.root / "ledger" / "actions.jsonl"
        atomic_write.write_text("", encoding="utf-8", newline="\n")
        pitfall_source = self.root / "ledger" / "pitfalls_ledger.md"
        pitfall_source.write_text(
            "# 踩坑与故障复盘台账\n\n字段顺序固定。\n\n## P-01 CRLF\n\n- 现象：CRLF\n- 修复：LF\n\n## P-02 端口\n\n- 现象：端口冲突\n- 修复：随机端口\n",
            encoding="utf-8",
            newline="\n",
        )
        ops_source = self.root / "ledger" / "ops_ledger.md"
        ops_source.write_text(
            "# 运维同步台账\n\n| 时间 | 状态 | 目标 | 一致 | 漂移 | manifest |\n| --- | --- | --- | --- | --- | --- |\n- 2026-10-21T18:10:24+08:00 | OK | k40-ubuntu:/mnt/ssd/bio_data | 1/1 一致 | 漂移 0 | 未执行 | ops/a.sh | manifest: entries=1\n",
            encoding="utf-8",
            newline="\n",
        )
        first = parse_json(run_cli(MIGRATE_SCRIPT, self.root, ["ledger"]))
        self.assertEqual(first["ok"], True)
        self.assertEqual(first["pitfalls_appended"], 2)
        self.assertEqual(first["actions_appended"], 1)
        self.assertEqual(len(read_jsonl(ledger_dir / "pitfalls.jsonl")), 3)
        preserved = {row["id"]: row for row in read_jsonl(ledger_dir / "pitfalls.jsonl")}
        self.assertEqual(preserved["P-30"]["title"], "KEEP_ME")
        self.assertEqual(len(read_jsonl(ledger_dir / "actions.jsonl")), 1)
        second = parse_json(run_cli(MIGRATE_SCRIPT, self.root, ["ledger"]))
        self.assertEqual(second["pitfalls_appended"], 0)
        self.assertEqual(second["actions_appended"], 0)
        self.assertEqual(len(read_jsonl(ledger_dir / "pitfalls.jsonl")), 3)
        self.assertEqual(len(read_jsonl(ledger_dir / "actions.jsonl")), 1)

    def test_project_migration_copies_categories_and_counts_and_is_idempotent(self):
        source = self.root / "outputs" / "demo_project" / "line1_bulk"
        (source / "results").mkdir(parents=True, exist_ok=True)
        (source / "processed").mkdir(parents=True, exist_ok=True)
        (source / "results" / "a.txt").write_text("A\n", encoding="utf-8", newline="\n")
        (source / "processed" / "b.txt").write_text("B\n", encoding="utf-8", newline="\n")
        first = parse_json(run_cli(MIGRATE_SCRIPT, self.root, ["projects", "--project-id", "demo_project"]))
        self.assertEqual(first["ok"], True)
        self.assertEqual(first["source_file_count"], 2)
        self.assertEqual(first["copied_file_count"], 2)
        target = self.root / "workspace/projects" / "demo_project" / "data" / "line1_bulk" / "results"
        self.assertEqual((target / "a.txt").read_text(encoding="utf-8"), "A\n")
        processed = self.root / "workspace/projects" / "demo_project" / "data" / "line1_bulk" / "processed"
        self.assertEqual((processed / "b.txt").read_text(encoding="utf-8"), "B\n")
        self.assertTrue((self.root / "outputs" / "demo_project" / "line1_bulk" / "results" / "a.txt").is_file())
        second = parse_json(run_cli(MIGRATE_SCRIPT, self.root, ["projects", "--project-id", "demo_project"]))
        self.assertEqual(second["source_file_count"], 2)
        self.assertEqual(second["copied_file_count"], 2)
        self.assertEqual((target / "a.txt").read_text(encoding="utf-8"), "A\n")


if __name__ == "__main__":
    unittest.main()
