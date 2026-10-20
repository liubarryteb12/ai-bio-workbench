# s4_ingest_probe2.py：S4 探针二：跨样本基因顺序一致性 + array 坐标范围 + scalefactors 差异
import gzip
import io
import sys
import tarfile

import h5py
import numpy as np

TAR = "/mnt/ssd/bio_data/line3_spatial/raw_data/GSE192741_RAW.tar"

MOUSE = [("GSM5764414", "JBO001"), ("GSM5764415", "JBO002"), ("GSM5764416", "JBO003"),
         ("GSM5764417", "JBO004"), ("GSM5764418", "CAP002"), ("GSM5764419", "JBO006"),
         ("GSM5764420", "JBO009"), ("GSM5764421", "JBO010"), ("GSM5764422", "JBO012"),
         ("GSM5764423", "BH001")]
HUMAN = [("GSM5764424", "JBO014"), ("GSM5764425", "JBO015"), ("GSM5764426", "JBO018"),
         ("GSM5764427", "JBO019"), ("GSM5764428", "JBO022")]


def load_matrix(tf, gsm, sf):
    handle = tf.extractfile("%s_filtered_feature_bc_matrix_%s.h5" % (gsm, sf))
    with h5py.File(io.BytesIO(handle.read()), "r") as f:
        m = f["matrix"]
        ids = [x.decode() for x in m["features/id"][:]]
        names = [x.decode() for x in m["features/name"][:]]
        bc = [x.decode() for x in m["barcodes"][:]]
    return ids, names, bc


def load_positions(tf, gsm, sf):
    handle = tf.extractfile("%s_tissue_positions_list_%s.csv.gz" % (gsm, sf))
    rows = {}
    with gzip.open(handle, "rt") as fh:
        for line in fh:
            parts = line.strip().split(",")
            if len(parts) == 6:
                rows[parts[0]] = parts
    return rows


def load_scalefactors(tf, gsm, sf):
    import json
    handle = tf.extractfile("%s_scalefactors_json_%s.json.gz" % (gsm, sf))
    return json.loads(gzip.decompress(handle.read()).decode("utf-8"))


def main():
    with tarfile.open(TAR, "r:") as tf:
        for label, samples in (("MOUSE", MOUSE), ("HUMAN", HUMAN)):
            ref_ids = None
            ref_names = None
            print("=== %s ===" % label)
            for gsm, sf in samples:
                ids, names, bc = load_matrix(tf, gsm, sf)
                if ref_ids is None:
                    ref_ids, ref_names = ids, names
                    print("%s reference genes=%d" % (sf, len(ids)))
                    continue
                same_ids = ids == ref_ids
                same_names = names == ref_names
                pos = load_positions(tf, gsm, sf)
                rows = [pos[b] for b in bc]
                arows = [int(r[2]) for r in rows]
                acols = [int(r[3]) for r in rows]
                pxr = [int(r[4]) for r in rows]
                pxc = [int(r[5]) for r in rows]
                scf = load_scalefactors(tf, gsm, sf)
                print("%s ids_same=%s names_same=%s array_row[%d,%d] array_col[%d,%d] "
                      "pxl_row[%d,%d] pxl_col[%d,%d] hires_scalef=%.6f lowres_scalef=%.6f spot_diam=%.2f"
                      % (sf, same_ids, same_names, min(arows), max(arows), min(acols), max(acols),
                         min(pxr), max(pxr), min(pxc), max(pxc),
                         scf["tissue_hires_scalef"], scf["tissue_lowres_scalef"],
                         scf["spot_diameter_fullres"]))
                sys.stdout.flush()


if __name__ == "__main__":
    main()
