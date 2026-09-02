import { describe, expect, it } from 'vitest'
import { buildInfo } from './build-info.js'

describe('buildInfo', () => {
  it('reports what the image build passed in', () => {
    expect(
      buildInfo({
        MANTA_RELAY_VERSION: '1.2.3',
        MANTA_RELAY_REVISION: 'abc1234',
        MANTA_RELAY_BUILT_AT: '2026-08-21T00:00:00Z'
      })
    ).toEqual({ version: '1.2.3', revision: 'abc1234', builtAt: '2026-08-21T00:00:00Z' })
  })

  // A local `docker build` passes nothing. Claiming a version it does not have
  // would be worse than admitting it is unversioned.
  it('says dev rather than inventing a version', () => {
    expect(buildInfo({})).toEqual({ version: 'dev', revision: 'unknown', builtAt: 'unknown' })
  })

  it('treats blank build args as absent', () => {
    expect(buildInfo({ MANTA_RELAY_VERSION: '  ', MANTA_RELAY_REVISION: '' }).version).toBe('dev')
  })
})
