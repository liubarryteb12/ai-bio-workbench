#!/bin/sh
# S28 §6 待归因台账排查：远端只读 dump（不改数据）
cd /mnt/ssd/bio_data/system_logs || exit 1
for f in 2026-10-20_default_line2_scrna_gsva_pathways_af52f80e.json 2026-10-20_default_line2_scrna_gsva_pathways_d657656f.json 2026-10-20_default_line2_scrna_gsva_pathways_25d51e17.json 2026-10-20_default_line2_scrna_gsva_pathways_c2cc6e68.json; do
  echo "===== $f"
  python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
for k,v in d.items():
    print(' ',k,'=',str(v)[:220])
" "$f"
done
echo '===== md5 of shipped ops step script (gsva) ====='
md5sum /mnt/ssd/bio_data/bin/line2_scrna/gsva_pathways 2>/dev/null
echo '===== any node/python processes ====='
ps -eo pid,lstart,cmd 2>/dev/null | grep -Ei 'node|python|Rscript' | grep -v grep | head -20
