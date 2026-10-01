import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ORCAD_BUN_RUNTIME_IDENTITY } from './mantad-bun-runtime'
import {
  parseOrcadProfilePreflight,
  type OrcadPreflightRuntimeIdentity
} from './mantad-profile-preflight'

const response = {
  type: 'manta_profile_state_ready',
  nonce: randomUUID(),
  runtime: 'bun',
  runtimeVersion: '1.4.2',
  artifactVersion: '0.1.0+123456789abc',
  sqliteVersion: '3.51.0',
  revision: 1
}

const bun: OrcadPreflightRuntimeIdentity = { runtime: 'bun', runtimeVersion: '1.4.2' }

function parse(value: unknown, expected = bun) {
  return parseOrcadProfilePreflight(
    JSON.stringify(value),
    response.nonce,
    expected,
    response.artifactVersion
  )
}

describe('candidate profile readiness', () => {
  it('admits an acknowledged write and backup under the expected installed runtime', () => {
    expect(parse(response)).toEqual(response)
  })

  it.each([
    { nonce: randomUUID() },
    { runtime: 'node' },
    { runtimeVersion: '1.4.0' },
    { artifactVersion: '0.1.0+000000000000' },
    { revision: 0 },
    { sqliteVersion: '' }
  ])('refuses stale or incomplete evidence: %j', (change) => {
    expect(() => parse({ ...response, ...change })).toThrow()
  })

  it('admits a Node candidate only when the caller launched Node', () => {
    const node = { ...response, runtime: 'node', runtimeVersion: '24.21.0' }
    const expected: OrcadPreflightRuntimeIdentity = { runtime: 'node', runtimeVersion: '24.21.0' }
    expect(parse(node, expected)).toEqual(node)
    expect(() => parse(node)).toThrow('expected candidate runtime')
    expect(() => parse(response, expected)).toThrow('expected candidate runtime')
  })

  it('shipped callers still require the pinned Bun runtime', () => {
    expect(ORCAD_BUN_RUNTIME_IDENTITY.runtime).toBe('bun')
    expect(() =>
      parse({ ...response, runtime: 'node' }, { ...ORCAD_BUN_RUNTIME_IDENTITY })
    ).toThrow()
  })

  it('does not choose a successful line out of contradictory output', () => {
    expect(() =>
      parseOrcadProfilePreflight(
        `${JSON.stringify(response)}\n${JSON.stringify({ ...response, revision: 0 })}`,
        response.nonce,
        bun
      )
    ).toThrow()
  })
})
