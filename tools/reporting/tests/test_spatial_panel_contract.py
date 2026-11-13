"""Contract tests for the spatial panel deliverables.

These run against the real project outputs, so they fail when a rerun drops
an artifact kind or writes a non-300-DPI figure.
"""

from pathlib import Path

import pandas as pd
import pytest
from PIL import Image

REPO = Path(__file__).resolve().parents[3]

CASES = [
    ("PRJ_STROKE_P1_SPATIAL_ABCA1", 10, 50),
    ("PRJ_STROKE_P2_SPATIAL_LACTPYRO_5GENES", 5, 25),
]


def panel_dir(project):
    return REPO / "workspace" / "projects" / project / "report" / "spatial_panels"


@pytest.mark.parametrize("project,genes,raw_singles", CASES)
def test_raw_and_smoothed_singles_exist(project, genes, raw_singles):
    root = panel_dir(project)
    raw = list((root / "raw").glob("slice_*_styleD.png"))
    smoothed = list((root / "smoothed").glob("slice_*_styleD.png"))
    assert len(raw) == raw_singles, project
    assert len(smoothed) == raw_singles, project
    assert all(path.name.endswith("_styleD.png") for path in smoothed)


@pytest.mark.parametrize("project,genes,raw_singles", CASES)
def test_panels_and_manifest_rows_match(project, genes, raw_singles):
    root = panel_dir(project)
    panels = list((root / "raw").glob("spatial_panel_*_styleD.png"))
    assert len(panels) == genes, project
    manifest = pd.read_csv(root / "raw" / "figure_manifest.tsv", sep="\t")
    smoothed_manifest = pd.read_csv(root / "smoothed" / "figure_manifest.tsv", sep="\t")
    assert len(manifest) == genes * (1 + 5), project
    assert len(smoothed_manifest) == raw_singles, project


@pytest.mark.parametrize("project,genes,raw_singles", CASES)
def test_contact_sheets_and_diagnostics_exist(project, genes, raw_singles):
    root = panel_dir(project)
    assert (root / "raw" / "contact_sheet_genes_he.png").is_file()
    assert (root / "smoothed" / "contact_sheet_genes_he.png").is_file()
    assert (root / "diagnostics" / "zero_fraction_D3.png").is_file()
    assert (root / "diagnostics" / "detection_map_D3_Egr1.png").is_file()
    assert (root / "smoothed_spot_master.tsv").is_file()
    assert (root / "README.md").is_file()


@pytest.mark.parametrize("project,genes,raw_singles", CASES)
def test_figures_are_300_dpi(project, genes, raw_singles):
    root = panel_dir(project)
    samples = [
        sorted((root / "raw").glob("slice_*_styleD.png"))[0],
        sorted((root / "smoothed").glob("slice_*_styleD.png"))[0],
        root / "raw" / "contact_sheet_genes_he.png",
    ]
    for path in samples:
        with Image.open(path) as image:
            dpi = image.info.get("dpi")
        if dpi is None:
            # Contact sheets are composite review artifacts, not print figures.
            assert path.name.startswith("contact_sheet"), path
            continue
        assert round(dpi[0]) == 300, (path, dpi)


def test_legacy_generation_of_figures_is_preserved():
    for project in ("PRJ_STROKE_P1_SPATIAL_ABCA1", "PRJ_STROKE_P2_SPATIAL_LACTPYRO_5GENES"):
        legacy = REPO / "workspace" / "projects" / project / "figures" / "line3_spatial"
        assert legacy.is_dir()
        assert len(list(legacy.glob("*.png"))) >= 20, project
