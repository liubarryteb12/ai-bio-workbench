import gzip
import io
import sys

SRC = "GSE30528_family.soft.gz"
DST = "GPL571.annot.tsv"

with gzip.open(SRC, "rt", encoding="utf-8", errors="replace") as fh:
    in_platform = False
    in_table = False
    header = None
    n_rows = 0
    n_symbol = 0
    out = io.StringIO()
    out.write("ID\tgene_assignment\n")
    for line in fh:
        line = line.rstrip("\n")
        if line.startswith("^PLATFORM"):
            in_platform = True
            continue
        if in_platform and line.startswith("!platform_table_begin"):
            in_table = True
            header = None
            continue
        if in_platform and line.startswith("!platform_table_end"):
            in_table = False
            in_platform = False
            continue
        if in_table and line.startswith("#"):
            continue
        if in_table and header is None and line.startswith("ID\t"):
            header = [c.strip('"') for c in line.split("\t")]
            continue
        if in_table and header is None and line.startswith("!") or (in_table and header is None and line.startswith('"')):
            if header is None and line.startswith('"ID"'):
                header = [c.strip('"') for c in line.split("\t")]
                continue
        if in_table and header is not None and line.strip():
            cells = [c.strip('"') for c in line.split("\t")]
            if len(cells) != len(header):
                continue
            row = dict(zip(header, cells))
            spot_id = row.get("ID", "")
            if not spot_id:
                continue
            gb = row.get("GB_ACC", "") or "---"
            symbol = row.get("Gene Symbol", "") or "---"
            title = row.get("Gene Title", "") or ""
            entrez = row.get("ENTREZ_GENE_ID", "") or row.get("Entrez Gene", "") or ""
            parts = [gb, symbol, title]
            if entrez:
                parts.append(entrez)
            gene_assignment = " // ".join(parts) + " ///"
            out.write(f"{spot_id}\t{gene_assignment}\n")
            n_rows += 1
            if symbol != "---":
                n_symbol += 1

with open(DST, "w", encoding="utf-8") as fh:
    fh.write(out.getvalue())

print(f"rows={n_rows} with_symbol={n_symbol} ({100.0*n_symbol/max(n_rows,1):.1f}%)")
print("first rows:")
with open(DST, encoding="utf-8") as fh:
    for i, line in enumerate(fh):
        if i > 2:
            break
        print(line.rstrip("\n")[:160])
