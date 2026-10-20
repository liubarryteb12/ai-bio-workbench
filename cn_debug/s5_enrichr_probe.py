#!/usr/bin/env python3
"""探针：Enrichr 基因集库可达性与体积（决定 line2 富集步骤口径）。"""
import gseapy

libs = ["GO_Biological_Process_2023", "KEGG_2021_Human", "Reactome_Pathways_2024",
        "ENCODE_and_ChEA_Consensus_TFs_from_ChIP-X", "ENCODE_TF_ChIP-seq_2015"]
for lib in libs:
    try:
        gs = gseapy.get_library(name=lib, organism="human")
        print("OK   %-45s genesets=%d" % (lib, len(gs)))
    except Exception as e:
        print("FAIL %-45s %s" % (lib, str(e)[:120]))
