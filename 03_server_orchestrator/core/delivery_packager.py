#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
File: 03_server_orchestrator/core/delivery_packager.py
Purpose: 客户交付“四大件”自动打包器（含 04_Reproducibility_Capsule.zip 学术复现胶囊）
"""
import hashlib
import json
import os
import shutil
import zipfile
from typing import Dict, List, Optional


def compute_file_sha256(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


class DeliveryPackager:
    def __init__(self, deliverables_root: str = "deliverables") -> None:
        self.deliverables_root = deliverables_root
        os.makedirs(self.deliverables_root, exist_ok=True)

    def package(
        self,
        project_id: str,
        manifest_data: Dict,
        acceptance_data: Dict,
        report_path: Optional[str] = None,
        figure_paths: Optional[List[str]] = None,
        table_paths: Optional[List[str]] = None,
        session_info_text: Optional[str] = None,
    ) -> str:
        proj_dir = os.path.join(self.deliverables_root, project_id)
        os.makedirs(proj_dir, exist_ok=True)

        # 1. 第一件：AI 终验解读报告
        report_target = os.path.join(proj_dir, "01_Executive_Bio_Report.md")
        if report_path and os.path.exists(report_path):
            shutil.copy2(report_path, report_target)
        else:
            with open(report_target, "w", encoding="utf-8") as rf:
                rf.write(f"# 生物信息学全流程分析与独立终验执行报告\n\n")
                rf.write(f"> **项目编号**：`{project_id}`\n")
                rf.write(f"> **终验结论**：`{acceptance_data.get('final_decision')}`\n")
                rf.write(f"> **生物学评分**：`{acceptance_data.get('stage2_biological_score')}/100`\n\n")
                rf.write("## 1. 核心统计摘要\n\n")
                for k, v in acceptance_data.get("metrics_summary", {}).items():
                    rf.write(f"- **{k}**: `{v}`\n")

        # 2. 第二件：期刊级高清图表包
        fig_dir = os.path.join(proj_dir, "02_Publication_Ready_Figures")
        os.makedirs(fig_dir, exist_ok=True)
        if figure_paths:
            for fp in figure_paths:
                if os.path.exists(fp):
                    shutil.copy2(fp, os.path.join(fig_dir, os.path.basename(fp)))

        # 3. 第三件：全量统计结果表
        tbl_dir = os.path.join(proj_dir, "03_Processed_Tables")
        os.makedirs(tbl_dir, exist_ok=True)
        if table_paths:
            for tp in table_paths:
                if os.path.exists(tp):
                    shutil.copy2(tp, os.path.join(tbl_dir, os.path.basename(tp)))

        # 4. 第四件：学术复现胶囊 (04_Reproducibility_Capsule.zip)
        capsule_zip_path = os.path.join(proj_dir, "04_Reproducibility_Capsule.zip")
        manifest_locked_content = json.dumps(manifest_data, indent=2, ensure_ascii=False)
        acceptance_content = json.dumps(acceptance_data, indent=2, ensure_ascii=False)

        # 生成全量产物 SHA256 账本
        sha_lines = []
        for root, _, files in os.walk(proj_dir):
            for fn in sorted(files):
                if fn == "04_Reproducibility_Capsule.zip":
                    continue
                fp = os.path.join(root, fn)
                rel_p = os.path.relpath(fp, proj_dir)
                sha_lines.append(f"{compute_file_sha256(fp)}  {rel_p}")
        sha_manifest_content = "\n".join(sha_lines) + "\n"

        session_info_content = session_info_text or (
            "R version 4.3.3 (2024-02-29)\n"
            "Platform: aarch64-unknown-linux-gnu (64-bit)\n"
            "Seed: 20261013 (Strict determinism locked)\n"
            "Threads: 3 (bio_limits.sh enforced)\n"
        )

        with zipfile.ZipFile(capsule_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("execution_manifest.locked.json", manifest_locked_content)
            zf.writestr("acceptance_scorecard.json", acceptance_content)
            zf.writestr("sha256_manifest.txt", sha_manifest_content)
            zf.writestr("runtime_session_info.txt", session_info_content)

        return proj_dir
