#!/usr/bin/env python3
"""Compatibility proxy tests for codex-a2a 1.4.0."""

from __future__ import annotations

import http.client
import importlib.util
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROXY_PATH = REPO / "ops" / "codex_a2a_compat_proxy.py"


def load_proxy_module():
    spec = importlib.util.spec_from_file_location("codex_a2a_compat_proxy", PROXY_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class CodexA2ACompatTestCase(unittest.TestCase):
    def test_sse_transform_removes_only_unknown_final_field(self) -> None:
        proxy = load_proxy_module()
        frame = {
            "jsonrpc": "2.0",
            "id": "rpc-1",
            "result": {
                "statusUpdate": {
                    "taskId": "task-1",
                    "contextId": "ctx-1",
                    "status": {"state": "TASK_STATE_COMPLETED"},
                    "final": True,
                    "metadata": {"kept": "yes"},
                }
            },
        }
        transformed = proxy.transform_sse_line(
            f"data: {json.dumps(frame)}\n"
        )
        payload = json.loads(transformed.removeprefix("data: "))
        status_update = payload["result"]["statusUpdate"]
        self.assertNotIn("final", status_update)
        self.assertEqual(status_update["taskId"], "task-1")
        self.assertEqual(status_update["metadata"], {"kept": "yes"})

    def test_agent_card_urls_are_rewritten_to_the_proxy(self) -> None:
        proxy = load_proxy_module()
        card = {
            "url": "http://127.0.0.1:9910/",
            "provider": {"url": "http://127.0.0.1:9910/"},
            "supportedInterfaces": [
                {"url": "http://127.0.0.1:9910/", "protocolBinding": "JSONRPC"},
            ],
        }
        rewritten = proxy.rewrite_agent_card(card, "http://127.0.0.1:9912/")
        self.assertEqual(rewritten["url"], "http://127.0.0.1:9912/")
        self.assertEqual(
            rewritten["supportedInterfaces"][0]["url"],
            "http://127.0.0.1:9912/",
        )

    def test_http_proxy_forwards_and_transforms_sse(self) -> None:
        proxy = load_proxy_module()

        class UpstreamHandler(BaseHTTPRequestHandler):
            def log_message(self, fmt, *args):  # noqa: A002
                pass

            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length", "0"))
                self.rfile.read(length)
                body = (
                    'data: {"jsonrpc":"2.0","id":"1","result":{"statusUpdate":'
                    '{"taskId":"t","contextId":"c","status":{"state":"completed"},'
                    '"final":true}}}\n\n'
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
        upstream_thread = threading.Thread(target=upstream.serve_forever, daemon=True)
        upstream_thread.start()
        proxy_server = proxy.create_server(
            "127.0.0.1",
            0,
            f"http://127.0.0.1:{upstream.server_port}",
        )
        proxy_thread = threading.Thread(target=proxy_server.serve_forever, daemon=True)
        proxy_thread.start()
        try:
            conn = http.client.HTTPConnection("127.0.0.1", proxy_server.server_port, timeout=5)
            conn.request(
                "POST",
                "/",
                body=b'{"jsonrpc":"2.0"}',
                headers={"Content-Type": "application/json", "Authorization": "Bearer test"},
            )
            response = conn.getresponse()
            body = response.read().decode()
            conn.close()
            self.assertEqual(response.status, 200)
            self.assertIn('"taskId": "t"', body)
            self.assertNotIn('"final"', body)
        finally:
            proxy_server.shutdown()
            upstream.shutdown()
            proxy_server.server_close()
            upstream.server_close()


if __name__ == "__main__":
    unittest.main()
