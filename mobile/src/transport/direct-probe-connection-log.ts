import type { ConnectionLogEntry, ConnectionLogSink } from './types'

/**
 * Re-labels the background direct-return probe's log lines.
 *
 * While the runtime channel rides the relay, a probe dials the direct endpoint
 * every so often to see whether it can migrate back. On a host whose direct
 * address is simply not routable from here, that probe times out every time —
 * and because it shares the main connection's log sink, those timeouts landed
 * as `error` next to real failures. The session is healthy; the optional
 * shortcut just is not available.
 *
 * The lines stay in the log — knowing the probe ran and failed is useful — but
 * as `info`, prefixed with who they belong to.
 */
// i18n-exempt: connection-log transcript stays English
export function directProbeConnectionLog(onLog: ConnectionLogSink): ConnectionLogSink {
  return (entry: ConnectionLogEntry) => {
    onLog({
      ...entry,
      level: entry.level === 'error' || entry.level === 'warn' ? 'info' : entry.level,
      message: `Direct-return probe: ${entry.message}`
    })
  }
}
