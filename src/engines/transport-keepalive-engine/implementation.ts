import type { ExitCode } from '../../core/types';
import type {
  TransportCheck,
  TransportCommandAdapter,
  TransportCommandResult,
  TransportKeepaliveEngine,
  TransportProbeOutcome,
  TransportProbeRequest,
} from './interface';

export const DEFAULT_TRANSPORT_PORTS = [9910, 9911] as const;
export const DEFAULT_TRANSPORT_ATTEMPTS = 10;
export const DEFAULT_TRANSPORT_TIMEOUT_MS = 10_000;
export const TAILSCALE_CIDR = '100.64.0.0/10';

export function isTailscaleIpv4(value: string): boolean {
  const parts = String(value).trim().split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

export function buildNoProxy(phoneHost: string): string {
  return `127.0.0.1,localhost,${TAILSCALE_CIDR},${phoneHost}`;
}

export function hasNoProxyCoverage(noProxy: string, phoneHost: string): boolean {
  const entries = new Set(
    String(noProxy)
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
  return (
    entries.has('127.0.0.1')
    && entries.has('localhost')
    && entries.has(TAILSCALE_CIDR)
    && entries.has(phoneHost.trim().toLowerCase())
  );
}

function emptyResult(message: string): TransportCommandResult {
  return { exitCode: 1, stdout: '', stderr: message };
}

async function safeRun(
  run: () => Promise<TransportCommandResult>,
): Promise<TransportCommandResult> {
  try {
    return await run();
  } catch (cause) {
    return emptyResult(cause instanceof Error ? cause.message : String(cause));
  }
}

function commandSucceeded(result: TransportCommandResult): boolean {
  return result.exitCode === 0;
}

function commandHasOutput(result: TransportCommandResult): boolean {
  return commandSucceeded(result) && result.stdout.trim().length > 0;
}

function parseTmuxWindows(text: string): Set<string> {
  return new Set(
    String(text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function check(
  id: string,
  ok: boolean,
  detail: string,
): TransportCheck {
  return Object.freeze({ id, ok, detail });
}

function failedSummary(checks: readonly TransportCheck[]): string {
  return checks
    .filter((item) => !item.ok)
    .map((item) => `${item.id}: ${item.detail}`)
    .join('; ');
}

function outcome(
  exitCode: ExitCode,
  checks: readonly TransportCheck[],
  noProxy: string,
  attempts: number,
  averageRttMs: number | null,
  stderr = '',
): TransportProbeOutcome {
  return Object.freeze({
    ok: exitCode === 0 && checks.every((item) => item.ok),
    exitCode,
    checks: Object.freeze([...checks]),
    noProxy,
    attempts,
    averageRttMs,
    stderr,
  });
}

export class TransportKeepaliveEngineImpl implements TransportKeepaliveEngine {
  constructor(private readonly adapter: TransportCommandAdapter) {}

  async probe(request: TransportProbeRequest): Promise<TransportProbeOutcome> {
    const phoneHost = String(request?.phoneHost ?? '').trim();
    const sshHost = String(request?.sshHost ?? '').trim();
    const attempts = request?.attempts ?? DEFAULT_TRANSPORT_ATTEMPTS;
    const timeoutMs = request?.timeoutMs ?? DEFAULT_TRANSPORT_TIMEOUT_MS;
    const ports = request?.ports ?? DEFAULT_TRANSPORT_PORTS;
    const noProxy = request?.noProxy ?? buildNoProxy(phoneHost);
    const checks: TransportCheck[] = [];

    if (!isTailscaleIpv4(phoneHost)) {
      return outcome(2, checks, noProxy, attempts, null, 'ERR_TRANSPORT_NOT_TAILSCALE');
    }
    if (!sshHost) {
      return outcome(2, checks, noProxy, attempts, null, 'ERR_TRANSPORT_SSH_HOST_MISSING');
    }
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 100) {
      return outcome(2, checks, noProxy, attempts, null, 'ERR_TRANSPORT_ATTEMPTS_INVALID');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return outcome(2, checks, noProxy, attempts, null, 'ERR_TRANSPORT_TIMEOUT_INVALID');
    }
    if (
      !Array.isArray(ports)
      || ports.length === 0
      || ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)
    ) {
      return outcome(2, checks, noProxy, attempts, null, 'ERR_TRANSPORT_PORT_INVALID');
    }
    if (!hasNoProxyCoverage(noProxy, phoneHost)) {
      return outcome(2, checks, noProxy, attempts, null, 'ERR_TRANSPORT_NO_PROXY_INCOMPLETE');
    }

    const localTailscale = await safeRun(() =>
      this.adapter.runLocal('tailscale --version', timeoutMs),
    );
    const localTailscaleOk = commandHasOutput(localTailscale);
    checks.push(check(
      'tailscale',
      localTailscaleOk,
      localTailscaleOk ? localTailscale.stdout.trim() : localTailscale.stderr || 'not found',
    ));

    if (localTailscaleOk) {
      const localIp = await safeRun(() =>
        this.adapter.runLocal('tailscale ip -4', timeoutMs),
      );
      const localIpOk = commandHasOutput(localIp) && isTailscaleIpv4(localIp.stdout.split(/\s+/)[0] ?? '');
      checks.push(check(
        'tailscale-local-ip',
        localIpOk,
        localIpOk ? localIp.stdout.trim() : localIp.stderr || 'no CGNAT IPv4',
      ));
    }

    const remoteTailscale = await safeRun(() =>
      this.adapter.runRemote(sshHost, 'tailscale --version', timeoutMs),
    );
    const remoteTailscaleOk = commandHasOutput(remoteTailscale);
    checks.push(check(
      'tailscale-phone',
      remoteTailscaleOk,
      remoteTailscaleOk ? remoteTailscale.stdout.trim() : remoteTailscale.stderr || 'not found',
    ));

    if (remoteTailscaleOk) {
      const remoteIp = await safeRun(() =>
        this.adapter.runRemote(sshHost, 'tailscale ip -4', timeoutMs),
      );
      const remoteIpOk = commandHasOutput(remoteIp) && remoteIp.stdout.includes(phoneHost);
      checks.push(check(
        'tailscale-phone-ip',
        remoteIpOk,
        remoteIpOk ? remoteIp.stdout.trim() : remoteIp.stderr || `expected ${phoneHost}`,
      ));
    }

    const tmux = await safeRun(() =>
      this.adapter.runRemote(
        sshHost,
        "tmux list-windows -t pi-a2a -F '#W' 2>/dev/null || true",
        timeoutMs,
      ),
    );
    const windows = parseTmuxWindows(tmux.stdout);
    const tmuxOk = commandSucceeded(tmux)
      && windows.has('a2a-server')
      && windows.has('telemetry');
    checks.push(check(
      'tmux-windows',
      tmuxOk,
      tmuxOk ? 'a2a-server,telemetry' : `windows=${[...windows].join(',') || 'none'}`,
    ));

    const probeResults = await Promise.all(
      ports.flatMap((port) =>
        Array.from({ length: attempts }, async () => {
          try {
            const result = await this.adapter.probeHttp(
              `http://${phoneHost}:${port}/`,
              timeoutMs,
            );
            return {
              port,
              ok: Number.isInteger(result.status)
                && result.status >= 100
                && result.status <= 599
                && Number.isFinite(result.rttMs),
              rttMs: result.rttMs,
            };
          } catch {
            return { port, ok: false, rttMs: 0 };
          }
        }),
      ),
    );
    const allRtts: number[] = [];
    for (const port of ports) {
      const samples = probeResults.filter((sample) => sample.port === port);
      const valid = samples.length === attempts && samples.every((sample) => sample.ok);
      if (valid) {
        allRtts.push(...samples.map((sample) => sample.rttMs));
      }
      checks.push(check(
        `endpoint:${port}`,
        valid,
        valid
          ? `samples=${samples.length}`
          : `valid=${samples.filter((sample) => sample.ok).length}/${attempts}`,
      ));
    }

    if (request?.androidSerial) {
      const serial = String(request.androidSerial).trim();
      if (!/^[A-Za-z0-9._:-]+$/.test(serial)) {
        checks.push(check('android-serial', false, 'invalid serial'));
      } else {
        const whitelist = await safeRun(() =>
          this.adapter.runLocal(
            `adb -s ${serial} shell dumpsys deviceidle whitelist`,
            timeoutMs,
          ),
        );
        const whitelistOk = commandSucceeded(whitelist) && whitelist.stdout.includes('com.termux');
        checks.push(check(
          'android-doze-whitelist',
          whitelistOk,
          whitelistOk ? 'com.termux present' : whitelist.stderr || 'com.termux missing',
        ));

        const phantomEnabled = await safeRun(() =>
          this.adapter.runLocal(
            `adb -s ${serial} shell settings get global settings_enable_monitor_phantom_procs`,
            timeoutMs,
          ),
        );
        const phantomMax = await safeRun(() =>
          this.adapter.runLocal(
            `adb -s ${serial} shell device_config get activity_manager max_phantom_processes`,
            timeoutMs,
          ),
        );
        const phantomOk = commandSucceeded(phantomEnabled)
          && phantomEnabled.stdout.trim() === 'false'
          && commandSucceeded(phantomMax)
          && phantomMax.stdout.trim() === '2147483647';
        checks.push(check(
          'android-phantom-limit',
          phantomOk,
          phantomOk
            ? 'monitor=false max=2147483647'
            : `${phantomEnabled.stdout.trim() || 'unknown'}/${phantomMax.stdout.trim() || 'unknown'}`,
        ));
      }
    }

    const averageRttMs = allRtts.length
      ? Math.round((allRtts.reduce((sum, value) => sum + value, 0) / allRtts.length) * 10) / 10
      : null;
    if (averageRttMs !== null) {
      checks.push(check(
        'average-rtt',
        averageRttMs < 60,
        `${averageRttMs}ms`,
      ));
    }

    const allChecksOk = checks.every((item) => item.ok);
    return outcome(
      allChecksOk ? 0 : 1,
      checks,
      noProxy,
      attempts,
      averageRttMs,
      allChecksOk ? '' : failedSummary(checks),
    );
  }
}
