#!/usr/bin/env python3
"""Loopback A2A proxy that removes codex-a2a 1.4.0 unsupported fields."""

from __future__ import annotations

import argparse
import copy
import http.client
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


def remove_incompatible_fields(payload: dict) -> dict:
    result = payload.get("result")
    if isinstance(result, dict):
        status_update = result.get("statusUpdate")
        if isinstance(status_update, dict):
            status_update.pop("final", None)
    return payload


def transform_sse_line(line: str) -> str:
    ending = ""
    body = line
    if body.endswith("\r\n"):
        body, ending = body[:-2], "\r\n"
    elif body.endswith("\n"):
        body, ending = body[:-1], "\n"
    if not body.startswith("data:"):
        return line
    raw = body[5:].lstrip()
    if not raw:
        return line
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return line
    if not isinstance(payload, dict):
        return line
    transformed = remove_incompatible_fields(payload)
    return "data: " + json.dumps(transformed, ensure_ascii=False) + ending


def rewrite_agent_card(card: dict, public_base_url: str) -> dict:
    rewritten = copy.deepcopy(card)
    rewritten["url"] = public_base_url
    provider = rewritten.get("provider")
    if isinstance(provider, dict) and "url" in provider:
        provider["url"] = public_base_url
    interfaces = rewritten.get("supportedInterfaces")
    if isinstance(interfaces, list):
        for interface in interfaces:
            if isinstance(interface, dict) and "url" in interface:
                interface["url"] = public_base_url
    return rewritten


def transform_response_body(
    body: bytes,
    content_type: str,
    request_path: str = "",
    public_base_url: str = "",
) -> bytes:
    if "text/event-stream" in content_type:
        text = body.decode("utf-8", errors="replace")
        return "".join(transform_sse_line(line) for line in text.splitlines(keepends=True)).encode()
    if "application/json" in content_type:
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            return body
        if isinstance(payload, dict):
            if request_path.split("?", 1)[0].endswith("/.well-known/agent-card.json") and public_base_url:
                payload = rewrite_agent_card(payload, public_base_url)
            return json.dumps(remove_incompatible_fields(payload), ensure_ascii=False).encode()
    return body


class CompatProxyHandler(BaseHTTPRequestHandler):
    server_version = "codex-a2a-compat/1.0"

    def log_message(self, fmt, *args):  # noqa: A002
        pass

    def _proxy(self) -> None:
        upstream = urlparse(self.server.upstream_url)  # type: ignore[attr-defined]
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        headers = {
            name: value
            for name, value in self.headers.items()
            if name.lower() not in {"host", "content-length", "connection"}
        }
        conn = http.client.HTTPConnection(
            upstream.hostname or "127.0.0.1",
            upstream.port or 80,
            timeout=300,
        )
        path = (upstream.path.rstrip("/") + self.path) if upstream.path not in {"", "/"} else self.path
        try:
            conn.request(self.command, path, body=body, headers=headers)
            response = conn.getresponse()
            response_body = response.read()
            content_type = response.getheader("Content-Type", "")
            host = self.headers.get("Host", f"127.0.0.1:{self.server.server_port}")  # type: ignore[attr-defined]
            transformed = transform_response_body(
                response_body,
                content_type,
                self.path,
                f"http://{host}/",
            )
            self.send_response(response.status, response.reason)
            if content_type:
                self.send_header("Content-Type", content_type)
            cache_control = response.getheader("Cache-Control")
            if cache_control:
                self.send_header("Cache-Control", cache_control)
            self.send_header("Content-Length", str(len(transformed)))
            self.end_headers()
            self.wfile.write(transformed)
        except OSError as exc:
            payload = json.dumps({
                "jsonrpc": "2.0",
                "error": {"code": -32000, "message": f"ERR_COMPAT_UPSTREAM: {exc}"},
                "id": None,
            }).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        finally:
            conn.close()

    do_GET = _proxy
    do_POST = _proxy
    do_DELETE = _proxy


def create_server(host: str, port: int, upstream_url: str) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), CompatProxyHandler)
    server.upstream_url = upstream_url  # type: ignore[attr-defined]
    return server


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9912)
    parser.add_argument("--upstream", default="http://127.0.0.1:9910")
    args = parser.parse_args()
    server = create_server(args.host, args.port, args.upstream.rstrip("/"))
    print(
        f"CODEX_A2A_COMPAT_PROXY_READY listen={args.host}:{args.port} upstream={args.upstream}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
