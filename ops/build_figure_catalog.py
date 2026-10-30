#!/usr/bin/env python3
"""Build a project-owned single-figure catalog from the delivered source package."""

import argparse
import csv
import datetime
import hashlib
import json
import re
import shutil
import sqlite3
import sys
from pathlib import Path

from PIL import Image


SELECTED_LEVELS = ("强生信", "中生信")
IMAGE_NAME_RE = re.compile(r"^(R|Python)__(.+)__(\d+)\.png$")

LICENSES = {
    "Python": {
        "code": "0BSD",
        "image": "source_site_not_separately_declared",
        "redistribution": "review_before_external_delivery",
    },
    "R": {
        "code": "MIT",
        "image": "site_terms_reference_only",
        "redistribution": "do_not_redistribute_source_image",
    },
}

MANIFEST_FIELDS = [
    "catalog_id",
    "page_id",
    "lang",
    "title",
    "plot_type",
    "family",
    "bio_level",
    "bio_tags",
    "score",
    "status",
    "page_url",
    "image_url",
    "preview_path",
    "preview_sha256",
    "width",
    "height",
    "code_path",
    "code_file_sha256",
    "source_code_sha256",
    "deps",
    "license_code",
    "license_image",
    "parent_catalog_id",
    "figure_index",
    "verification",
]

BLOCKED_STATUS_BY_FAILURE = {
    "dependency_failure": "blocked_dependency",
    "network_failure": "blocked_network",
    "code_failure": "blocked_code",
    "image_failure": "blocked_image",
    "timeout": "blocked_timeout",
}
PRESERVABLE_OUTCOMES = {
    "k40_verified",
    *BLOCKED_STATUS_BY_FAILURE.values(),
}


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def image_meta(path):
    with Image.open(path) as image:
        image.load()
        return {
            "width": image.width,
            "height": image.height,
            "sha256": sha256_file(path),
        }


def image_slug_from_url(url):
    url = url or ""
    match = re.search(r"/content/posts/([^/]+)/", url)
    if match:
        return match.group(1)
    match = re.search(r"/master/([^/]+?)(?:_files)?/figure-html/", url)
    if match:
        return match.group(1)
    return ""


def local_image_index(images_dir):
    index = {}
    for path in Path(images_dir).glob("*.png"):
        match = IMAGE_NAME_RE.match(path.name)
        if match:
            index.setdefault((match.group(1), match.group(2)), []).append(path)
    for paths in index.values():
        paths.sort(key=lambda item: item.name)
    return index


def catalog_id(lang, page_id):
    prefix = "pgg" if lang == "Python" else "rgg"
    return f"{prefix}_{int(page_id):04d}"


def python_materialized_code(entry):
    header = (
        f"# Catalog-ID: {entry['catalog_id']}\n"
        f"# Source-Page: {entry['page_url']}\n"
        f"# Source-Code-SHA256: {entry['source_code_sha256']}\n"
        "# Materialization: external seed, Agg backend, single PNG output\n"
        "import os as _os\n"
        "import numpy as _np\n"
        "import matplotlib as _mpl\n"
        "_seed = _os.environ.get('BIOANALYS_SEED')\n"
        "if not _seed:\n"
        "    raise SystemExit(3)\n"
        "_mpl.use('Agg')\n"
        "_np.random.seed(int(_seed))\n\n"
    )
    footer = (
        "\n\n# Project verification output\n"
        "import matplotlib.pyplot as _plt\n"
        "_output = _os.environ.get('BIO_FIGURE_OUTPUT')\n"
        "if not _output:\n"
        "    raise SystemExit(2)\n"
        "_plt.savefig(_output, dpi=300, bbox_inches=None)\n"
        "_plt.close('all')\n"
    )
    return header + entry["code"].rstrip() + footer


def r_materialized_code(entry):
    header = (
        f"# Catalog-ID: {entry['catalog_id']}\n"
        f"# Source-Page: {entry['page_url']}\n"
        f"# Source-Code-SHA256: {entry['source_code_sha256']}\n"
        "# Materialization: external seed contract\n"
        "if (Sys.getenv('BIOANALYS_SEED') == '') quit(status = 3)\n"
        "set.seed(as.integer(Sys.getenv('BIOANALYS_SEED')))\n\n"
    )
    return header + entry["code"].rstrip() + "\n"


def write_manifest(output_root, entries):
    with (Path(output_root) / "manifest.csv").open(
        "w", encoding="utf-8", newline=""
    ) as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=MANIFEST_FIELDS,
            lineterminator="\n",
        )
        writer.writeheader()
        for entry in entries:
            license_info = LICENSES[entry["lang"]]
            writer.writerow(
                {
                    "catalog_id": entry["catalog_id"],
                    "page_id": entry["page_id"],
                    "lang": entry["lang"],
                    "title": entry["title"],
                    "plot_type": entry["chart_type"],
                    "family": entry["family"],
                    "bio_level": entry["bio_level"],
                    "bio_tags": entry["bio_tags"],
                    "score": entry["score"],
                    "status": entry["status"],
                    "page_url": entry["page_url"],
                    "image_url": entry["image_url"] or "",
                    "preview_path": entry["preview_path"] or "",
                    "preview_sha256": entry["preview_sha256"] or "",
                    "width": entry["width"] or "",
                    "height": entry["height"] or "",
                    "code_path": entry["code_path"] or "",
                    "code_file_sha256": entry["code_file_sha256"] or "",
                    "source_code_sha256": entry["source_code_sha256"] or "",
                    "deps": entry["deps"] or "",
                    "license_code": license_info["code"],
                    "license_image": license_info["image"],
                    "parent_catalog_id": entry.get("parent_catalog_id", ""),
                    "figure_index": entry.get("figure_index", ""),
                    "verification": entry.get("verification", ""),
                }
            )


def summarize_entries(entries):
    return {
        "selected": len(entries),
        "bio_selected": sum(item.get("bio_selected", False) for item in entries),
        "generic_candidate": sum(
            item["status"] == "generic_candidate" for item in entries
        ),
        "materialized": sum(item["status"] == "materialized" for item in entries),
        "k40_verified": sum(item["status"] == "k40_verified" for item in entries),
        "blocked_dependency": sum(
            item["status"] == "blocked_dependency" for item in entries
        ),
        "blocked_network": sum(
            item["status"] == "blocked_network" for item in entries
        ),
        "blocked_code": sum(item["status"] == "blocked_code" for item in entries),
        "blocked_image": sum(item["status"] == "blocked_image" for item in entries),
        "blocked_timeout": sum(
            item["status"] == "blocked_timeout" for item in entries
        ),
        "code_ready": sum(item["status"] == "code_ready" for item in entries),
        "needs_split": sum(item["status"] == "needs_split" for item in entries),
        "image_missing": sum(item["status"] == "image_missing" for item in entries),
        "local_image_missing": sum(
            item["status"] == "local_image_missing" for item in entries
        ),
        "code_missing": sum(item["status"] == "code_missing" for item in entries),
        "split_materialized": sum(
            item["status"] == "split_materialized" for item in entries
        ),
        "split_code_ready": sum(
            item["status"] == "split_code_ready" for item in entries
        ),
    }


def apply_catalog_verification(output_root, catalog_id, evidence_dir):
    output_root = Path(output_root)
    catalog_path = output_root / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    entry = next(
        (item for item in catalog["entries"] if item["catalog_id"] == catalog_id),
        None,
    )
    if entry is None:
        raise KeyError(f"unknown catalog_id: {catalog_id}")
    evidence_dir = Path(evidence_dir)
    verification_path = evidence_dir / "verification.json"
    verification = json.loads(verification_path.read_text(encoding="utf-8"))
    if verification.get("status") != "k40_verified":
        raise ValueError("verification status must be k40_verified")
    if verification.get("exit_code") != 0 or verification.get("validation_exit") != 0:
        raise ValueError("verification did not pass")
    entry["status"] = "k40_verified"
    entry["verification_path"] = (
        verification_path.relative_to(output_root).as_posix()
    )
    entry["verification_sha256"] = sha256_file(verification_path)
    catalog["summary"] = summarize_entries(catalog["entries"])
    catalog_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    write_manifest(output_root, catalog["entries"])
    return catalog


def apply_catalog_blocked(output_root, catalog_id, failure_kind, evidence_dir):
    output_root = Path(output_root)
    status = BLOCKED_STATUS_BY_FAILURE.get(failure_kind)
    if not status:
        raise ValueError(f"unsupported failure kind: {failure_kind}")
    catalog_path = output_root / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    entry = next(
        (item for item in catalog["entries"] if item["catalog_id"] == catalog_id),
        None,
    )
    if entry is None:
        raise KeyError(f"unknown catalog_id: {catalog_id}")
    evidence_dir = Path(evidence_dir)
    verification_path = evidence_dir / "verification.json"
    verification = json.loads(verification_path.read_text(encoding="utf-8"))
    if verification.get("failure_kind") != failure_kind:
        raise ValueError("verification failure_kind does not match")
    entry["status"] = status
    entry["failure_kind"] = failure_kind
    entry["verification_path"] = (
        verification_path.relative_to(output_root).as_posix()
    )
    entry["verification_sha256"] = sha256_file(verification_path)
    catalog["summary"] = summarize_entries(catalog["entries"])
    catalog_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    write_manifest(output_root, catalog["entries"])
    return catalog


def merge_split_candidates(output_root, split_root):
    output_root = Path(output_root)
    split_root = Path(split_root)
    catalog_path = output_root / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    split_doc = json.loads(
        (split_root / "split_candidates.json").read_text(encoding="utf-8")
    )
    entries = catalog["entries"]
    by_id = {entry["catalog_id"]: entry for entry in entries}

    for record in split_doc.get("records", []):
        parent_id = record["catalog_id"]
        parent = by_id.get(parent_id)
        if parent is None:
            raise KeyError(f"parent catalog entry missing: {parent_id}")
        for candidate in record.get("candidates", []):
            index = int(candidate["figure_index"])
            new_id = f"{parent_id}__f{index:02d}"
            suffix = ".py" if record["lang"] == "Python" else ".R"
            code_source = split_root / candidate["code_path"]
            if not code_source.is_file():
                raise FileNotFoundError(code_source)
            code_rel = Path("code") / f"{new_id}{suffix}"
            code_target = output_root / code_rel
            code_target.write_bytes(code_source.read_bytes())

            preview_rel = None
            preview_sha = candidate.get("preview_sha256")
            width = candidate.get("width")
            height = candidate.get("height")
            if candidate.get("preview_path"):
                preview_source = split_root / candidate["preview_path"]
                if not preview_source.is_file():
                    raise FileNotFoundError(preview_source)
                preview_rel = Path("figures") / f"{new_id}.png"
                preview_target = output_root / preview_rel
                preview_target.write_bytes(preview_source.read_bytes())
                preview_meta = image_meta(preview_target)
                preview_sha = preview_meta["sha256"]
                width = preview_meta["width"]
                height = preview_meta["height"]

            entry = {
                "catalog_id": new_id,
                "page_id": parent.get("page_id"),
                "parent_catalog_id": parent_id,
                "figure_index": index,
                "bio_selected": parent.get("bio_selected", True),
                "lang": record["lang"],
                "title": f"{record['title']} / Figure {index}",
                "chart_type": parent.get("chart_type"),
                "family": parent.get("family"),
                "bio_tags": parent.get("bio_tags"),
                "bio_level": parent.get("bio_level"),
                "score": parent.get("score"),
                "deps": parent.get("deps"),
                "page_url": record.get("source_page") or parent.get("page_url"),
                "image_url": candidate.get("source_image_url"),
                "code_path": code_rel.as_posix(),
                "preview_path": preview_rel.as_posix() if preview_rel else None,
                "code_file_sha256": sha256_file(code_target),
                "source_code_sha256": candidate.get("source_code_sha256"),
                "preview_sha256": preview_sha,
                "width": width,
                "height": height,
                "status": (
                    "split_materialized"
                    if preview_rel
                    else "split_code_ready"
                ),
                "verification": "not_verified",
                "pilot": False,
                "suggested_template_id": None,
                "failure_kind": None,
                "code": parent.get("code", ""),
                "img_urls": candidate.get("source_image_url") or "",
            }
            if new_id in by_id:
                entries[entries.index(by_id[new_id])] = entry
            else:
                entries.append(entry)
            by_id[new_id] = entry

    catalog["summary"] = summarize_entries(entries)
    catalog_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    write_manifest(output_root, entries)
    return catalog


def classify(entry, image_paths):
    if not entry["code"].strip():
        return "code_missing", []
    if not entry["img_urls"].strip() or entry["n_img"] <= 0:
        return "image_missing", []
    if entry["n_code_blocks"] != 1 or entry["n_img"] != 1:
        return "needs_split", []
    if not image_paths:
        return "local_image_missing", []
    return "single_figure", image_paths[:1]


def build_catalog(package_root, output_root, seed=20261013):
    package_root = Path(package_root)
    output_root = Path(output_root)
    db_path = package_root / "chart_code_library.db"
    images_dir = package_root / "images"
    if not db_path.is_file():
        raise FileNotFoundError(db_path)
    if not images_dir.is_dir():
        raise FileNotFoundError(images_dir)

    code_dir = output_root / "code"
    figure_dir = output_root / "figures"
    code_dir.mkdir(parents=True, exist_ok=True)
    figure_dir.mkdir(parents=True, exist_ok=True)
    image_index = local_image_index(images_dir)
    previous_entries = {}
    previous_catalog = output_root / "catalog.json"
    if previous_catalog.is_file():
        previous = json.loads(previous_catalog.read_text(encoding="utf-8"))
        previous_entries = {
            item["catalog_id"]: item for item in previous.get("entries", [])
        }

    con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """
        SELECT id, site, lang, title, chart_type, family, bio_tags, bio_level,
               score, peer_count, n_code_blocks, code_lines, has_code, img_ok,
               n_img, syntax_ok, ext_data, deps, page_url, img_urls, desc, code
        FROM charts
        ORDER BY score DESC, id
        """
    ).fetchall()
    con.close()

    entries = []
    for row in rows:
        entry = dict(row)
        entry["page_id"] = entry["id"]
        entry["code"] = entry.get("code") or ""
        entry["img_urls"] = entry.get("img_urls") or ""
        entry["page_url"] = entry.get("page_url") or ""
        entry["source_code_sha256"] = (
            hashlib.sha256(entry["code"].encode("utf-8")).hexdigest()
            if entry["code"]
            else None
        )
        entry["catalog_id"] = catalog_id(entry["lang"], entry["id"])
        entry["bio_selected"] = entry["bio_level"] in SELECTED_LEVELS
        first_image_url = entry["img_urls"].split(";")[0] if entry["img_urls"] else ""
        slug = image_slug_from_url(first_image_url)
        image_paths = image_index.get((entry["lang"], slug), [])
        if entry["bio_selected"]:
            status, selected_images = classify(entry, image_paths)
        else:
            status, selected_images = "generic_candidate", []
        entry["status"] = status
        entry["image_url"] = first_image_url or None
        entry["code_path"] = None
        entry["preview_path"] = None
        entry["code_file_sha256"] = None
        entry["preview_sha256"] = None
        entry["width"] = None
        entry["height"] = None
        entry["pilot"] = int(entry["id"]) == 619
        entry["suggested_template_id"] = (
            "fig_l2p_manhattanplot" if int(entry["id"]) == 619 else None
        )

        if status == "single_figure":
            source_image = selected_images[0]
            suffix = ".py" if entry["lang"] == "Python" else ".R"
            code_rel = Path("code") / f"{entry['catalog_id']}{suffix}"
            preview_rel = Path("figures") / f"{entry['catalog_id']}.png"
            code_text = (
                python_materialized_code(entry)
                if entry["lang"] == "Python"
                else r_materialized_code(entry)
            )
            (output_root / code_rel).write_text(
                code_text,
                encoding="utf-8",
                newline="\n",
            )
            shutil.copy2(source_image, output_root / preview_rel)
            meta = image_meta(output_root / preview_rel)
            entry["code_path"] = code_rel.as_posix()
            entry["preview_path"] = preview_rel.as_posix()
            entry["code_file_sha256"] = sha256_file(output_root / code_rel)
            entry["preview_sha256"] = meta["sha256"]
            entry["width"] = meta["width"]
            entry["height"] = meta["height"]
            entry["status"] = (
                "materialized" if entry["lang"] == "Python" else "code_ready"
            )

        previous = previous_entries.get(entry["catalog_id"])
        if (
            previous
            and entry["bio_selected"]
            and previous.get("status") in PRESERVABLE_OUTCOMES
            and previous.get("source_code_sha256") == entry["source_code_sha256"]
        ):
            verification_rel = previous.get("verification_path")
            verification_path = (
                output_root / verification_rel if verification_rel else None
            )
            if verification_path and verification_path.is_file():
                entry["status"] = previous["status"]
                if previous.get("failure_kind"):
                    entry["failure_kind"] = previous["failure_kind"]
                entry["verification_path"] = verification_rel
                entry["verification_sha256"] = sha256_file(verification_path)

        entries.append(entry)

    page_by_id = {item["catalog_id"]: item for item in entries}
    for previous in previous_entries.values():
        parent_id = previous.get("parent_catalog_id")
        if not parent_id:
            continue
        parent = page_by_id.get(parent_id)
        if (
            parent
            and previous.get("source_code_sha256")
            == parent.get("source_code_sha256")
            and previous.get("status")
            in {"split_materialized", "split_code_ready"}
        ):
            entries.append(previous)

    summary = summarize_entries(entries)
    report = {
        "schema_version": 1,
        "generated_at": datetime.datetime.now().astimezone().isoformat(
            timespec="seconds"
        ),
        "source_package": package_root.as_posix(),
        "seed_contract": seed,
        "selection": {"bio_levels": list(SELECTED_LEVELS)},
        "summary": summary,
        "entries": entries,
    }

    (output_root / "catalog.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    (output_root / "licenses.json").write_text(
        json.dumps(LICENSES, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    write_manifest(output_root, entries)

    pilot = next((item for item in entries if item.get("pilot")), None)
    pilot_line = (
        f"Pilot: `{pilot['catalog_id']}` status=`{pilot['status']}`\n"
        if pilot
        else ""
    )
    (output_root / "README.md").write_text(
        "# Project Figure Catalog\n\n"
        "This directory is the project-owned candidate catalog. It is not the active "
        "figure registry.\n\n"
        f"Summary: `{json.dumps(summary, ensure_ascii=False, sort_keys=True)}`\n"
        f"{pilot_line}\n"
        "- `catalog.json` is the machine-readable single-figure catalog.\n"
        "- `manifest.csv` is the human-readable index.\n"
        "- `code/` contains materialized code candidates.\n"
        "- `figures/` contains single-image previews.\n"
        "- Entries with status `k40_verified`, `code_ready`, or blocked outcomes may retain local files for review.\n"
        "- `split_materialized` and `split_code_ready` are figure-level split candidates, not verified templates.\n"
        "- `needs_split` entries are page-level records and must not be used as single figures.\n",
        encoding="utf-8",
        newline="\n",
    )
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--package-root",
        type=Path,
        default=Path("reference/05.可参考出图代码/图码对应库_交付包"),
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("reference/05.可参考出图代码/library"),
    )
    parser.add_argument("--seed", type=int, default=20261013)
    args = parser.parse_args(argv)
    report = build_catalog(args.package_root, args.output_root, seed=args.seed)
    print(
        json.dumps(
            {
                "catalog": str(args.output_root / "catalog.json"),
                "summary": report["summary"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
