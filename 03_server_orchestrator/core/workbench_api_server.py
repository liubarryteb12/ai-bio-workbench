#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
File: 03_server_orchestrator/core/workbench_api_server.py
Purpose: v2.0 REST API 服务端：提供健康检查、需求提交、遥测心跳、台账查询与四大件下载
"""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.abspath("."))
import jsonschema
from orchestrator import BioWorkbenchOrchestrator


class WorkbenchAPIHandler(BaseHTTPRequestHandler):
    orchestrator: BioWorkbenchOrchestrator = None
    schemas_dir: str = os.path.abspath("schemas")

    def _send_json(self, status: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path
        query = parse_qs(url.query)

        # 1. GET /health
        if path == "/health" or path == "/api/health":
            return self._send_json(200, {"ok": True, "status": "UP", "version": "v2.0"})

        # 2. GET /api/v1/ledger
        if path == "/api/v1/ledger":
            category = query.get("category", ["tasks"])[0]
            ledger_file = os.path.join(self.orchestrator.repo_root, "con_hf", "ledger", f"{category}.jsonl")
            entries = []
            if os.path.exists(ledger_file):
                with open(ledger_file, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.strip():
                            try:
                                entries.append(json.loads(line.strip()))
                            except Exception:
                                pass
            return self._send_json(200, {"ok": True, "category": category, "entries": entries})

        # 3. GET /api/v1/deliverables/:id/download
        if path.startswith("/api/v1/deliverables/") and path.endswith("/download"):
            parts = path.split("/")
            proj_id = parts[4]
            zip_path = os.path.join(self.orchestrator.packager.deliverables_root, proj_id, "04_Reproducibility_Capsule.zip")
            if os.path.exists(zip_path):
                data = open(zip_path, "rb").read()
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Disposition", f'attachment; filename="04_Reproducibility_Capsule_{proj_id}.zip"')
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            else:
                return self._send_json(404, {"ok": False, "error": "Deliverable capsule not found"})

        self._send_json(404, {"ok": False, "error": "Not Found"})

    def do_POST(self):
        url = urlparse(self.path)
        path = url.path
        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length).decode("utf-8")
        try:
            payload = json.loads(raw_body) if raw_body else {}
        except Exception:
            return self._send_json(400, {"ok": False, "error": "Invalid JSON body"})

        # 1. POST /api/v1/requirements
        if path == "/api/v1/requirements":
            # 校验 requirement.schema.json
            schema_path = os.path.join(self.schemas_dir, "requirement.schema.json")
            if os.path.exists(schema_path):
                schema = json.load(open(schema_path, "r", encoding="utf-8"))
                try:
                    jsonschema.validate(payload, schema)
                except jsonschema.ValidationError as e:
                    return self._send_json(400, {"ok": False, "error": f"Schema Validation Failed: {e.message}"})

            try:
                clean_req = self.orchestrator.execute_role0_intake(payload)
                manifest = self.orchestrator.execute_role1_planner(clean_req)
                self.orchestrator.execute_role2_guard(manifest)
                return self._send_json(200, {
                    "ok": True,
                    "req_id": clean_req["req_id"],
                    "manifest_id": manifest["manifest_id"],
                    "status": "MANIFEST_PLANNED",
                })
            except Exception as e:
                return self._send_json(400, {"ok": False, "error": str(e)})

        # 2. POST /api/v1/a2a/heartbeat
        if path == "/api/v1/a2a/heartbeat":
            resp = self.orchestrator.handle_heartbeat(payload)
            return self._send_json(200, resp)

        self._send_json(404, {"ok": False, "error": "Not Found"})


def create_app_server(host: str = "127.0.0.1", port: int = 18788, repo_root: str = ".") -> HTTPServer:
    orchestrator = BioWorkbenchOrchestrator(repo_root=repo_root)
    WorkbenchAPIHandler.orchestrator = orchestrator
    server = HTTPServer((host, port), WorkbenchAPIHandler)
    return server
