#!/usr/bin/env python3
"""盘点探针 2：富化/TF/外部资源可达性（只读，无副作用）。

回答：
  1. gseapy 是否可 import（离线 Enrichr 数据缓存在哪）；
  2. 外网到 biomart / panglaodb / Lambert TF 表的可达性与体积；
  3. 本地是否已有 GMT / TF 列表可复用。
"""
import importlib.util as u
import os
import urllib.request

print("=== import check ===")
for m in ["gseapy"]:
    print("MOD %-10s %s" % (m, "OK" if u.find_spec(m) else "MISSING"))

print("=== local gene sets ===")
for d in ["/mnt/ssd/bio_data/public_references", os.path.expanduser("~")]:
    if os.path.isdir(d):
        for f in sorted(os.listdir(d))[:20]:
            print("  %s/%s" % (d, f))

print("=== network reachability (HEAD, 12s timeout) ===")
urls = [
    "https://maayanlab.cloud/Enrichr/geneSetLibrary?mode=text&libraryName=GO_Biological_Process_2023",
    "https://raw.githubusercontent.com/LambertLab/transcription-factors-db/master/TF_list/TF_list_v1.01.txt",
    "https://raw.githubusercontent.com/ Martin",  # placeholder skipped below
]
for url in urls[:2]:
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "curl/8"})
        with urllib.request.urlopen(req, timeout=12) as r:
            print("  OK   %s -> %s bytes content-length=%s"
                  % (url.split("/")[-1][:50], r.status,
                     r.headers.get("Content-Length", "?")))
    except Exception as e:
        print("  FAIL %s -> %s" % (url.split("/")[-1][:50], e))

print("=== TF list download test ===")
tf_url = "https://raw.githubusercontent.com/LambertLab/transcription-factors-db/master/TF_list/TF_list_v1.01.txt"
try:
    with urllib.request.urlopen(tf_url, timeout=20) as r:
        data = r.read()
    print("  downloaded %d bytes" % len(data))
    print("  first lines: %s" % data.decode("utf-8", "replace").splitlines()[:3])
except Exception as e:
    print("  FAIL %s" % e)
