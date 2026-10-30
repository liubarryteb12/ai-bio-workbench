#!/usr/bin/env python3
"""Zero-trust configuration audit for A2A server settings."""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List

TOKEN_PATTERN = re.compile(r"^(a2a_sec_)?[0-9a-f]{48,}$")
LEAK_PATTERN = re.compile(r"(?<![0-9a-z])a2a_sec_[0-9a-f]{48,}(?![0-9a-f])")
SCAN_SUFFIXES = {
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".conf",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".py",
    ".ps1",
    ".sh",
}
SKIP_DIRS = {
    ".git",
    ".Temp",
    ".tmp",
    "backups",
    "dist",
    "node_modules",
    "test-results",
}


def validate_settings(settings: Dict[str, Any]) -> List[str]:
    """Return one error string per violation; an empty list means valid."""
    errors: List[str] = []
    server = settings.get("a2a", {}).get("server", {}) if isinstance(settings, dict) else {}
    if not server.get("enabled"):
        errors.append("ERR_SERVER_DISABLED")
    if server.get("allowAllUsers") is True:
        errors.append("ERR_ALLOW_ALL_FORBIDDEN")

    host = server.get("host", "127.0.0.1")
    tokens = server.get("peerTokens", {})
    if host == "0.0.0.0":
        if not isinstance(tokens, dict) or not tokens:
            errors.append("ERR_PEER_TOKENS_REQUIRED_FOR_0_0_0_0")
        else:
            for peer, token in tokens.items():
                if not isinstance(token, str) or not TOKEN_PATTERN.fullmatch(token):
                    errors.append(f"ERR_PEER_TOKEN_WEAK: {peer}")
        if not server.get("trustedPeers"):
            errors.append("ERR_TRUSTED_PEERS_REQUIRED_FOR_0_0_0_0")

    try:
        max_concurrent = int(server.get("maxConcurrent", 1))
    except (TypeError, ValueError):
        max_concurrent = 1
    if max_concurrent > 2:
        errors.append("ERR_MAX_CONCURRENT_ABOVE_2")
    if max_concurrent < 1:
        errors.append("ERR_MAX_CONCURRENT_BELOW_1")
    return errors


def validate_settings_file(path: str) -> List[str]:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    return validate_settings(data)


def scan_repository(root: str | Path) -> List[Dict[str, Any]]:
    """Return A2A peer-token leaks in runtime code and configuration files."""
    base = Path(root).resolve()
    findings: List[Dict[str, Any]] = []
    for current, dirs, files in os.walk(base):
        dirs[:] = [name for name in dirs if name not in SKIP_DIRS]
        for name in files:
            if name == ".env" or name.startswith(".env."):
                continue
            path = Path(current) / name
            if path.suffix.lower() not in SCAN_SUFFIXES:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            for line_number, line in enumerate(text.splitlines(), start=1):
                if LEAK_PATTERN.search(line):
                    findings.append({
                        "path": path.relative_to(base).as_posix(),
                        "line": line_number,
                        "pattern": "A2A_PEER_TOKEN",
                    })
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scan-root", default=".")
    args = parser.parse_args()
    findings = scan_repository(args.scan_root)
    print(json.dumps({
        "ok": not findings,
        "findings": findings,
    }, ensure_ascii=False))
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
