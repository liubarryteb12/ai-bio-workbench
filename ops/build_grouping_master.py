#!/usr/bin/env python3
"""Build a per-project grouping master table.

Schema (fixed column order):
  sample_id, group, gsm_id, cohort, group_id, group_role, stage_order,
  color_hex, pair_id, batch, is_reference, contrast_primary

The first two columns are deliberately named sample_id and group so that every
pipeline script can consume this file directly through --groups.
"""
import csv
import io
import json
import os
import shutil
import sys

PROJECTS_ROOT = "/mnt/ssd/bio_data/projects"
SCHEMA = [
    "sample_id", "group", "gsm_id", "cohort", "group_id", "group_role",
    "stage_order", "color_hex", "pair_id", "batch", "is_reference",
    "contrast_primary",
]
SKIP_DIRS = {"_archive"}


def read_tsv(path):
    with io.open(path, "r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        return list(reader), reader.fieldnames or []


def load_json(path):
    try:
        with io.open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def first_key(mapping, keys):
    """Return the first present value among alternate spellings of a key.

    project.json files in this workspace use two naming styles: camelCase
    (groupName, groupId, stageOrder, colorHex, isPrimary) and snake_case
    (group_name, group_id, stage_order, color_hex, is_primary). Accept both.
    """
    for key in keys:
        if key in mapping and mapping[key] not in (None, ""):
            return mapping[key]
    return None


def design_meta(project):
    design = (project or {}).get("grouping_design") or {}
    groups = design.get("groups") or []
    by_name = {}
    for g in groups:
        name = (first_key(g, ("groupName", "group_name")) or "").strip()
        meta = {
            "group_id": (first_key(g, ("groupId", "group_id")) or "").strip(),
            "group_role": (first_key(g, ("role",)) or "").strip(),
            "stage_order": first_key(g, ("stageOrder", "stage_order")),
            "color_hex": (first_key(g, ("colorHex", "color_hex")) or "").strip(),
        }
        if name:
            by_name[name] = meta
    primary = ""
    for c in design.get("contrasts") or []:
        if first_key(c, ("isPrimary", "is_primary")):
            primary = (first_key(c, ("name",)) or "").strip()
            break
    exp = (project or {}).get("experimental_design") or {}
    return by_name, primary, bool(exp.get("is_paired")), exp


def parse_grouping_wide(path):
    """Parse a wide Chinese-header file carrying both label and GSM id."""
    mapping = {}
    try:
        with io.open(path, "r", encoding="utf-8", newline="") as fh:
            lines = [ln.rstrip("\n").rstrip("\r") for ln in fh if ln.strip()]
    except Exception:
        return mapping
    if len(lines) < 2:
        return mapping
    header = lines[0].split("\t")

    def find_col(target):
        normalized = [h.replace(" ", "") for h in header]
        for key in (target, target.replace(" ", "")):
            if key in header:
                return header.index(key)
            if key in normalized:
                return normalized.index(key)
        return None

    gsm_idx = find_col("GSM编号")
    label_idx = find_col("样本标签")
    if gsm_idx is None or label_idx is None:
        return mapping
    for line in lines[1:]:
        parts = line.split("\t")
        if len(parts) <= max(gsm_idx, label_idx):
            continue
        gsms = [x.strip() for x in parts[gsm_idx].split(",") if x.strip()]
        labels = [x.strip() for x in parts[label_idx].split(",") if x.strip()]
        if len(gsms) != len(labels):
            continue
        for gsm, label in zip(gsms, labels):
            mapping[label] = gsm
    return mapping


def collect_rows(project_dir):
    """Collect sample/group rows from every available source, deduplicated."""
    rows = []
    sources = []
    seen = set()

    top_map = os.path.join(project_dir, "line1_bulk", "processed", "group_map.tsv")
    if os.path.isfile(top_map):
        recs, fields = read_tsv(top_map)
        sample_field = "sample" if "sample" in fields else fields[0]
        group_field = "group" if "group" in fields else fields[-1]
        for rec in recs:
            sid = (rec.get(sample_field) or "").strip()
            if not sid or sid in seen:
                continue
            seen.add(sid)
            rows.append({
                "sample_id": sid,
                "group": (rec.get(group_field) or "").strip(),
                "cohort": (rec.get("dataset") or "").strip(),
            })
        if rows:
            sources.append("top_level_group_map:%d" % len(rows))

    processed = os.path.join(project_dir, "line1_bulk", "processed")
    if os.path.isdir(processed):
        for entry in sorted(os.listdir(processed)):
            cohort_map = os.path.join(processed, entry, "group_map.tsv")
            if not os.path.isfile(cohort_map):
                continue
            recs, fields = read_tsv(cohort_map)
            if not recs:
                continue
            sample_field = "sample" if "sample" in fields else fields[0]
            group_field = "group" if "group" in fields else fields[-1]
            added = 0
            for rec in recs:
                sid = (rec.get(sample_field) or "").strip()
                if not sid or sid in seen:
                    continue
                seen.add(sid)
                rows.append({
                    "sample_id": sid,
                    "group": (rec.get(group_field) or "").strip(),
                    "cohort": (rec.get("dataset") or entry).strip(),
                })
                added += 1
            if added:
                sources.append("cohort_%s:%d" % (entry, added))

    if not rows:
        raw = os.path.join(project_dir, "line1_bulk", "raw_data", "grouping.txt")
        if os.path.isfile(raw):
            with io.open(raw, "r", encoding="utf-8", newline="") as fh:
                for line in fh:
                    parts = line.rstrip("\n").rstrip("\r").split("\t")
                    if len(parts) >= 2:
                        sid = parts[0].strip()
                        if sid and sid not in seen:
                            seen.add(sid)
                            rows.append({
                                "sample_id": sid,
                                "group": parts[1].strip(),
                                "cohort": "",
                            })
            if rows:
                sources.append("raw_grouping_headerless:%d" % len(rows))
    return rows, sources


def build_for_project(project_dir, report):
    name = os.path.basename(project_dir.rstrip("/"))
    project = load_json(os.path.join(project_dir, "project.json"))
    by_name, primary, paired, exp = design_meta(project)
    pair_map = (exp.get("pair_map") or {}) if paired else {}
    batch_col = ((exp.get("cov") or {}).get("batch_col") or "").strip()

    gsm_mapping = {}
    raw_root = os.path.join(project_dir, "line1_bulk", "raw_data")
    if os.path.isdir(raw_root):
        candidates = [os.path.join(raw_root, "grouping.txt")]
        for entry in sorted(os.listdir(raw_root)):
            sub = os.path.join(raw_root, entry)
            if not os.path.isdir(sub):
                continue
            for base in ("grouping_master.txt", "grouping.txt"):
                candidates.append(os.path.join(sub, base))
        for candidate in candidates:
            if os.path.isfile(candidate):
                gsm_mapping.update(parse_grouping_wide(candidate))

    rows, sources = collect_rows(project_dir)
    out_rows = []
    for row in rows:
        meta = by_name.get(row["group"], {})
        stage = meta.get("stage_order")
        role = meta.get("group_role", "")
        gsm_id = gsm_mapping.get(row["sample_id"], "")
        pair_id = pair_map.get(row["sample_id"], "")
        if not pair_id and gsm_id:
            pair_id = pair_map.get(gsm_id, "")
        if batch_col in ("dataset", "cohort"):
            batch_value = row.get("cohort", "")
        else:
            batch_value = (row.get(batch_col, "") if batch_col else "")
        out_rows.append({
            "sample_id": row["sample_id"],
            "group": row["group"],
            "gsm_id": gsm_id,
            "cohort": row.get("cohort", ""),
            "group_id": meta.get("group_id", ""),
            "group_role": role,
            "stage_order": "" if stage is None else str(stage),
            "color_hex": meta.get("color_hex", ""),
            "pair_id": pair_id,
            "batch": batch_value,
            "is_reference": "TRUE" if role == "reference" else "FALSE",
            "contrast_primary": primary,
        })

    group_counts = {}
    for out_row in out_rows:
        group_counts[out_row["group"]] = group_counts.get(out_row["group"], 0) + 1

    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer, fieldnames=SCHEMA, delimiter="\t",
        lineterminator="\n", quoting=csv.QUOTE_MINIMAL,
    )
    writer.writeheader()
    for out_row in out_rows:
        writer.writerow(out_row)
    payload = buffer.getvalue().encode("utf-8")

    out_path = os.path.join(project_dir, "grouping_master.tsv")
    if os.path.isfile(out_path):
        backup = out_path + ".bak_before_rebuild"
        if not os.path.isfile(backup):
            shutil.copy2(out_path, backup)
    with io.open(out_path, "wb") as fh:
        fh.write(payload)

    design_count = sum(
        len(first_key(g, ("sampleIds", "sample_ids")) or [])
        for g in ((project or {}).get("grouping_design") or {}).get("groups") or []
    )
    manifest = [
        "# grouping master manifest",
        "# generated_by: ops/build_grouping_master.py",
        "# schema: " + "\t".join(SCHEMA),
        "# sample_count=%d" % len(out_rows),
        "# group_counts=%s" % json.dumps(group_counts, ensure_ascii=False, sort_keys=True),
        "# design_declared_samples=%d" % design_count,
        "# gsm_mapped=%d" % sum(1 for r in out_rows if r["gsm_id"]),
        "# pair_mapped=%d" % sum(1 for r in out_rows if r["pair_id"]),
        "# paired_design=%s" % ("TRUE" if paired else "FALSE"),
        "# primary_contrast=%s" % (primary or "none"),
        "# sources=%s" % (",".join(sources) or "none"),
    ]
    if design_count and design_count != len(out_rows):
        manifest.append(
            "# WARN design_declares=%d_but_table_has=%d_union_of_cohort_maps_exceeds_design_registry"
            % (design_count, len(out_rows))
        )
    if batch_col:
        manifest.append(
            "# batch_col_declared=%s batch_filled=%d"
            % (batch_col, sum(1 for r in out_rows if r["batch"]))
        )
    if not out_rows:
        manifest.append("# NOTE no grouping source found; header-only table awaiting curation")
    # Manifest goes to its own file. Embedding it as comment lines inside the
    # table would break every downstream reader, because read.table treats the
    # '#' rows as data and fails on the column count.
    with io.open(out_path + ".manifest.txt", "wb") as fh:
        fh.write(("\n".join(manifest) + "\n").encode("utf-8"))

    report.append({
        "project": name,
        "samples": len(out_rows),
        "groups": group_counts,
        "sources": sources,
        "gsm_mapped": sum(1 for r in out_rows if r["gsm_id"]),
        "paired": paired,
        "pair_mapped": sum(1 for r in out_rows if r["pair_id"]),
        "primary_contrast": primary,
        "has_design": bool(by_name),
        "batch_col": batch_col,
        "batch_filled": sum(1 for r in out_rows if r["batch"]),
        "design_sample_count": design_count,
        "path": out_path,
    })
    return out_path


def main():
    report = []
    for entry in sorted(os.listdir(PROJECTS_ROOT)):
        if entry in SKIP_DIRS:
            continue
        project_dir = os.path.join(PROJECTS_ROOT, entry)
        if not os.path.isdir(project_dir):
            continue
        if not os.path.isfile(os.path.join(project_dir, "project.json")):
            print("SKIP_NO_PROJECT_JSON %s" % entry)
            continue
        build_for_project(project_dir, report)

    print("=== grouping master build summary ===")
    for item in report:
        print("project=%s samples=%d design_meta=%s sources=%s"
              % (item["project"], item["samples"],
                 "yes" if item["has_design"] else "no",
                 ",".join(item["sources"]) or "none"))
        print("  groups=%s gsm_mapped=%d/%d paired=%s pair_mapped=%d contrast=%s"
              % (json.dumps(item["groups"], ensure_ascii=False),
                 item["gsm_mapped"], item["samples"], item["paired"],
                 item["pair_mapped"], item["primary_contrast"] or "none"))
        if item["batch_col"]:
            print("  batch_col=%s filled=%d" % (item["batch_col"], item["batch_filled"]))
        if item["design_sample_count"] and item["design_sample_count"] != item["samples"]:
            print("  WARN design_declares=%d table_has=%d"
                  % (item["design_sample_count"], item["samples"]))
    total = sum(item["samples"] for item in report)
    print("projects_built=%d total_samples=%d" % (len(report), total))
    return 0


if __name__ == "__main__":
    sys.exit(main())