/**
 * Starting a candidate mantad on the host and reading back what it says about itself.
 *
 * This is the piece `docs/design/shipping-orcad.html` §02 marks **fork**, not reuse: the
 * relay launches detached and proves itself by printing an `MANTA-RELAY` sentinel, and mantad
 * has no such interface. It publishes a single `manta_server_ready` JSON line on stdout,
 * carrying the health payload activation is gated on — so the handshake here is "capture
 * that line", not "match a marker".
 *
 * The candidate is launched detached with stdout redirected to a file inside its own version
 * directory. Reading readiness off the exec channel would mean holding the channel open for
 * the process's whole life; redirecting means the deploy can disconnect and the supervisor
 * still owns a running service.
 */
import { shellEscape } from './ssh-connection-utils'
import { joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import {
  assertPosixOrcadHost as assertPosixHost,
  MANTAD_PID_FILENAME,
  posixProcessAliveShellFunction
} from './mantad-remote-host-support'
import type { ServeReadiness } from '../server/serve-readiness'

/** Stdout of the launched candidate: exactly one `manta_server_ready` line, then nothing. */
export const MANTAD_READINESS_FILENAME = '.mantad-readiness'
/** Stderr, including the bind-exposure line and every supervision message. */
export const MANTAD_LOG_FILENAME = 'orcad.log'
export { MANTAD_PID_FILENAME, OrcadRemoteLaunchUnsupportedError } from './mantad-remote-host-support'

export type OrcadLaunchSpec = {
  remoteInstallDir: string
  nodePath: string
  fullVersion: string
  /** Shared across versions, and the reason rollback needs a snapshot. */
  userDataDir: string
  /** Loopback by default; the client reaches it through an SSH local port-forward. */
  bindHost: string
  port: number
}

/**
 * Launch the candidate detached and echo its PID.
 *
 * Why `--bind` is always passed explicitly: mantad defaults to loopback, but a default is a
 * thing a future version can change. The deploy states the posture it intends rather than
 * inheriting whatever the installed build happens to default to.
 */
export function orcadLaunchCommand(host: RemoteHostPlatform, spec: OrcadLaunchSpec): string {
  assertPosixHost(host)
  const dir = shellEscape(spec.remoteInstallDir)
  const readiness = shellEscape(
    joinRemotePath(host, spec.remoteInstallDir, MANTAD_READINESS_FILENAME)
  )
  const log = shellEscape(joinRemotePath(host, spec.remoteInstallDir, MANTAD_LOG_FILENAME))
  const pidFile = shellEscape(joinRemotePath(host, spec.remoteInstallDir, MANTAD_PID_FILENAME))
  const entry = shellEscape(joinRemotePath(host, spec.remoteInstallDir, 'mantad.js'))
  return [
    `cd ${dir} &&`,
    // Why truncate: a re-launch into a dir that already holds a previous readiness line would
    // otherwise let the deploy activate on the OLD process's health payload.
    `: > ${readiness} &&`,
    'umask 077 &&',
    `MANTA_VERSION=${shellEscape(spec.fullVersion)}`,
    `MANTA_USER_DATA=${shellEscape(spec.userDataDir)}`,
    `nohup ${shellEscape(spec.nodePath)} ${entry}`,
    `--json --bind ${shellEscape(spec.bindHost)} --port ${String(spec.port)}`,
    `> ${readiness} 2>> ${log} < /dev/null &`,
    `echo $! > ${pidFile} && cat ${pidFile}`
  ].join(' ')
}

export function readOrcadReadinessCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  assertPosixHost(host)
  const readiness = shellEscape(joinRemotePath(host, remoteInstallDir, MANTAD_READINESS_FILENAME))
  return `cat ${readiness} 2>/dev/null || true`
}

/**
 * Is the process recorded in this version dir still running?
 *
 * Answers `LIVE`, `DEAD`, or `UNKNOWN`. `UNKNOWN` covers a missing or unparseable PID file
 * and a `kill -0` that failed for a reason other than "no such process" — a permission
 * error means someone else's process holds that PID, which is not evidence of death.
 */
export function orcadLivenessProbeCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  assertPosixHost(host)
  const pidFile = shellEscape(joinRemotePath(host, remoteInstallDir, MANTAD_PID_FILENAME))
  return [
    posixProcessAliveShellFunction(),
    `pid=$(cat ${pidFile} 2>/dev/null);`,
    'case "$pid" in',
    '"" ) echo UNKNOWN;;',
    '*[!0-9]* ) echo UNKNOWN;;',
    // Why EPERM is LIVE and not DEAD: a permission error means some process holds that PID,
    // and deleting a tree because we could not signal its owner is the wrong direction.
    '* ) if orcad_alive "$pid"; then echo LIVE;',
    'elif kill -0 "$pid" 2>&1 | grep -qi "not permitted"; then echo LIVE;',
    'else echo DEAD; fi;;',
    'esac'
  ].join(' ')
}

export type OrcadLiveness = 'LIVE' | 'DEAD' | 'UNKNOWN'

export function parseOrcadLiveness(output: string): OrcadLiveness {
  const value = output.trim().split('\n').pop()?.trim()
  return value === 'LIVE' || value === 'DEAD' ? value : 'UNKNOWN'
}

/** True when GC must leave this directory alone. Inconclusive counts as in use. */
export function orcadLivenessBlocksGc(liveness: OrcadLiveness): boolean {
  return liveness !== 'DEAD'
}

export type OrcadReadinessParse =
  | { state: 'ready'; readiness: ServeReadiness }
  | { state: 'pending' }
  | { state: 'malformed'; reason: string }

/**
 * Pull the `manta_server_ready` payload out of whatever the candidate has written so far.
 *
 * Why scan for the type tag rather than parsing the last line: stdout is a file being
 * appended to, so a poll can catch a half-written line. A partial JSON line is `pending`,
 * not `malformed` — reporting a parse failure for a race would fail deploys that were fine.
 */
export function parseOrcadReadinessOutput(raw: string): OrcadReadinessParse {
  const lines = raw.split('\n')
  let sawCandidate = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) {
      continue
    }
    sawCandidate = true
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) {
      continue
    }
    const payload = parsed as { type?: unknown }
    if (payload.type !== 'manta_server_ready') {
      return {
        state: 'malformed',
        reason: `expected an manta_server_ready line, got type=${JSON.stringify(payload.type)}`
      }
    }
    return { state: 'ready', readiness: toServeReadiness(payload as Record<string, unknown>) }
  }
  return sawCandidate ? { state: 'pending' } : { state: 'pending' }
}

function toServeReadiness(payload: Record<string, unknown>): ServeReadiness {
  return {
    runtimeId: typeof payload.runtimeId === 'string' ? payload.runtimeId : '',
    boundEndpoint: typeof payload.boundEndpoint === 'string' ? payload.boundEndpoint : null,
    advertisedEndpoint:
      typeof payload.advertisedEndpoint === 'string' ? payload.advertisedEndpoint : null,
    managedWslCliReconciliation:
      payload.managedWslCliReconciliation === 'pending' ||
      payload.managedWslCliReconciliation === 'failed'
        ? payload.managedWslCliReconciliation
        : 'settled',
    pairing: payload.pairing as ServeReadiness['pairing'],
    ...(payload.health ? { health: payload.health as ServeReadiness['health'] } : {})
  }
}
