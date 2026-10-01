import { describe, expect, it } from 'vitest'
import {
  compatRelayRuntimeFor,
  nextRelayRuntimeStep,
  relayRuntimeLadder,
  remoteRuntimeUnavailableMessage,
  remoteRuntimeUnavailableReason
} from './ssh-relay-runtime-ladder'

describe('relay runtime ladder (design D6)', () => {
  it('keeps the host-npm path alone for Auto and Host Node, and the full ladder for Manta-managed Node', () => {
    expect(relayRuntimeLadder('legacy')).toEqual(['legacy'])
    expect(relayRuntimeLadder('pinned-node')).toEqual(['A', 'B', 'C', 'legacy', 'D'])
  })

  it('steps to the next rung on an ordinary refusal', () => {
    const ladder = relayRuntimeLadder('pinned-node')
    expect(nextRelayRuntimeStep(ladder, 'A', 'libc_floor')).toBe('B')
    expect(nextRelayRuntimeStep(ladder, 'B', 'runtime_unavailable')).toBe('C')
    expect(nextRelayRuntimeStep(ladder, 'C', 'missing_lib')).toBe('legacy')
  })

  it('goes straight to D on noexec, which defeats every rung in the same tree', () => {
    const ladder = relayRuntimeLadder('pinned-node')
    expect(nextRelayRuntimeStep(ladder, 'A', 'noexec')).toBe('D')
    expect(nextRelayRuntimeStep(ladder, 'C', 'noexec')).toBe('D')
  })

  it('lets a remembered noexec skip only its own rung, so a remounted home is re-proved', () => {
    const ladder = relayRuntimeLadder('pinned-node')
    expect(nextRelayRuntimeStep(ladder, 'A', 'noexec', true)).toBe('B')
  })

  it('skips the npm path when rung C found no host Node, since npm needs one too', () => {
    const ladder = relayRuntimeLadder('pinned-node')
    expect(nextRelayRuntimeStep(ladder, 'C', 'host_node_missing')).toBe('D')
  })

  it('chooses rung B only when a listed compat runtime serves the host', () => {
    const facts = { target: 'linux-x64-glibc' as const, glibc: { major: 2, minor: 17 } }
    expect(compatRelayRuntimeFor(facts)).toBeNull()
    const catalog = [
      {
        id: 'glibc217',
        hostTarget: 'linux-x64-glibc' as const,
        glibcFloor: { major: 2, minor: 17 }
      }
    ]
    expect(compatRelayRuntimeFor(facts, catalog)?.id).toBe('glibc217')
    expect(compatRelayRuntimeFor({ ...facts, glibc: { major: 2, minor: 12 } }, catalog)).toBeNull()
    expect(compatRelayRuntimeFor({ target: 'linux-x64-musl', glibc: null }, catalog)).toBeNull()
    const muslCatalog = [{ id: 'musl', hostTarget: 'linux-x64-musl' as const, glibcFloor: null }]
    expect(compatRelayRuntimeFor({ target: 'linux-x64-musl', glibc: null }, muslCatalog)?.id).toBe(
      'musl'
    )
  })

  it('names the rung D reason in words the user can act on', () => {
    expect(remoteRuntimeUnavailableReason('noexec')).toBe('home_noexec')
    expect(remoteRuntimeUnavailableReason('host_node_missing')).toBe('no_runtime')
    expect(remoteRuntimeUnavailableMessage('home_noexec', 'noexec')).toContain('mounted noexec')
    expect(remoteRuntimeUnavailableMessage('no_runtime', 'host_node_missing')).toContain(
      'Install Node.js 18+'
    )
  })
})
