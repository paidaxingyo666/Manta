import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { NODE_RUNTIME_PIN } from '../../src/shared/node-runtime-pin.ts'

const projectDir = resolve(import.meta.dirname, '../..')
const readText = (name) => readFileSync(join(projectDir, '.github/workflows', name), 'utf8')
const workflow = parse(readText('ssh-hostile-hosts.yml'))

function imageRefs(text, pattern) {
  return [...new Set(text.match(pattern) ?? [])]
}

describe('SSH hostile-host workflow', () => {
  it('runs on demand and on path-filtered, non-draft pull requests only', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'workflow_dispatch'])
    expect(workflow.on.pull_request.paths).toContain('src/main/ssh/ssh-relay-*')
    expect(workflow.jobs.glibc_slot.if).toContain('github.event.pull_request.draft != true')
    expect(workflow.jobs.musl_slot.needs).toBe('glibc_slot')
    expect(workflow.jobs.hosts.needs).toBe('musl_slot')
  })

  // Why: the slots must come from the same builders the headless-server lanes qualify, so a
  // NODE_RUNTIME_PIN or builder move cannot leave this matrix testing a stale runtime.
  it('builds the slots on the headless-server lanes’ pinned builder images', () => {
    const nodeServer = readText('node-server-tests.yml')
    const hostile = readText('ssh-hostile-hosts.yml')
    const alpine = /node:[0-9.]+-alpine@sha256:[0-9a-f]{64}/g
    const manylinux = /quay\.io\/pypa\/manylinux_2_28_x86_64@sha256:[0-9a-f]{64}/g
    expect(imageRefs(hostile, alpine)).toEqual(imageRefs(nodeServer, alpine))
    expect(imageRefs(hostile, alpine)).toEqual([
      expect.stringMatching(new RegExp(`^node:${NODE_RUNTIME_PIN.version.replaceAll('.', '\\.')}-`))
    ])
    expect(imageRefs(hostile, manylinux)).toEqual(imageRefs(nodeServer, manylinux))
    expect(imageRefs(hostile, manylinux)).toHaveLength(1)
  })

  it('opts the matrix in and runs it against both x64 Linux slots', () => {
    const steps = workflow.jobs.hosts.steps
    const matrix = steps.find((step) => step.name === 'Run the hostile-host matrix')
    expect(matrix.env.ORCA_RUN_SSH_HOSTILE_HOSTS).toBe('1')
    expect(matrix.run).toBe('pnpm test src/main/ssh/ssh-relay-hostile-hosts.docker.test.ts')
    expect(steps.map((step) => step.run ?? '').join('\n')).toContain(
      '--targets linux-x64-glibc,linux-x64-musl'
    )
  })
})
