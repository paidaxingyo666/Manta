import { describe, expect, it, vi } from 'vitest'
import { formatEndpoint, testHostReachability } from './host-reachability'

describe('formatEndpoint', () => {
  it('does not echo malformed endpoints that may contain credentials', () => {
    expect(formatEndpoint('not-a-url?token=secret')).toBe('invalid endpoint')
  })
})

describe('testHostReachability', () => {
  it('returns false without leaving timers when WebSocket rejects a malformed endpoint', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor() {
          throw new TypeError('Invalid URL')
        }
      }
    )

    try {
      await expect(testHostReachability('not-a-url')).resolves.toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
