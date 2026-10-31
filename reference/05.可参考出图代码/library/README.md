# Project Figure Catalog

This directory is the project-owned candidate catalog. It is not the active figure registry.

Summary: `{"bio_selected": 252, "blocked_code": 4, "blocked_dependency": 17, "blocked_image": 0, "blocked_network": 8, "blocked_timeout": 0, "code_missing": 0, "code_ready": 0, "generic_candidate": 438, "image_missing": 28, "k40_verified": 16, "local_image_missing": 0, "materialized": 0, "needs_split": 179, "selected": 772, "split_code_ready": 59, "split_materialized": 23}`
Pilot: `pgg_0619` status=`k40_verified`

- `catalog.json` is the machine-readable single-figure catalog.
- `manifest.csv` is the human-readable index.
- `code/` contains materialized code candidates.
- `figures/` contains single-image previews.
- Entries with status `k40_verified`, `code_ready`, or blocked outcomes may retain local files for review.
- `needs_split` entries are page-level records and must not be used as single figures.
