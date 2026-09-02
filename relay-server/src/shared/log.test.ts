import { describe, expect, it } from 'vitest'
import { Logger } from './log.js'

function capture(
  level: Parameters<typeof Logger.prototype.info>[0] extends never
    ? never
    : 'debug' | 'info' | 'warn' | 'error' = 'debug'
) {
  const lines: string[] = []
  return {
    lines,
    logger: new Logger(
      level,
      (line) => lines.push(line),
      () => 0
    )
  }
}

describe('Logger', () => {
  it('redacts credential-shaped fields', () => {
    // The easiest way to leak a resume token is to log a whole control message
    // while debugging, so redaction is keyed on the field name.
    const { lines, logger } = capture()
    logger.info('test', {
      relayHostId: 'abc',
      inviteToken: 'super-secret',
      authorization: { mode: 'relay-basis', basisConnId: 'c1' },
      nested: { refreshToken: 'also-secret' }
    })
    const record = JSON.parse(lines[0]!)
    expect(record.relayHostId).toBe('abc')
    expect(record.inviteToken).toBe('[redacted]')
    expect(record.authorization).toBe('[redacted]')
    expect(record.nested.refreshToken).toBe('[redacted]')
  })

  it('keeps public identifiers readable', () => {
    const { lines, logger } = capture()
    logger.warn('test', { relayDeviceId: 'device-1', connId: 'c-1', challengeId: 'x' })
    const record = JSON.parse(lines[0]!)
    expect(record).toMatchObject({ relayDeviceId: 'device-1', connId: 'c-1', challengeId: 'x' })
  })

  it('honours the minimum level', () => {
    const { lines, logger } = capture('warn')
    logger.info('quiet')
    logger.error('loud')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!).event).toBe('loud')
  })

  it('renders errors as their message, not a stack blob', () => {
    const { lines, logger } = capture()
    logger.error('boom', { error: new Error('disk full') })
    expect(JSON.parse(lines[0]!).error).toBe('disk full')
  })
})
