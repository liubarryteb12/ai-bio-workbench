#!/usr/bin/env python3
"""Fix the remaining theme_minimal blocks the bulk beautifier missed."""

from __future__ import annotations

THEME = (
    "ggplot2::theme_classic(base_size = 7) +\n"
    "  ggplot2::theme(\n"
    "    axis.text = ggplot2::element_text(colour = \"black\", size = 7),\n"
    "    axis.title = ggplot2::element_text(colour = \"black\", size = 7),\n"
    "    legend.text = ggplot2::element_text(size = 6),\n"
    "    legend.title = ggplot2::element_text(size = 6),{extra}\n"
    "  )"
)

FIXES = {
    "multi_metric_survival_roc": (
        (
            "  ggplot2::theme_minimal(base_size = 10) +\n"
            "  ggplot2::theme(\n"
            "    panel.grid.minor = ggplot2::element_blank(),\n"
            "    legend.position = \"bottom\",\n"
            "    plot.subtitle = ggplot2::element_text(color = \"#555555\")\n"
            "  )"
        ),
        '\n    legend.position = "bottom",',
    ),
    "lasso_cox_model": (
        (
            "  ggplot2::theme_minimal(base_size = 9) +\n"
            "  ggplot2::theme(\n"
            "    axis.text.x = ggplot2::element_text(angle = 90, vjust = 0.5, hjust = 1, size = 7),\n"
            "    legend.position = \"top\",\n"
            "    panel.grid.minor = ggplot2::element_blank()\n"
            "  )"
        ),
        '\n    legend.position = "top",\n'
        '    axis.text.x = ggplot2::element_text(angle = 90, vjust = 0.5, hjust = 1, size = 7),',
    ),
    "wgcna_module_trait": (
        (
            "  ggplot2::theme_minimal(base_size = 10) +\n"
            "  ggplot2::theme(\n"
            "    panel.grid = ggplot2::element_blank(),\n"
            "    plot.caption.position = \"plot\",\n"
            "    plot.caption = ggplot2::element_text(hjust = 0)\n"
            "  )"
        ),
        '\n    plot.caption.position = "plot",\n'
        '    plot.caption = ggplot2::element_text(hjust = 0),',
    ),
}


def main() -> int:
    for name, (old, extra) in FIXES.items():
        path = f"/mnt/ssd/bio_data/bin/line1_bulk/{name}"
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        if old not in text:
            print(f"SKIP {name}: pattern not found")
            continue
        text = text.replace(old, THEME.format(extra=extra))
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        print(f"OK {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
