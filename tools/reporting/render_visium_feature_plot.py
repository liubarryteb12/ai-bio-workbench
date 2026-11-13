#!/usr/bin/env python3
"""Forwarding entry point for the Visium spatial feature renderer.

The real implementation lives in render_visium_feature_plot_v2.py, which is the
single source of truth. This module forwards to it and accepts the v2 argument
set: --master, --spatial-dir, --samples, --out-dir, --genes. Prefer calling v2
directly for new work.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from render_visium_feature_plot_v2 import main  # noqa: E402


if __name__ == "__main__":
    if "--gene" in sys.argv and "--genes" not in sys.argv:
        raise SystemExit(
            "render_visium_feature_plot.py now uses --genes and --samples. "
            "See docs/SPATIAL_HE_OVERLAY_PIPELINE.md."
        )
    main()
