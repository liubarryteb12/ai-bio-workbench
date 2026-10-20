# s4_ingest_probe3.py：S4 探针三：图片维度/通道 + ADT barcode 与矩阵 barcode 重合
import gzip
import io
import json
import tarfile

import h5py
import numpy as np
from PIL import Image

TAR = "/mnt/ssd/bio_data/line3_spatial/raw_data/GSE192741_RAW.tar"

CASES = [("GSM5764414", "JBO001"), ("GSM5764418", "CAP002"), ("GSM5764423", "BH001"),
         ("GSM5764426", "JBO018")]


def main():
    with tarfile.open(TAR, "r:") as tf:
        for gsm, sf in CASES:
            for kind in ("tissue_lowres_image", "tissue_hires_image"):
                handle = tf.extractfile("%s_%s_%s.png.gz" % (gsm, kind, sf))
                raw = gzip.decompress(handle.read())
                img = Image.open(io.BytesIO(raw))
                arr = np.asarray(img)
                print("%s %s size=%s mode=%s array=%s dtype=%s"
                      % (sf, kind, img.size, img.mode, arr.shape, arr.dtype))
        # ADT barcode 与基因矩阵 barcode 重合
        handle = tf.extractfile("GSM5764423_filtered_feature_bc_matrix_BH001.h5")
        with h5py.File(io.BytesIO(handle.read()), "r") as f:
            gene_bc = set(x.decode() for x in f["matrix/barcodes"][:])
        handle = tf.extractfile("GSM5764423_counts_ADT_BH001.csv.gz")
        text = gzip.decompress(handle.read()).decode("utf-8")
        lines = text.splitlines()
        header = lines[0].split(",")
        adt_bc = set(header[1:])
        abs_rows = [ln.split(",", 1)[0].strip('"') for ln in lines[1:] if ln.strip()]
        print("ADT barcodes=%d gene_bc=%d overlap=%d adt_only=%d gene_only=%d"
              % (len(adt_bc), len(gene_bc), len(adt_bc & gene_bc),
                 len(adt_bc - gene_bc), len(gene_bc - adt_bc)))
        print("ADT antibody rows=%d" % len(abs_rows))
        print("ADT antibodies=%s" % abs_rows[:10])
        # positions 里 in_tissue 的 spot 是否都在 ADT 里
        handle = tf.extractfile("GSM5764423_tissue_positions_list_BH001.csv.gz")
        pos_bc = set()
        with gzip.open(handle, "rt") as fh:
            for line in fh:
                parts = line.strip().split(",")
                if len(parts) == 6 and parts[1] == "1":
                    pos_bc.add(parts[0])
        print("BH001 in_tissue spots=%d adt covers=%d" % (len(pos_bc), len(pos_bc & adt_bc)))


if __name__ == "__main__":
    main()
