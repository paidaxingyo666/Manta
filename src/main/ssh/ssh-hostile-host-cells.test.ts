import { describe, expect, it } from 'vitest'
import {
  HOSTILE_HOST_CELLS,
  hostileHostCellViolations,
  parseForbiddenToolLog,
  selectHostileHostCells,
  type HostileHostCell,
  type HostileHostObservation
} from './ssh-hostile-host-cells'
import { hostileHostDockerfile } from './ssh-hostile-host-test-fixture'

function cell(id: string): HostileHostCell {
  const found = HOSTILE_HOST_CELLS.find((candidate) => candidate.id === id)
  if (!found) {
    throw new Error(`no cell ${id}`)
  }
  return found
}

const launched: HostileHostObservation = {
  settledRung: 'A',
  target: 'linux-x64-glibc',
  unavailableReason: null,
  deployError: null,
  refusals: [],
  forbiddenToolCalls: []
}

describe('hostile-host cells', () => {
  it('covers each design D6 ladder outcome the matrix is meant to prove', () => {
    expect(HOSTILE_HOST_CELLS.map((c) => c.id)).toEqual([
      'debian10-glibc228',
      'almalinux8-glibc228',
      'alpine-musl',
      'alpine-musl-no-libstdcxx',
      'ubuntu2204-node20-noexec-home',
      'centos7-glibc217',
      'debian10-no-egress'
    ])
    expect(new Set(HOSTILE_HOST_CELLS.map((c) => c.expect.outcome))).toEqual(
      new Set(['launched', 'unavailable', 'legacy_failed'])
    )
  })

  it('pins every base image by digest and installs no compiler or host Node for rung A', () => {
    for (const { dockerfile, expect: expectation } of HOSTILE_HOST_CELLS) {
      for (const from of dockerfile.filter((line) => line.startsWith('FROM '))) {
        expect(from).toMatch(/@sha256:[0-9a-f]{64}\b/)
      }
      if (expectation.outcome === 'launched') {
        expect(dockerfile.join('\n')).not.toMatch(/\b(?:gcc|g\+\+|build-essential|nodejs|npm)\b/)
      }
    }
  })

  it('shims the toolchain and starts sshd in every image', () => {
    const dockerfile = hostileHostDockerfile(cell('alpine-musl'))
    expect(dockerfile.startsWith('FROM alpine:3.20@sha256:')).toBe(true)
    expect(dockerfile).toContain('ln -sf orca-forbidden-tool /usr/local/bin/npm')
    expect(dockerfile).toContain('ln -sf orca-forbidden-tool /usr/local/bin/gcc')
    expect(dockerfile.trimEnd().endsWith('CMD ["/orca-entrypoint.sh"]')).toBe(true)
  })

  it('selects named cells and rejects unknown ones', () => {
    expect(selectHostileHostCells(undefined)).toHaveLength(HOSTILE_HOST_CELLS.length)
    expect(selectHostileHostCells(' ')).toHaveLength(HOSTILE_HOST_CELLS.length)
    expect(selectHostileHostCells('alpine-musl, centos7-glibc217').map((c) => c.id)).toEqual([
      'alpine-musl',
      'centos7-glibc217'
    ])
    expect(() => selectHostileHostCells('alpine-musl,solaris')).toThrow(
      'Unknown hostile-host cells: solaris'
    )
  })

  it('reads one call per line of the shim log', () => {
    expect(parseForbiddenToolLog('npm install\n\ngcc -v\n')).toEqual(['npm install', 'gcc -v'])
  })
})

describe('hostileHostCellViolations', () => {
  it('accepts rung A with no refusals and no toolchain', () => {
    expect(hostileHostCellViolations(cell('debian10-glibc228'), launched)).toEqual([])
  })

  it('flags a rung A host that invoked npm or landed on the wrong slot', () => {
    expect(
      hostileHostCellViolations(cell('alpine-musl'), {
        ...launched,
        forbiddenToolCalls: ['npm install']
      })
    ).toEqual(['toolchain invoked: npm install', 'target linux-x64-glibc, expected linux-x64-musl'])
  })

  it('flags a launched host that stepped down the ladder', () => {
    expect(
      hostileHostCellViolations(cell('almalinux8-glibc228'), {
        ...launched,
        settledRung: 'C',
        refusals: [
          { step: 'A', reason: 'missing_lib' },
          { step: 'B', reason: 'runtime_unavailable' }
        ]
      })
    ).toEqual([
      'refusals A:missing_lib > B:runtime_unavailable, expected none',
      'settled on C, expected A'
    ])
  })

  it('requires the classified rung D reason and refusal chain', () => {
    const noexec = cell('ubuntu2204-node20-noexec-home')
    const observed: HostileHostObservation = {
      settledRung: 'D',
      target: 'linux-x64-glibc',
      unavailableReason: 'home_noexec',
      deployError: 'home directory is mounted noexec',
      refusals: [{ step: 'A', reason: 'noexec' }],
      forbiddenToolCalls: []
    }
    expect(hostileHostCellViolations(noexec, observed)).toEqual([])
    expect(
      hostileHostCellViolations(noexec, {
        ...observed,
        unavailableReason: 'no_runtime',
        refusals: [
          { step: 'A', reason: 'noexec' },
          { step: 'C', reason: 'noexec' }
        ]
      })
    ).toEqual([
      'refusals A:noexec > C:noexec, expected A:noexec',
      'rung D reason no_runtime, expected home_noexec'
    ])
  })

  it('expects a glibc 2.17 host to fall through to a failing host-npm path', () => {
    const centos = cell('centos7-glibc217')
    const observed: HostileHostObservation = {
      settledRung: null,
      target: 'linux-x64-glibc',
      unavailableReason: null,
      deployError: 'Node.js was not found on the remote host',
      refusals: [
        { step: 'A', reason: 'libc_floor' },
        { step: 'B', reason: 'runtime_unavailable' },
        { step: 'C', reason: 'libc_floor' }
      ],
      forbiddenToolCalls: ['npm --version']
    }
    expect(hostileHostCellViolations(centos, observed)).toEqual([])
    expect(hostileHostCellViolations(centos, { ...observed, deployError: null })).toEqual([
      'deploy succeeded on a host with no runnable runtime'
    ])
  })

  it('judges an opted-out host only on the ladder never running', () => {
    const optOut = { id: 'opt-out', expect: { outcome: 'legacy_opt_out' } } as const
    const observed: HostileHostObservation = {
      settledRung: null,
      target: null,
      unavailableReason: null,
      deployError: 'Node.js was not found on the remote host',
      refusals: [],
      forbiddenToolCalls: ['npm']
    }
    expect(hostileHostCellViolations(optOut, observed)).toEqual([])
    expect(hostileHostCellViolations(optOut, { ...observed, deployError: null })).toEqual([])
    expect(
      hostileHostCellViolations(optOut, {
        ...observed,
        settledRung: 'A',
        refusals: [{ step: 'A', reason: 'noexec' }]
      })
    ).toEqual([
      'refusals A:noexec, expected none',
      'settled on A, expected the ladder never to run'
    ])
  })
})
