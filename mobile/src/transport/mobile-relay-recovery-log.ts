import type { ConnectionDiagnosticCode, ConnectionLogLevel, ConnectionLogSink } from './types'

export type RelayRecoveryLog = (
  message: string,
  detail?: string,
  evidence?: { level?: ConnectionLogLevel; code?: ConnectionDiagnosticCode }
) => void

let relayLoggerInstanceSequence = 0

// Why: relay recovery failed silently in production for weeks; every decision
// must reach logcat and the in-app connection log.
// i18n-exempt: connection-log copy stays English — the log is a
// diagnostic transcript that gets pasted into bug reports, and a
// half-translated line reads worse than an English one.
export function createRelayRecoveryLog(
  now: () => number,
  onLog?: ConnectionLogSink
): RelayRecoveryLog {
  let sequence = 0
  const instanceId = `${Date.now().toString(36)}-${(++relayLoggerInstanceSequence).toString(36)}`
  return (message, detail, evidence) => {
    console.log(`[relay] ${message}`, detail ?? '')
    onLog?.({
      id: `relay-${instanceId}-${++sequence}`,
      ts: now(),
      level: evidence?.level ?? 'info',
      path: 'relay',
      ...(evidence?.code ? { code: evidence.code } : {}),
      message: `Relay: ${message}`,
      ...(detail ? { detail } : {})
    })
  }
}
