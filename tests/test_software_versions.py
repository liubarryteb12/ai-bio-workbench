#!/usr/bin/env python3
"""Keep the documented Python package versions aligned with the line-2 lock file."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs" / "software_versions.json"
MANIFEST = REPO / "src" / "line2_scrna" / "envs" / "manifest.txt"


def normalized_name(name: str) -> str:
    """Apply the PEP 503 package-name normalization used by Python packaging."""
    return re.sub(r"[-_.]+", "-", name).lower()


def read_manifest() -> dict[str, str]:
    packages: dict[str, str] = {}
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name, version = stripped.split("=", 1)
        packages[normalized_name(name)] = version.strip()
    return packages


class SoftwareVersionConsistencyTest(unittest.TestCase):
    def test_common_python_packages_match_the_manifest(self) -> None:
        document = json.loads(DOCS.read_text(encoding="utf-8"))
        documented = {
            normalized_name(package["name"]): package
            for package in document["packages"]
            if package.get("language") == "Python"
            and package.get("installed") is True
            and package.get("version")
        }
        manifest = read_manifest()
        common = sorted(set(documented) & set(manifest))

        self.assertLessEqual(
            {"numpy", "harmonypy", "pillow"},
            set(common),
            "version drift test must cover the three known drift packages",
        )
        mismatches = {
            name: (documented[name]["version"], manifest[name])
            for name in common
            if documented[name]["version"] != manifest[name]
        }
        self.assertEqual({}, mismatches, f"documented versions differ from {MANIFEST}")


if __name__ == "__main__":
    unittest.main()
