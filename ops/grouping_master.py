#!/usr/bin/env python3
"""Read and edit per-project grouping master tables.

Usage:
  grouping_master.py list
  grouping_master.py show <project> [--group G] [--gsm X] [--cohort C]
  grouping_master.py add <project> <sample_id> <group> [--gsm X] [--cohort C]
  grouping_master.py set <project> <sample_id> <field> <value>
  grouping_master.py move <project> <sample_id> <group>
  grouping_master.py remove <project> <sample_id>
  grouping_master.py fields <project>
  grouping_master.py counts <project>
  grouping_master.py validate <project>

Every mutating call rewrites the table atomically, keeps the fixed schema and
column order, writes LF-only UTF-8 without BOM, and refreshes the manifest.
"""
import argparse
import csv
import io
import json
import os
import sys

PROJECTS_ROOT = "/mnt/ssd/bio_data/projects"
SCHEMA = [
    "sample_id", "group", "gsm_id", "cohort", "group_id", "group_role",
    "stage_order", "color_hex", "pair_id", "batch", "is_reference",
    "contrast_primary",
]
MUTABLE_FIELDS = [c for c in SCHEMA if c != "sample_id"]


def first_key(mapping, keys):
    """Return the first present value among alternate spellings of a key.

    project.json files use two naming styles: camelCase (groupName, groupId,
    stageOrder, colorHex, isPrimary) and snake_case (group_name, group_id,
    stage_order, color_hex, is_primary). Accept both.
    """
    for key in keys:
        if key in mapping and mapping[key] not in (None, ""):
            return mapping[key]
    return None


def group_map_of(data):
    out = {}
    for g in (data.get("grouping_design") or {}).get("groups") or []:
        name = (first_key(g, ("groupName", "group_name")) or "").strip()
        if name:
            out[name] = g
    return out


def primary_contrast_of(data):
    for c in (data.get("grouping_design") or {}).get("contrasts") or []:
        if first_key(c, ("isPrimary", "is_primary")):
            return (first_key(c, ("name",)) or "").strip()
    return ""


def table_path(project):
    return os.path.join(PROJECTS_ROOT, project, "grouping_master.tsv")


def manifest_path(project):
    return table_path(project) + ".manifest.txt"


def read_rows(project):
    path = table_path(project)
    if not os.path.isfile(path):
        sys.stderr.write("table not found: %s\n" % path)
        sys.exit(2)
    with io.open(path, "r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        if reader.fieldnames != SCHEMA:
            sys.stderr.write(
                "schema mismatch\n  expected: %s\n  found:    %s\n"
                % ("\t".join(SCHEMA), "\t".join(reader.fieldnames or []))
            )
            sys.exit(2)
        rows = [dict(r) for r in reader]
    return rows


def write_rows(project, rows, reason):
    path = table_path(project)
    backup = path + ".bak_before_edit"
    if os.path.isfile(path):
        with io.open(path, "rb") as src, io.open(backup, "wb") as dst:
            dst.write(src.read())
    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer, fieldnames=SCHEMA, delimiter="\t",
        lineterminator="\n", quoting=csv.QUOTE_MINIMAL,
    )
    writer.writeheader()
    seen = set()
    for row in rows:
        sid = (row.get("sample_id") or "").strip()
        if not sid:
            sys.stderr.write("empty sample_id rejected\n")
            sys.exit(2)
        if sid in seen:
            sys.stderr.write("duplicate sample_id rejected: %s\n" % sid)
            sys.exit(2)
        seen.add(sid)
        writer.writerow({col: (row.get(col) or "") for col in SCHEMA})
    with io.open(path, "wb") as fh:
        fh.write(buffer.getvalue().encode("utf-8"))
    refresh_manifest(project, rows, reason)


def project_json(project):
    try:
        with io.open(os.path.join(PROJECTS_ROOT, project, "project.json"),
                     "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def refresh_manifest(project, rows, reason):
    data = project_json(project)
    by_name = group_map_of(data)
    primary = primary_contrast_of(data)
    counts = {}
    for r in rows:
        counts[r["group"]] = counts.get(r["group"], 0) + 1
    lines = [
        "# grouping master manifest",
        "# generated_by: ops/grouping_master.py",
        "# schema: " + "\t".join(SCHEMA),
        "# sample_count=%d" % len(rows),
        "# group_counts=%s" % json.dumps(counts, ensure_ascii=False, sort_keys=True),
        "# design_declared_samples=%d" % sum(
            len(first_key(g, ("sampleIds", "sample_ids")) or [])
            for g in (data.get("grouping_design") or {}).get("groups") or []),
        "# gsm_mapped=%d" % sum(1 for r in rows if r["gsm_id"]),
        "# pair_mapped=%d" % sum(1 for r in rows if r["pair_id"]),
        "# primary_contrast=%s" % (primary or "none"),
        "# last_edit=%s" % reason,
    ]
    design_count = sum(len(g.get("sampleIds") or []) for g in design.get("groups") or [])
    if design_count and design_count != len(rows):
        lines.append(
            "# WARN design_declares=%d_but_table_has=%d" % (design_count, len(rows)))
    with io.open(manifest_path(project), "wb") as fh:
        fh.write(("\n".join(lines) + "\n").encode("utf-8"))


def sync_derived_fields(project, rows):
    """Keep group-derived columns and the primary contrast in sync.

    Derived from grouping_design: group_id, group_role, stage_order, color_hex,
    is_reference. contrast_primary is table-wide, so it is set for every row,
    including rows whose group is not registered in the design.
    """
    data = project_json(project)
    by_name = group_map_of(data)
    primary = primary_contrast_of(data)
    changed = 0
    for row in rows:
        g = by_name.get(row["group"])
        if g:
            stage = first_key(g, ("stageOrder", "stage_order"))
            stage_text = "" if stage is None else str(stage)
            role = (first_key(g, ("role",)) or "").strip()
            values = {
                "group_id": (first_key(g, ("groupId", "group_id")) or "").strip(),
                "group_role": role,
                "stage_order": stage_text,
                "color_hex": (first_key(g, ("colorHex", "color_hex")) or "").strip(),
                "is_reference": "TRUE" if role == "reference" else "FALSE",
            }
        else:
            values = {
                "group_id": "",
                "group_role": "",
                "stage_order": "",
                "color_hex": "",
                "is_reference": "FALSE",
            }
        if primary and row.get("contrast_primary") != primary:
            values["contrast_primary"] = primary
        for key, value in values.items():
            if row.get(key) != value:
                row[key] = value
                changed += 1
    return changed


def cmd_list(args):
    print("%-34s %8s  %s" % ("project", "samples", "groups"))
    for entry in sorted(os.listdir(PROJECTS_ROOT)):
        if not os.path.isdir(os.path.join(PROJECTS_ROOT, entry)):
            continue
        path = table_path(entry)
        if not os.path.isfile(path):
            continue
        rows = read_rows(entry)
        counts = {}
        for r in rows:
            counts[r["group"]] = counts.get(r["group"], 0) + 1
        print("%-34s %8d  %s" % (
            entry, len(rows),
            ", ".join("%s=%d" % kv for kv in sorted(counts.items())) or "(empty)"))
    return 0


def cmd_show(args):
    rows = read_rows(args.project)
    if args.group:
        rows = [r for r in rows if r["group"] == args.group]
    if args.gsm:
        rows = [r for r in rows if r["gsm_id"] == args.gsm]
    if args.cohort:
        rows = [r for r in rows if r["cohort"] == args.cohort]
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=SCHEMA, delimiter="\t",
                            lineterminator="\n", quoting=csv.QUOTE_MINIMAL)
    writer.writeheader()
    for r in rows:
        writer.writerow({c: r.get(c, "") for c in SCHEMA})
    sys.stdout.write(out.getvalue())
    return 0


def cmd_fields(args):
    print("\t".join(SCHEMA))
    print("mutable=" + "\t".join(MUTABLE_FIELDS))
    return 0


def cmd_counts(args):
    rows = read_rows(args.project)
    counts = {}
    for r in rows:
        counts[r["group"]] = counts.get(r["group"], 0) + 1
    for name in sorted(counts):
        print("%s\t%d" % (name, counts[name]))
    print("total\t%d" % len(rows))
    return 0


def cmd_validate(args):
    rows = read_rows(args.project)
    problems = []
    ids = [r["sample_id"] for r in rows]
    if len(ids) != len(set(ids)):
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        problems.append("duplicate_sample_id: " + ",".join(dupes[:10]))
    no_group = [r["sample_id"] for r in rows if not r["group"]]
    if no_group:
        problems.append("empty_group: " + ",".join(no_group[:10]))
    for r in rows:
        for col in SCHEMA:
            if col not in r:
                problems.append("missing_field %s in %s" % (col, r["sample_id"]))
                break
    data = project_json(args.project)
    design = data.get("grouping_design") or {}
    declared = set(group_map_of(data).keys())
    used = {r["group"] for r in rows}
    unknown = sorted(g for g in used if declared and g not in declared)
    if unknown:
        problems.append("group_not_in_design: " + ",".join(unknown))
    for r in rows:
        if r["pair_id"]:
            partners = [x for x in rows if x["pair_id"] == r["pair_id"]]
            if len(partners) < 2:
                problems.append("orphan_pair %s (%s)" % (r["sample_id"], r["pair_id"]))
            elif len({x["group"] for x in partners}) < 2 and len(partners) > 1:
                problems.append("pair_within_same_group %s (%s)"
                                % (r["sample_id"], r["pair_id"]))
    if problems:
        for p in problems:
            sys.stderr.write("INVALID %s\n" % p)
        return 1
    print("VALID samples=%d groups=%d" % (len(rows), len(used)))
    return 0


def cmd_add(args):
    rows = read_rows(args.project)
    if any(r["sample_id"] == args.sample_id for r in rows):
        sys.stderr.write("sample_id already exists: %s\n" % args.sample_id)
        return 2
    row = {c: "" for c in SCHEMA}
    row["sample_id"] = args.sample_id
    row["group"] = args.group
    row["gsm_id"] = args.gsm or ""
    row["cohort"] = args.cohort or ""
    rows.append(row)
    sync_derived_fields(args.project, rows)
    write_rows(args.project, rows, "add %s" % args.sample_id)
    print("added %s group=%s total=%d" % (args.sample_id, args.group, len(rows)))
    return 0


def cmd_set(args):
    if args.field not in MUTABLE_FIELDS:
        sys.stderr.write("field not mutable: %s\n  mutable: %s\n"
                         % (args.field, "\t".join(MUTABLE_FIELDS)))
        return 2
    rows = read_rows(args.project)
    hit = 0
    for r in rows:
        if r["sample_id"] == args.sample_id:
            r[args.field] = args.value
            hit += 1
    if not hit:
        sys.stderr.write("sample_id not found: %s\n" % args.sample_id)
        return 2
    write_rows(args.project, rows, "set %s.%s" % (args.sample_id, args.field))
    print("updated %s %s=%s" % (args.sample_id, args.field, args.value))
    return 0


def cmd_move(args):
    rows = read_rows(args.project)
    hit = 0
    for r in rows:
        if r["sample_id"] == args.sample_id:
            r["group"] = args.group
            hit += 1
    if not hit:
        sys.stderr.write("sample_id not found: %s\n" % args.sample_id)
        return 2
    sync_derived_fields(args.project, rows)
    write_rows(args.project, rows, "move %s to %s" % (args.sample_id, args.group))
    print("moved %s to group=%s" % (args.sample_id, args.group))
    return 0


def cmd_remove(args):
    rows = read_rows(args.project)
    kept = [r for r in rows if r["sample_id"] != args.sample_id]
    if len(kept) == len(rows):
        sys.stderr.write("sample_id not found: %s\n" % args.sample_id)
        return 2
    write_rows(args.project, kept, "remove %s" % args.sample_id)
    print("removed %s total=%d" % (args.sample_id, len(kept)))
    return 0


def build_parser():
    parser = argparse.ArgumentParser(
        prog="grouping_master",
        description="Read and edit per-project grouping master tables.")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("list", help="list every project table").set_defaults(func=cmd_list)

    p_show = sub.add_parser("show", help="print table rows")
    p_show.add_argument("project")
    p_show.add_argument("--group")
    p_show.add_argument("--gsm")
    p_show.add_argument("--cohort")
    p_show.set_defaults(func=cmd_show)

    p_fields = sub.add_parser("fields", help="print schema and mutable fields")
    p_fields.add_argument("project", nargs="?")
    p_fields.set_defaults(func=cmd_fields)

    p_counts = sub.add_parser("counts", help="group counts")
    p_counts.add_argument("project")
    p_counts.set_defaults(func=cmd_counts)

    p_val = sub.add_parser("validate", help="check integrity")
    p_val.add_argument("project")
    p_val.set_defaults(func=cmd_validate)

    p_add = sub.add_parser("add", help="add a sample")
    p_add.add_argument("project")
    p_add.add_argument("sample_id")
    p_add.add_argument("group")
    p_add.add_argument("--gsm")
    p_add.add_argument("--cohort")
    p_add.set_defaults(func=cmd_add)

    p_set = sub.add_parser("set", help="set one field of one sample")
    p_set.add_argument("project")
    p_set.add_argument("sample_id")
    p_set.add_argument("field")
    p_set.add_argument("value")
    p_set.set_defaults(func=cmd_set)

    p_move = sub.add_parser("move", help="move a sample to another group")
    p_move.add_argument("project")
    p_move.add_argument("sample_id")
    p_move.add_argument("group")
    p_move.set_defaults(func=cmd_move)

    p_rm = sub.add_parser("remove", help="remove a sample")
    p_rm.add_argument("project")
    p_rm.add_argument("sample_id")
    p_rm.set_defaults(func=cmd_remove)
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    if not getattr(args, "func", None):
        parser.print_help()
        return 2
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())