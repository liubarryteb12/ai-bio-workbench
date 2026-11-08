#!/usr/bin/env python3
"""Build deterministic gene-level Line 1 train/val matrices from GEO series/soft files."""

import argparse
import csv
import gzip
import hashlib
import json
import math
import os
import sys
import tempfile
from pathlib import Path


def classify_sample(title):
    value = str(title or "").strip().lower()
    if "control" in value or "healthy" in value:
        return "CTRL"
    if "stroke" in value:
        return "LS"
    return None


def metadata_values(handle):
    rows = {}
    for raw in handle:
        line = raw.rstrip("\n\r")
        if line == "!series_matrix_table_begin":
            break
        if not line.startswith("!") or "\t" not in line:
            continue
        cells = next(csv.reader([line], delimiter="\t"))
        rows[cells[0]] = cells[1:]
    return rows


def parse_series_matrix(handle):
    metadata = metadata_values(handle)
    sample_ids = metadata.get("!Sample_geo_accession", [])
    titles = metadata.get("!Sample_title", [])
    if len(sample_ids) != len(titles) or not sample_ids:
        raise ValueError("series matrix sample metadata is missing or misaligned")

    header_line = next((line for line in handle if line.strip()), "")
    header = next(csv.reader([header_line], delimiter="\t"))
    if not header or header[0] != "ID_REF":
        raise ValueError("series matrix table header must start with ID_REF")
    table_samples = header[1:]
    if table_samples != sample_ids:
        raise ValueError("series matrix table samples differ from sample metadata")

    values = {}
    for raw in handle:
        if raw.startswith("!series_matrix_table_end"):
            break
        if not raw.strip():
            continue
        cells = next(csv.reader([raw], delimiter="\t"))
        if not cells or not cells[0]:
            continue
        row = []
        for cell in cells[1:]:
            try:
                row.append(float(cell))
            except (TypeError, ValueError):
                row.append(math.nan)
        if len(row) != len(table_samples):
            raise ValueError("series matrix row width mismatch for %s" % cells[0])
        values[cells[0]] = row

    groups = {
        sample_id: classify_sample(title)
        for sample_id, title in zip(table_samples, titles)
    }
    return {
        "accession": (metadata.get("!Series_geo_accession") or [""])[0],
        "platform": (metadata.get("!Series_platform_id") or [""])[0],
        "samples": table_samples,
        "titles": dict(zip(table_samples, titles)),
        "groups": groups,
        "values": values,
    }


def parse_platform_table(handle):
    for raw in handle:
        if raw.strip() == "!platform_table_begin":
            break
    else:
        raise ValueError("missing !platform_table_begin")

    reader = csv.reader(handle, delimiter="\t")
    try:
        header = next(reader)
    except StopIteration:
        raise ValueError("empty platform table")
    id_index = 0 if header and header[0] in ("ID", "ID_REF") else -1
    gene_index = -1
    for candidate in ("Gene Symbol", "Symbol"):
        if candidate in header:
            gene_index = header.index(candidate)
            break
    if id_index < 0 or gene_index < 0:
        raise ValueError("platform table needs ID and Gene Symbol/Symbol columns")

    mapping = {}
    for row in reader:
        if not row or row[0].startswith("!platform_table_end"):
            break
        if len(row) <= max(id_index, gene_index):
            continue
        probe = row[id_index].strip()
        gene_text = row[gene_index].strip()
        if not probe or not gene_text or gene_text == "---":
            continue
        gene = gene_text.split("///", 1)[0].strip()
        if gene and gene != "---":
            mapping[probe] = gene
    return mapping


def collapse_probes(values, probe_to_gene):
    candidates = {}
    for probe, row in values.items():
        gene = probe_to_gene.get(probe)
        if not gene:
            continue
        finite = [value for value in row if math.isfinite(value)]
        if not finite:
            continue
        score = sum(finite) / len(finite)
        current = candidates.get(gene)
        if current is None or score > current[0] or (score == current[0] and probe < current[1]):
            candidates[gene] = (score, probe, row)
    return {gene: item[2] for gene, item in candidates.items()}


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None
            handle.write(text.encode("utf-8"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_gzip(path):
    with gzip.open(path, "rt", encoding="utf-8", newline="") as handle:
        yield from handle


def load_dataset(series_path, soft_path):
    series = parse_series_matrix(read_gzip(series_path))
    mapping = parse_platform_table(read_gzip(soft_path))
    genes = collapse_probes(series["values"], mapping)
    return series, genes


def write_dataset(output_dir, series, genes, sample_ids, prefix):
    output_dir.mkdir(parents=True, exist_ok=True)
    expr_path = output_dir / ("%s_expr.tsv" % prefix)
    group_path = output_dir / ("%s_groups.tsv" % prefix)
    meta_path = output_dir / ("%s_samples.tsv" % prefix)
    gene_order = sorted(genes)

    lines = ["gene\t" + "\t".join(sample_ids)]
    for gene in gene_order:
        row = [gene]
        for index in range(len(series["samples"])):
            value = genes[gene][index]
            row.append(format(value, ".17g") if math.isfinite(value) else "NA")
        lines.append("\t".join(row))
    atomic_write(expr_path, "\n".join(lines) + "\n")

    group_lines = ["sample\tgroup"]
    for sample in sample_ids:
        group_lines.append("%s\t%s" % (sample, series["groups"][sample]))
    atomic_write(group_path, "\n".join(group_lines) + "\n")

    sample_lines = ["sample\ttitle\tgroup"]
    for sample in sample_ids:
        sample_lines.append("%s\t%s\t%s" % (
            sample,
            series["titles"][sample],
            series["groups"][sample],
        ))
    atomic_write(meta_path, "\n".join(sample_lines) + "\n")
    return expr_path, group_path, meta_path


def build_benchmark(args):
    train_series, train_all = load_dataset(args.train_series, args.train_soft)
    val_series, val_all = load_dataset(args.val_series, args.val_soft)
    train_samples = [s for s in train_series["samples"] if train_series["groups"].get(s)]
    val_samples = [s for s in val_series["samples"] if val_series["groups"].get(s)]
    if not train_samples or not val_samples:
        raise ValueError("train and validation datasets both need classified samples")
    for label, series in (("train", train_series), ("validation", val_series)):
        groups = {series["groups"][sample] for sample in series["samples"] if series["groups"].get(sample)}
        if groups != {"LS", "CTRL"}:
            raise ValueError("%s dataset must contain LS and CTRL, got %s" % (label, sorted(groups)))

    common_genes = sorted(set(train_all) & set(val_all))
    if len(common_genes) < 1000:
        raise ValueError("common gene count %d is below 1000" % len(common_genes))
    train = {gene: train_all[gene] for gene in common_genes}
    val = {gene: val_all[gene] for gene in common_genes}

    train_dir = args.output / "processed" / "train"
    val_dir = args.output / "processed" / "val"
    train_expr, train_group, train_meta = write_dataset(train_dir, train_series, train, train_samples, "train")
    val_expr, val_group, val_meta = write_dataset(val_dir, val_series, val, val_samples, "val")

    manifest = {
        "schema_version": 1,
        "benchmark": "line1_stroke_external_validation",
        "train": {
            "series": train_series["accession"],
            "platform": train_series["platform"],
            "samples": len(train_samples),
            "stroke": sum(train_series["groups"][s] == "LS" for s in train_samples),
            "control": sum(train_series["groups"][s] == "CTRL" for s in train_samples),
        },
        "validation": {
            "series": val_series["accession"],
            "platform": val_series["platform"],
            "samples": len(val_samples),
            "stroke": sum(val_series["groups"][s] == "LS" for s in val_samples),
            "control": sum(val_series["groups"][s] == "CTRL" for s in val_samples),
        },
        "genes": len(common_genes),
        "inputs": {
            str(path.name): file_sha256(path)
            for path in (args.train_series, args.train_soft, args.val_series, args.val_soft)
        },
        "outputs": {
            str(path.relative_to(args.output)): file_sha256(path)
            for path in (train_expr, train_group, train_meta, val_expr, val_group, val_meta)
        },
    }
    atomic_write(
        args.output / "benchmark_manifest.json",
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )
    return manifest


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-series", type=Path, required=True)
    parser.add_argument("--train-soft", type=Path, required=True)
    parser.add_argument("--val-series", type=Path, required=True)
    parser.add_argument("--val-soft", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    inputs = (args.train_series, args.train_soft, args.val_series, args.val_soft)
    missing = [str(path) for path in inputs if not path.is_file()]
    if missing:
        print(json.dumps({"ok": False, "error": "missing inputs: " + ", ".join(missing)}))
        return 2
    try:
        manifest = build_benchmark(args)
        print(json.dumps({"ok": True, **manifest}, ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, csv.Error) as cause:
        print(json.dumps({"ok": False, "error": str(cause)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
