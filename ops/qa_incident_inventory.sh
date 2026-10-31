#!/usr/bin/env bash
set -euo pipefail
for p in /mnt/ssd/bio_data/local_projects/qa_a /mnt/ssd/bio_data/local_projects/qa_b /mnt/ssd/bio_data/con_hf/ledger; do
  ls -ld -- "$p"
  for f in "$p"/*; do if [ -f "$f" ]; then stat -c '%s %n' -- "$f"; sha256sum -- "$f"; fi; done
done
for f in /mnt/ssd/bio_data/local_projects/qa_a/project.json /mnt/ssd/bio_data/local_projects/qa_b/project.json; do printf '\nCONTENT %s\n' "$f"; cat -- "$f"; done
if command -v node; then node --version; fi
for f in /mnt/ssd/bio_data/BioanalysDesktop/server/task.js /mnt/ssd/bio_data/BioanalysDesktop/tests/task.test.js; do if [ -f "$f" ]; then printf 'EXISTS %s\n' "$f"; else printf 'MISSING %s\n' "$f"; fi; done
