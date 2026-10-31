#!/usr/bin/env python3
"""Recoverably quarantine the fixed qa_a and qa_b incident with os.rename."""
import argparse, hashlib, json, os, re, stat, sys

ROOT = "/mnt/ssd/bio_data"
TARGET = ROOT + "/tmp/qa_incident_20261025_103530_quarantine"
LINES = ("line1_bulk", "line2_scrna", "line3_spatial")
LEDGERS = ("actions.jsonl", "changes.jsonl", "errors.jsonl", "fixes.jsonl", "pitfalls.jsonl")
METADATA = ("project.json", "README.md", "handoff.md", "INDEX.json")
ROOT_ENTRIES = frozenset(("INDEX.json", "README.md", "data", "debug", "deliverables",
                          "figures", "handoff.md", "ledger", "project.json"))
DATA_ENTRIES = frozenset(LINES)
LEAF_ENTRIES = frozenset(("processed", "figures", "results"))
FIGURE_ENTRIES = frozenset(LINES + ("adapt",))
# Facts from artifacts/k40_acceptance_20261025/qa_incident/inventory_stdout.log
FACTS = {
    "qa_a": ("a576da17dd3ec4c83748133aaa2ee25c878abd16b79d76e6093cb0447fb9788a",
             "e20a4c47c0f93b424755359559f933913b52e6cc3659af2c73f805f6c69d3550",
             "3020a5075a58dd0a45ee9200464cca613e796dee51a6f4a6b164f9d783e7b308",
             "751ca7164acb3be3d98dae3554dd1dd8a779f49f359cb6ff960415a44fda638d"),
    "qa_b": ("919207667c587fcab4bd297fa7fa752ac781e262fc44b86caa128e93b141979a",
             "e20a4c47c0f93b424755359559f933913b52e6cc3659af2c73f805f6c69d3550",
             "3020a5075a58dd0a45ee9200464cca613e796dee51a6f4a6b164f9d783e7b308",
             "9d429972821a73f09c3c5a3c0302160a81b02d99e05d8f6e3088968216677631"),
}

def checked(path):
    path = os.path.abspath(path)
    if os.path.commonpath((path, ROOT)) != ROOT or os.path.commonpath((os.path.realpath(path), ROOT)) != ROOT:
        raise ValueError("path escapes root: " + path)
    current = ROOT
    for part in os.path.relpath(path, ROOT).split(os.sep):
        if part == ".":
            break
        current = os.path.join(current, part)
        if os.path.islink(current):
            raise ValueError("symlink path: " + current)
    return path

def sha(path):
    digest = hashlib.sha256()
    with open(checked(path), "rb") as handle:
        for chunk in iter(lambda: handle.read(1048576), b""):
            digest.update(chunk)
    return digest.hexdigest()

def names(path, expected):
    path = checked(path)
    if not os.path.isdir(path) or os.path.islink(path):
        raise ValueError("not a real directory: " + path)
    actual = sorted(os.listdir(path))
    if actual != sorted(expected):
        raise ValueError("unexpected entries under %s: %r" % (path, actual))
    for name in expected:
        checked(os.path.join(path, name))
    return path

def empty(path):
    names(path, ())

def file_hash(path):
    path = checked(path)
    if not stat.S_ISREG(os.lstat(path).st_mode) or os.path.islink(path):
        raise ValueError("not a regular file: " + path)
    return sha(path)

def ledger(path):
    path = names(path, LEDGERS)
    result = {}
    for name in LEDGERS:
        current = os.path.join(path, name)
        if os.lstat(current).st_size != 0:
            raise ValueError("nonempty ledger: " + current)
        result[name] = file_hash(current)
    return result

def project(project_id):
    path = names(ROOT + "/local_projects/" + project_id, ROOT_ENTRIES)
    result = {}
    for name, expected in zip(METADATA, FACTS[project_id]):
        current = os.path.join(path, name)
        actual = file_hash(current)
        if actual != expected:
            raise ValueError("hash mismatch: " + current)
        result[name] = actual
    with open(os.path.join(path, "project.json"), encoding="utf-8") as handle:
        meta = json.load(handle)
    if meta.get("project_id") != project_id or not str(meta.get("created_at", "")).startswith("2026-10-25T10:35:3"):
        raise ValueError("metadata mismatch: " + path)
    names(os.path.join(path, "data"), DATA_ENTRIES)
    for line in LINES:
        line_path = names(os.path.join(path, "data", line), LEAF_ENTRIES)
        for leaf in LEAF_ENTRIES:
            empty(os.path.join(line_path, leaf))
    figures_path = names(os.path.join(path, "figures"), FIGURE_ENTRIES)
    for name in FIGURE_ENTRIES:
        empty(os.path.join(figures_path, name))
    empty(os.path.join(path, "debug"))
    empty(os.path.join(path, "deliverables"))
    for name, digest in ledger(os.path.join(path, "ledger")).items():
        result["ledger/" + name] = digest
    return result

def global_index():
    path = ROOT + "/local_projects/INDEX.md"
    text = open(checked(path), encoding="utf-8").read()
    rows = [item for item in re.findall(r"^\| ([^|]+) \|", text, re.M) if item not in ("project_id", "---")]
    match = re.search(r"```json\n(\{.*?\})\n```", text, re.S)
    if not match:
        raise ValueError("missing global index JSON")
    payload = json.loads(match.group(1))
    json_rows = [item.get("project_id") for item in payload.get("projects", [])]
    if rows != ["qa_a", "qa_b"] or json_rows != rows or text.count('"project_id"') != 2:
        raise ValueError("global index references other projects")
    return {"INDEX.md": file_hash(path)}

def plan():
    if os.path.realpath(ROOT) != ROOT:
        raise ValueError("root resolves elsewhere")
    current = "/"
    for part in ROOT.strip("/").split("/"):
        current = os.path.join(current, part)
        if os.path.islink(current):
            raise ValueError("symlink root path: " + current)
    tmp = checked(ROOT + "/tmp")
    if not os.path.isdir(tmp):
        raise ValueError("tmp is not a directory: " + tmp)
    local = names(ROOT + "/local_projects", ("qa_a", "qa_b", "INDEX.md"))
    checked(ROOT + "/con_hf")
    if os.path.lexists(TARGET):
        raise ValueError("target already exists: " + TARGET)
    checked(TARGET)
    items = []
    for project_id in ("qa_a", "qa_b"):
        source = os.path.join(local, project_id)
        target = os.path.join(TARGET, "local_projects", project_id)
        items.append({"source": source, "target": target, "base": target, "files": project(project_id)})
    source = os.path.join(local, "INDEX.md")
    target = os.path.join(TARGET, "local_projects", "INDEX.md")
    items.append({"source": source, "target": target, "base": os.path.dirname(target), "files": global_index()})
    source = ROOT + "/con_hf/ledger"
    target = os.path.join(TARGET, "con_hf", "ledger")
    items.append({"source": source, "target": target, "base": target, "files": ledger(source)})
    return {"root": ROOT, "target": TARGET, "items": items}

def write(path, payload):
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())

def apply(data):
    os.mkdir(TARGET)
    os.mkdir(os.path.join(TARGET, "local_projects"))
    os.mkdir(os.path.join(TARGET, "con_hf"))
    manifest = {"status": "applying", "root": ROOT, "target": TARGET, "actions": []}
    manifest_path = os.path.join(TARGET, "manifest.json")
    write(manifest_path, manifest)
    try:
        for item in data["items"]:
            action = {"source": item["source"], "target": item["target"], "action": "os.rename",
                      "status": "renaming", "source_hashes": item["files"]}
            manifest["actions"].append(action)
            write(manifest_path, manifest)
            os.rename(item["source"], item["target"])
            action["status"] = "moved"
            action["target_hashes"] = {name: file_hash(os.path.join(item["base"], name)) for name in item["files"]}
            if action["target_hashes"] != item["files"]:
                raise ValueError("target hash mismatch: " + item["target"])
            action["status"] = "moved_verified"
            write(manifest_path, manifest)
        manifest["status"] = "complete"
        write(manifest_path, manifest)
        return manifest, 0
    except Exception as cause:
        manifest["status"] = "failed"
        manifest["error"] = "%s: %s" % (type(cause).__name__, cause)
        write(manifest_path, manifest)
        return manifest, 1

def main():
    parser = argparse.ArgumentParser(add_help=False)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    mode = "apply" if args.apply else "dry-run"
    try:
        data = plan()
    except Exception as cause:
        print(json.dumps({"ok": False, "mode": mode, "exit_code": 2, "error": str(cause)}))
        return 2
    if not args.apply:
        print(json.dumps({"ok": True, "mode": "dry-run", "exit_code": 0, **data}, ensure_ascii=False))
        return 0
    try:
        manifest, code = apply(data)
    except ValueError as cause:
        print(json.dumps({"ok": False, "mode": "apply", "exit_code": 2, "error": str(cause)}))
        return 2
    except Exception as cause:
        print(json.dumps({"ok": False, "mode": "apply", "exit_code": 1, "error": str(cause)}))
        return 1
    print(json.dumps(manifest, ensure_ascii=False, sort_keys=True))
    return code

if __name__ == "__main__":
    sys.exit(main())
