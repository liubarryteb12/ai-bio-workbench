#!/usr/bin/env python3
"""Zero-trust configuration audit for A2A server settings."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List

TOKEN_PATTERN = re.compile(r"^[0-9a-f]{48,}$")


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
