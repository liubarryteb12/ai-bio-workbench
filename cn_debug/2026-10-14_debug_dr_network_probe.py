import ast
import pandas as pd

P = "/mnt/ssd/bio_data/projects/default/line2_scrna/processed"

reg = pd.read_csv(P + "/scenic_regulons.csv", index_col=[0, 1], header=[0, 1])
print("reg shape:", reg.shape)
print("has TargetGenes:", ("Enrichment", "TargetGenes") in reg.columns)
raw = reg.iloc[0][("Enrichment", "TargetGenes")]
print("raw type:", type(raw).__name__)
print("raw sample:", str(raw)[:200])

ok = 0
bad = 0
all_targets = set()
for (tf, _), row in reg.iterrows():
    v = row[("Enrichment", "TargetGenes")]
    try:
        ts = [str(t[0]) for t in ast.literal_eval(v)]
        ok += 1
        all_targets.update(ts)
    except Exception as e:
        bad += 1
        if bad <= 3:
            print("  parse fail:", str(v)[:120], "->", str(e)[:60])
print("parsed regulons:", ok, "failed:", bad)
print("total unique targets:", len(all_targets))
print("sample targets:", sorted(all_targets)[:15])

dr = pd.read_csv(P + "/ko_dr_genes.tsv", sep="\t")
dr = dr[~dr["is_knockout_gene"].astype(bool)].dropna(subset=["Z"])
top = dr.sort_values("adjusted p-value").head(60)["Gene"].astype(str).tolist()
print("top60 DR sample:", top[:15])
print("overlap top60DR ∩ targets:", len(set(top) & all_targets))
print("overlap allDR ∩ targets:", len(set(dr["Gene"].astype(str)) & all_targets))
