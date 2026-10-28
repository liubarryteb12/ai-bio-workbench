# A2A Stage 1 Gate Report

Date: 2026-10-28
Branch: `codex/a2a-v1`
Scope: Codex (PC) and Pi Agent (K40 Termux) cross-plane collaboration, stage 1 foundation.

## Verdict

Stage 1 is FUNCTIONAL on both planes. The only missing item is a model
provider key for the phone-side Pi agent, which blocks real task execution
but not the protocol, security, or orchestration layers.

## PC plane (Windows)

| Check | Result | Evidence |
|---|---|---|
| `uv tool install codex-a2a` | PASS | codex-a2a 1.4.0 installed |
| Agent Card on 127.0.0.1:8000 | PASS | HTTP 200, `Codex A2A 1.4.0` |
| Loopback-only binding | PASS | launcher refuses non-loopback host |
| Credential injection | PASS | random session token, never logged |
| Local SQLite runtime state | PASS | `.codex-a2a/` git-ignored |

## Phone plane (K40 Termux)

| Check | Result | Evidence |
|---|---|---|
| Node LTS 24.22.1 | PASS | meets Pi `>=22.19.0` |
| Pi Coding Agent 1.4.0 | PASS | installed with `--ignore-scripts` |
| `@bacnh85/pi-a2a` 0.8.0 | PASS | extension registered in settings |
| A2A Server auto-start | PASS | Agent Card OK from settings alone |
| Agent Card probe | PASS | name, capabilities, skills present |
| 401 gate: no token | PASS | HTTP 401 |
| 401 gate: wrong token | PASS | HTTP 401 |
| Peer token entropy | PASS | 56-char hex, 0600 file |
| `allowAllUsers=false` | PASS | guard refuses `true` (exit 2) |
| Weak-token 0.0.0.0 bind | PASS | guard refuses short token (exit 2) |
| Disabled server | PASS | guard refuses (exit 1) |
| Missing provider | PASS | guard refuses bare start (exit 2) |
| Unapproved provider | PASS | only deepseek/zai allowed (exit 2) |
| Unapproved model | PASS | only glm-5.3-flash / deepseek-v4.1-flash (exit 2) |
| Native workspace guard | PASS | `/sdcard` and FUSE paths rejected (exit 3) |

## K40 compute plane (proot Ubuntu)

| Check | Result | Evidence |
|---|---|---|
| Core tests | PASS | 8/8, exit 0 |
| Artifact validator tests | PASS | 7/7, exit 0 |
| Client poller self-test | PASS | `A2A_POLLER_SELF_TEST_OK`, exit 0 |
| Python compile gate | PASS | 4/4 files, exit 0 |
| Core compile on Node 18 | PASS | Termux Node 24 fallback |

## Model lock

The phone-side Pi agent is hard-locked to two approved combinations:

| Provider | Environment variable | Model | Thinking |
|---|---|---|---|
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-v4.1-flash` | high |
| ZAI | `ZAI_API_KEY` or `ZAI_CODING_CN_API_KEY` | `glm-5.3-flash` | high |

Any other provider or model is refused at daemon startup before Pi launches.

## Residual blockers

1. Provider key missing. Neither the PC environment nor the phone runtime
   contains `DEEPSEEK_API_KEY` or a ZAI key. Without it Pi cannot run a real
   model turn, so stage 2 (SendMessage task execution) is untested.
2. Tailscale not installed. Current cross-plane transport is ADB port
   forwarding, which requires a USB connection. Tailscale would remove that
   constraint but is not required for stage 1.

## Next steps

1. User provides one provider key; `ops/pi_set_provider_key.ps1` injects it.
2. Run `ops/pi_a2a_daemon.sh`; Pi starts with the locked model.
3. PC `codex-a2a call` against the phone endpoint; assert completed state and
   structured artifact per A2A-D-09.
4. Re-run the full K40 gate and record evidence in this directory.
