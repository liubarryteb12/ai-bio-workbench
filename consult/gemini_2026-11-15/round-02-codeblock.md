{
  "schema_version": "receipt/v1",
  "receipt_id": "a1b2c3d4e5f60123456789ab",
  "work_order_digest": "sha256:...",
  "delivery_grade": "STANDARD | EXPLORATORY_DEGRADED",
  "adaptation_trace": [
    {
      "seq": 1,
      "mod_id": "sc_qc_filter",
      "action_type": "PARAM_REMEDIATION | SANDBOX_ADAPTATION",
      "target": "min_genes | patch_qc.R",
      "before_digest": "sha256:...",
      "after_digest": "sha256:...",
      "validation_run_id": "val_987654",
      "validation_passed": true,
      "purpose": "relax mitochondrial threshold for degraded tissue",
      "reason": "raw median mt_pct > 22%",
      "timestamp": "2026-11-15T05:30:00Z"
    }
  ],
  "sentinel": {
    "archive_ed25519_sig": "base64:...",
    "receipt_canonical_sha256": "sha256:...",
    "receipt_ed25519_sig": "base64:..."
  }
}

