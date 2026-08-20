import { describe, expect, it } from 'vitest'
import { directProbeConnectionLog } from './direct-probe-connection-log'
import type { ConnectionLogEntry } from './types'

function capture(): { sink: (entry: ConnectionLogEntry) => void; seen: ConnectionLogEntry[] } {
  const seen: ConnectionLogEntry[] = []
  return { sink: (entry) => void seen.push(entry), seen }
}

const entry = (level: ConnectionLogEntry['level'], message: string): ConnectionLogEntry => ({
  id: 'x',
  ts: 1,
  level,
  message
})

describe('directProbeConnectionLog', () => {
  it('demotes a probe timeout out of error — the session is on the relay and healthy', () => {
    const { sink, seen } = capture()
    directProbeConnectionLog(sink)(entry('error', 'WebSocket connect timeout'))
    expect(seen[0]!.level).toBe('info')
    expect(seen[0]!.message).toBe('Direct-return probe: WebSocket connect timeout')
  })

  it('demotes warnings too, since a probe close is expected', () => {
    const { sink, seen } = capture()
    directProbeConnectionLog(sink)(entry('warn', 'WebSocket closed'))
    expect(seen[0]!.level).toBe('info')
  })

  it('leaves a successful probe at its own level', () => {
    const { sink, seen } = capture()
    directProbeConnectionLog(sink)(entry('success', 'Authenticated'))
    expect(seen[0]!.level).toBe('success')
  })

  it('keeps the rest of the entry intact so the log stays diffable', () => {
    const { sink, seen } = capture()
    directProbeConnectionLog(sink)({ ...entry('info', 'Opening WebSocket'), detail: '10.0.0.1' })
    expect(seen[0]).toMatchObject({ id: 'x', ts: 1, detail: '10.0.0.1' })
  })
})
