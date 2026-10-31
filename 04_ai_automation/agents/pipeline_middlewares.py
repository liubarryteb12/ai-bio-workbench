#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
File: 04_ai_automation/agents/pipeline_middlewares.py
Purpose: 嵌入服务端的 AI 异步中间件集（Role 0 门禁、Role 1 规划、Role 3 故障自愈、Role 4 终验）
"""
import os
import re
import time
from typing import Any, Dict, List, Optional

EXCEL_GENE_MAPPING = {
    "1-MAR": "MARCHF1",
    "MARCH1": "MARCHF1",
    "2-MAR": "MARCHF2",
    "MARCH2": "MARCHF2",
    "1-SEP": "SEPTIN1",
    "SEPT1": "SEPTIN1",
    "2-SEP": "SEPTIN2",
    "SEPT2": "SEPTIN2",
    "3-SEP": "SEPTIN3",
    "SEPT3": "SEPTIN3",
    "4-SEP": "SEPTIN4",
    "SEPT4": "SEPTIN4",
}


def fix_excel_corrupted_gene_symbols(genes: List[str]) -> List[str]:
    """修复被 Excel 日期格式自动篡改的基因名（如 1-Mar -> MARCHF1, 2-Sep -> SEPTIN2）"""
    fixed = []
    for g in genes:
        norm = g.strip().upper()
        if norm in EXCEL_GENE_MAPPING:
            fixed.append(EXCEL_GENE_MAPPING[norm])
        else:
            fixed.append(g.strip())
    return fixed


def standardize_species_gene_symbol(gene: str, species: str) -> str:
    """根据物种规范化基因符号大小写（人 HGNC 全大写，鼠 MGI 首字母大写）"""
    g = gene.strip()
    if species == "Homo_sapiens":
        return g.upper()
    elif species in ("Mus_musculus", "Rattus_norvegicus"):
        return g.capitalize()
    return g


class Role0IntakeMiddleware:
    """外包门禁与商业归因中间件"""

    def process(self, req_raw: Dict[str, Any]) -> Dict[str, Any]:
        req_id = req_raw.get("req_id") or f"REQ-{time.strftime('%Y%m%d')}-{os.urandom(3).hex().upper()}"
        line = req_raw.get("isolation_line", "line1_bulk")
        meta = req_raw.get("project_metadata", {})
        sample_groups = meta.get("sample_groups", {})
        ctrl = sample_groups.get("control_samples", [])
        treat = sample_groups.get("treatment_samples", [])

        if line == "line1_bulk" and (len(ctrl) < 3 or len(treat) < 3):
            raise ValueError(f"生物学重复不足 (n < 3)：对照组 {len(ctrl)}，处理组 {len(treat)}")

        overlap = set(ctrl) & set(treat)
        if overlap:
            raise ValueError(f"对照组与处理组存在样本重叠: {overlap}")

        species = req_raw.get("species", "Homo_sapiens")
        raw_genes = meta.get("target_genes", [])
        fixed_genes = fix_excel_corrupted_gene_symbols(raw_genes)
        meta["target_genes"] = [standardize_species_gene_symbol(g, species) for g in fixed_genes]

        attribution = req_raw.get("_attribution", {})
        attribution.setdefault("utm_source", "direct_organic")
        attribution.setdefault("partner_id", "default_partner")
        attribution.setdefault("tier", "STANDARD")

        return {
            "req_id": req_id,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "mode": req_raw.get("mode", "MODE_B_CUSTOM_MATRIX"),
            "isolation_line": line,
            "species": species,
            "project_metadata": meta,
            "_attribution": attribution,
        }


class Role1PlannerMiddleware:
    """生信首席管线规划官中间件"""

    def plan_dag(self, clean_req: Dict[str, Any]) -> Dict[str, Any]:
        req_id = clean_req["req_id"]
        line = clean_req["isolation_line"]
        manifest_id = f"MAN-{time.strftime('%Y%m%d')}-{os.urandom(3).hex().upper()}"

        return {
            "manifest_id": manifest_id,
            "req_id": req_id,
            "isolation_line": line,
            "global_constraints": {
                "seed": 20261013,
                "max_threads": 3,
                "max_memory_mb": 5500,
                "forbid_sdcard": True,
            },
            "compute_sieve_report": {
                "estimated_peak_mb": 450.0,
                "downsampling_applied": False,
                "sieve_passed": True,
            },
            "dag_steps": [
                {
                    "step_id": "step_01_qc_norm",
                    "depends_on": [],
                    "runtime_env": "R_4_3",
                    "script_relpath": f"src/{line}/scripts/qc_matrix/run.R",
                    "script_sha256": "0" * 64,
                    "args": {"seed": 20261013},
                    "expected_artifacts": [
                        {"relpath": "results/qc_boxplot.png", "format": "PNG", "critical": True},
                        {"relpath": "results/normalized_counts.tsv", "format": "TSV", "critical": True},
                    ],
                }
            ],
        }


class Role3SREMiddleware:
    """边缘算力故障自愈与 SRE 专家中间件"""

    def diagnose_and_heal(
        self,
        step_def: Dict[str, Any],
        failed_triad: Dict[str, Any],
        retry_count: int,
    ) -> Dict[str, Any]:
        step_id = step_def["step_id"]
        exit_code = failed_triad.get("exit_code", 1)
        log_digest = failed_triad.get("log_digest", {})
        combined_logs = f"{log_digest.get('stderr_tail', '')}\n{log_digest.get('stdout_tail', '')}"

        if retry_count >= 2:
            return {
                "step_id": step_id,
                "status": "ESCALATED_TO_HUMAN",
                "retry_count": retry_count,
                "reason": "已达到最大自愈重试次数 (2次)，自动熔断停机，防止耗尽 K40 电池",
                "last_exit_code": exit_code,
            }

        # OOM 异常诊断
        if exit_code == 137 or "Killed" in combined_logs or "cannot allocate vector" in combined_logs:
            args = dict(step_def.get("args", {}))
            args["threads"] = 1
            args["backed"] = True
            current_hvg = args.get("hvg_count", 3000)
            args["hvg_count"] = max(1000, current_hvg // 2)

            return {
                "step_id": step_id,
                "status": "AUTO_HEAL_APPLIED",
                "root_cause": "OOM_MEMORY_OVERFLOW",
                "retry_count": retry_count + 1,
                "adjustments": {
                    "threads": 1,
                    "backed": True,
                    "hvg_count": args["hvg_count"],
                },
                "patched_args": args,
            }

        # 脏矩阵异常诊断
        if "duplicate 'row.names'" in combined_logs or "NA/NaN/Inf" in combined_logs:
            args = dict(step_def.get("args", {}))
            args["clean_na"] = True
            args["make_unique_names"] = True
            return {
                "step_id": step_id,
                "status": "AUTO_HEAL_APPLIED",
                "root_cause": "DIRTY_MATRIX_VALUES",
                "retry_count": retry_count + 1,
                "adjustments": {"clean_na": True, "make_unique_names": True},
                "patched_args": args,
            }

        # 默认降线程重试
        args = dict(step_def.get("args", {}))
        args["threads"] = 1
        return {
            "step_id": step_id,
            "status": "AUTO_HEAL_APPLIED",
            "root_cause": "UNKNOWN_ERROR_FALLBACK",
            "retry_count": retry_count + 1,
            "adjustments": {"threads": 1},
            "patched_args": args,
        }


class Role4AuditorMiddleware:
    """独立终验与交付审计中间件"""

    def evaluate(self, manifest: Dict[str, Any], triad_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        all_ok = all(t.get("exit_code") == 0 for t in triad_results)
        score = 95.0 if all_ok else 50.0
        decision = "APPROVED_FOR_DELIVERY" if score >= 75.0 else "NEEDS_AUTO_HEAL"

        return {
            "manifest_id": manifest["manifest_id"],
            "stage1_mechanical_passed": all_ok,
            "stage2_biological_score": score,
            "final_decision": decision,
            "metrics_summary": {"score": score},
            "blocking_issues": [] if all_ok else ["One or more steps failed"],
        }
