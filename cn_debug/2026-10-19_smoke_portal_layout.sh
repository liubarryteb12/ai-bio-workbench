#!/usr/bin/env bash
# 冒烟：用户端 8080 两档排版（4:3 / 16:9）能否真正提交并落盘成包
# 只打 /health + /api/submit，不碰工作台 8787；产出的冒烟包联调后即删。
set -uo pipefail
BASE=http://127.0.0.1:8080
ROOT="D:/00.AIagent/codespace/AI辅助生信分析流程工作台"
fail=0

echo "=== 0) 服务在线 ==="
curl -s -m 5 "$BASE/health" | head -c 200; echo

for TPL in template_4x3 template_16x9; do
  echo "=== $TPL 提交 ==="
  sid="smk$(date +%s)${RANDOM}"
  body=$(cat <<JSON
{
  "manifest_version": "1.0",
  "basicInfo": {"name": "冒烟_排版_$TPL", "description": "两档排版提交冒烟（联调后删除）",
                "domain": "皮肤与免疫外炎症", "disease": "Psoriasis", "species": "Homo sapiens",
                "nonTumorVerified": true},
  "dataSource": {"dataType": "microarray", "sampleCount": 2, "tissue": "Skin",
                 "species": "Homo sapiens", "data_source_mode": "PUBLIC_DB", "source": "GEO",
                 "datasets": [{"gse": "GSE277173", "gpl": "GPL11532", "role": "train"}]},
  "groupingDesign": {"mode": "two_group", "groups": [], "contrasts": []},
  "plotLayoutConfig": {"templateId": "$TPL"},
  "references": [],
  "dataFiles": [],
  "notes": "smoke"
}
JSON
)
  resp=$(curl -s -m 10 -X POST "$BASE/api/submit" -H 'Content-Type: application/json' -d "$body")
  echo "resp: $resp"
  pkg=$(echo "$resp" | python -c "import json,sys; d=json.load(sys.stdin); print(d.get('savedAs',''))" 2>/dev/null)
  if [ -z "$pkg" ]; then echo "FAIL $TPL 未返回 savedAs"; fail=1; continue; fi
  req="$ROOT/portal/inbox/$pkg/requirement.json"
  man="$ROOT/portal/inbox/$pkg/package_manifest.json"
  if [ ! -f "$req" ] || [ ! -f "$man" ]; then echo "FAIL $TPL 包内文件缺失"; fail=1; continue; fi
  got=$(python -c "
import json; d=json.load(open(r'$req',encoding='utf-8'))
print((d.get('plotLayoutConfig') or {}).get('templateId'))
")
  echo "落盘 templateId = $got"
  [ "$got" = "$TPL" ] || { echo "FAIL $TPL 落盘值与提交不一致"; fail=1; }
  # 冒烟包即删（自己的产物，不留在客户 inbox）
  rm -rf "$ROOT/portal/inbox/$pkg"
  echo "已清理冒烟包 $pkg"
done

echo "=== inbox 现状（应无 PKG_ 冒烟残留）==="
ls "$ROOT/portal/inbox" | head -10
echo "SMOKE_EXIT=$fail"
