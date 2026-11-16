# L3 figure provenance

The project-aligned figures are rendered by `scripts/line3_spatial/align_project_figures.py` from `processed/deconv_mouse.h5ad` and `processed/localization_mouse.h5ad`.

`l3_mouse_03_ko_dr_*` and `l3_mouse_09_ko_dr_by_domain` use spot-level KO values projected onto the project 47-domain labels. `l3_mouse_05` and `l3_mouse_10..13` remain legacy master-branch summaries and must not be described as project 47-domain results.

`l3_mouse_16_domain_panel` is retired. Production figures are single-argument
figures only, so the composite domain panel is no longer produced or shipped.
