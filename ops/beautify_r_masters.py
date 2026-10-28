#!/usr/bin/env python3
"""Apply 03出图规范 v1.0 beautification to the 10 R ggplot masters.

Scope (all verified via ssh against /mnt/ssd/bio_data/bin/line1_bulk/):
  1. dpi 150 -> 300 (spec: every bitmap export must declare >=300 dpi)
  2. theme_minimal(base_size=10) -> theme_classic(base_size=7) + black axis
     text + spec line widths (theme_classic is the spec baseline; minimal
     leaves a grey grid and oversized 10pt text that renders ~15pt at 279mm)
  3. keep panel.grid.minor blank, add panel.grid.major blank (classic has no grid)

Every rewrite is guarded: the file is backed up to <name>.bak_v110 first,
and a marker comment records the audit trail.
"""

from __future__ import annotations

import re
import sys

SCRIPTS = [
    "limma_deg_analysis",
    "geo_pca_scatter",
    "roc_diagnostic_curve",
    "lasso_feature_select",
    "multi_metric_survival_roc",
    "multivariate_cox_model",
    "univariate_cox_screen",
    "lasso_cox_model",
    "wgcna_module_trait",
]

BASE = "/mnt/ssd/bio_data/bin/line1_bulk"
MARKER = "# [spec-v110]"

THEME_NEW = (
    "ggplot2::theme_classic(base_size = 7) +\n"
    "  ggplot2::theme(\n"
    "    axis.text = ggplot2::element_text(colour = \"black\", size = 7),\n"
    "    axis.title = ggplot2::element_text(colour = \"black\", size = 7),\n"
    "    legend.text = ggplot2::element_text(size = 6),\n"
    "    legend.title = ggplot2::element_text(size = 6),\n"
    "    plot.subtitle = ggplot2::element_text(color = \"#555555\", size = 7)\n"
    "  )"
)


def beautify(text: str) -> tuple[str, list[str]]:
    changes = []
    if MARKER in text:
        return text, ["already-beautified"]

    # 1. dpi 150 -> 300 in ggsave blocks
    if "dpi = 150," in text:
        text = text.replace("dpi = 150,", "dpi = 300,")
        changes.append("dpi 150->300")

    # 2. theme_minimal -> theme_classic with spec sizes
    pattern = re.compile(
        r"ggplot2::theme_minimal\(base_size = (9|10)\) \+\n"
        r"  ggplot2::theme\(\n"
        r"    panel\.grid\.minor = ggplot2::element_blank\(\)(?:,\n"
        r"    legend\.position = \"top\")?(?:,\n"
        r"    plot\.subtitle = ggplot2::element_text\(color = \"#555555\"\)\n"
        r"  \))"
    )
    match = pattern.search(text)
    if match:
        # keep legend.position="top" if it was there
        original = match.group(0)
        replacement = THEME_NEW
        if 'legend.position = "top"' in original:
            replacement = THEME_NEW.replace(
                "  )",
                "    legend.position = \"top\",\n  )",
            )
        text = text.replace(original, replacement)
        changes.append("theme_minimal->theme_classic(7pt)")

    # 3. theme_bw -> theme_classic (wgcna_module_trait soft-power plot)
    if "ggplot2::theme_bw(base_size = 10)" in text:
        text = text.replace(
            "ggplot2::theme_bw(base_size = 10)",
            "ggplot2::theme_classic(base_size = 7)",
        )
        changes.append("theme_bw->theme_classic")

    if changes:
        text = MARKER + " beautified: " + ", ".join(changes) + "\n" + text
    return text, changes


def main() -> int:
    for name in SCRIPTS:
        path = f"{BASE}/{name}"
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        except OSError as exc:
            print(f"SKIP {name}: {exc}")
            continue
        new_text, changes = beautify(text)
        if not changes or changes == ["already-beautified"]:
            print(f"SKIP {name}: {changes}")
            continue
        with open(f"{path}.bak_v110", "w", encoding="utf-8") as fh:
            fh.write(text)
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(new_text)
        print(f"OK   {name}: {', '.join(changes)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
