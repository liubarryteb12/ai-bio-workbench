#!/usr/bin/env python3
"""Contract tests for the transport-keepalive engine."""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUILD = Path(__file__).resolve().parent / ".transport_build"


def run_node(script: str) -> dict:
    wrapper = (
        "import { TransportKeepaliveEngineImpl } from './src/engines/"
        "transport-keepalive-engine/implementation.mjs';\n"
        "import { buildLocalInvocation } from './src/engines/"
        "transport-keepalive-engine/adapters.mjs';\n"
        "const out = await (async () => {\n"
        + script
        + "\n})();\nconsole.log(JSON.stringify(out));"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", wrapper],
        cwd=BUILD,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise AssertionError(result.stdout + result.stderr)
    return json.loads(result.stdout)


class TransportKeepaliveEngineTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["node", str(REPO / "tests" / "transport_keepalive_compile.cjs")],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise AssertionError(result.stdout + result.stderr)

    def test_non_tailscale_phone_host_is_rejected_with_exit_2(self) -> None:
        result = run_node(
            "const adapter = {"
            "runLocal: async () => ({exitCode:0,stdout:'',stderr:''}),"
            "runRemote: async () => ({exitCode:0,stdout:'',stderr:''}),"
            "probeHttp: async () => ({status:200,rttMs:1})};"
            "const engine = new TransportKeepaliveEngineImpl(adapter);"
            "return engine.probe({phoneHost:'127.0.0.1',sshHost:'k40'});"
        )
        self.assertEqual(result["exitCode"], 2)
        self.assertEqual(result["stderr"], "ERR_TRANSPORT_NOT_TAILSCALE")

    def test_no_proxy_must_cover_loopback_and_tailscale_cidr(self) -> None:
        result = run_node(
            "const adapter = {"
            "runLocal: async () => ({exitCode:0,stdout:'',stderr:''}),"
            "runRemote: async () => ({exitCode:0,stdout:'',stderr:''}),"
            "probeHttp: async () => ({status:200,rttMs:1})};"
            "const engine = new TransportKeepaliveEngineImpl(adapter);"
            "return engine.probe({phoneHost:'100.64.0.10',sshHost:'k40',"
            "noProxy:'127.0.0.1,localhost'});"
        )
        self.assertEqual(result["exitCode"], 2)
        self.assertEqual(result["stderr"], "ERR_TRANSPORT_NO_PROXY_INCOMPLETE")

    def test_missing_tailscale_binary_is_a_red_check(self) -> None:
        result = run_node(
            "const calls = [];"
            "const adapter = {"
            "runLocal: async (command) => {calls.push(command);"
            "return command.includes('tailscale --version')"
            " ? {exitCode:1,stdout:'',stderr:'not found'}"
            " : {exitCode:0,stdout:'',stderr:''};},"
            "runRemote: async () => ({exitCode:0,stdout:'100.64.0.10',stderr:''}),"
            "probeHttp: async () => ({status:200,rttMs:1})};"
            "const engine = new TransportKeepaliveEngineImpl(adapter);"
            "return engine.probe({phoneHost:'100.64.0.10',sshHost:'k40'});"
        )
        self.assertEqual(result["exitCode"], 1)
        self.assertFalse(result["ok"])
        checks = {item["id"]: item for item in result["checks"]}
        self.assertFalse(checks["tailscale"]["ok"])

    def test_ten_endpoint_probes_require_all_success_and_average_rtt_below_60ms(self) -> None:
        result = run_node(
            "const adapter = {"
            "runLocal: async (command) => {"
            "if (command.includes('tailscale --version')) return {exitCode:0,stdout:'tailscale',stderr:''};"
            "if (command.includes('tailscale ip -4')) return {exitCode:0,stdout:'100.64.0.20',stderr:''};"
            "return {exitCode:0,stdout:'',stderr:''};},"
            "runRemote: async (_host, command) => {"
            "if (command.includes('tailscale --version')) return {exitCode:0,stdout:'tailscale',stderr:''};"
            "if (command.includes('tailscale ip -4')) return {exitCode:0,stdout:'100.64.0.10',stderr:''};"
            "if (command.includes('tmux')) return {exitCode:0,stdout:'a2a-server\\ntelemetry\\n',stderr:''};"
            "return {exitCode:0,stdout:'',stderr:''};},"
            "probeHttp: async (url) => ({status:url.includes(':9910')?200:401,"
            "rttMs:url.includes(':9910')?20:30})};"
            "const engine = new TransportKeepaliveEngineImpl(adapter);"
            "return engine.probe({phoneHost:'100.64.0.10',sshHost:'k40',attempts:10});"
        )
        self.assertEqual(result["exitCode"], 0, result)
        self.assertTrue(result["ok"])
        self.assertEqual(result["attempts"], 10)
        self.assertLess(result["averageRttMs"], 60)
        checks = {item["id"]: item for item in result["checks"]}
        self.assertTrue(checks["endpoint:9910"]["ok"])
        self.assertTrue(checks["endpoint:9911"]["ok"])

    def test_tmux_windows_must_include_a2a_server_and_telemetry(self) -> None:
        result = run_node(
            "const adapter = {"
            "runLocal: async (command) => {"
            "if (command.includes('tailscale --version')) return {exitCode:0,stdout:'tailscale',stderr:''};"
            "if (command.includes('tailscale ip -4')) return {exitCode:0,stdout:'100.64.0.20',stderr:''};"
            "return {exitCode:0,stdout:'',stderr:''};},"
            "runRemote: async (_host, command) => {"
            "if (command.includes('tailscale --version')) return {exitCode:0,stdout:'tailscale',stderr:''};"
            "if (command.includes('tailscale ip -4')) return {exitCode:0,stdout:'100.64.0.10',stderr:''};"
            "if (command.includes('tmux')) return {exitCode:0,stdout:'a2a-server\\n',stderr:''};"
            "return {exitCode:0,stdout:'',stderr:''};},"
            "probeHttp: async () => ({status:200,rttMs:20})};"
            "const engine = new TransportKeepaliveEngineImpl(adapter);"
            "return engine.probe({phoneHost:'100.64.0.10',sshHost:'k40',attempts:10});"
        )
        self.assertEqual(result["exitCode"], 1, result)
        checks = {item["id"]: item for item in result["checks"]}
        self.assertFalse(checks["tmux-windows"]["ok"])

    def test_windows_local_invocation_uses_powershell(self) -> None:
        result = run_node(
            "return buildLocalInvocation('tailscale --version','win32',{"
            "powershellCommand:'powershell.exe',bashCommand:'bash'});"
        )
        self.assertEqual(result["command"], "powershell.exe")
        self.assertEqual(result["args"][0:2], ["-NoProfile", "-NonInteractive"])
        self.assertIn("Get-Command tailscale", result["args"][-1])
        self.assertIn("& $cmd.Source --version", result["args"][-1])


if __name__ == "__main__":
    unittest.main()
