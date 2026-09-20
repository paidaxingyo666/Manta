import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import {
  resolveBaselineReleaseRef,
  selectBaselineReleaseTag
} from '../../tests/e2e/cross-version-wire/release-checkout'
import {
  extractCrossVersionPinnedRefs,
  readCrossVersionPinnedRefs
} from './cross-version-pinned-refs.mjs'

const projectDir = resolve(import.meta.dirname, '../..')

afterEach(() => vi.unstubAllEnvs())

describe('cross-version pinned refs', () => {
  it('finds legacy and pre-stack tags as well as reproduction commits', () => {
    expect(
      extractCrossVersionPinnedRefs([
        "const PRE_STACK_REF = 'v1.4.199'\nconst LEGACY_RELEASE_REF = 'v1.4.184'",
        "const FIXTURE_RELEASE_REF = 'v1.4.189-rc.10'\nconst PRE_STACK_REF = 'v1.4.199'",
        "const REPORTED_HOST_REF = '4bb337741c335cfcc428d3b4271023566e2dadb8'",
        "const OTHER = 'v9.9.9'\nconst UNSUPPORTED_REF = 'main'"
      ])
    ).toEqual({
      tags: ['v1.4.184', 'v1.4.189-rc.10', 'v1.4.199'],
      commits: ['4bb337741c335cfcc428d3b4271023566e2dadb8']
    })
  })

  it('includes both new pre-stack fixtures in the repository census', () => {
    const refs = readCrossVersionPinnedRefs(projectDir)
    for (const name of [
      'cross-version-worktree-identity-downgrade',
      'cross-version-session-tabs-retirement-proof'
    ]) {
      const source = readFileSync(
        resolve(projectDir, `tests/e2e/cross-version-wire/${name}.unit.test.ts`),
        'utf8'
      )
      const expected = /const PRE_STACK_REF = '([^']+)'/.exec(source)?.[1]
      expect(expected).toBeDefined()
      expect(refs.tags).toContain(expected)
    }
  })

  it('pins the fork release before fetching upstream fixture tags', () => {
    const workflow = parse(readFileSync(resolve(projectDir, '.github/workflows/pr.yml'), 'utf8'))
    const steps = workflow.jobs['cross-version-wire'].steps
    const install = steps.findIndex(
      (step) => step.uses === './.github/actions/install-node-dependencies'
    )
    const pin = steps.findIndex((step) => step.name === 'Pin the fork release baseline')
    const fetch = steps.findIndex((step) => step.name === 'Fetch the upstream baseline refs')
    expect(install).toBeGreaterThanOrEqual(0)
    expect(pin).toBeGreaterThan(install)
    expect(fetch).toBeGreaterThan(pin)
    expect(steps[pin].run).toContain('resolveBaselineReleaseRef()')
    expect(steps[pin].run).toContain('MANTA_CROSS_VERSION_BASELINE_REF=')
    expect(steps[fetch].run).toContain('readCrossVersionPinnedRefs')
    expect(steps[fetch].run).not.toContain('git fetch --tags')
  })

  it('keeps the chosen fork candidate when upstream stable fixtures become available', () => {
    const forkTags = ['v1.4.202-rc.0', 'v1.4.202-rc.1']
    const forkBaseline = selectBaselineReleaseTag(forkTags)
    expect(forkBaseline).toBe('v1.4.202-rc.1')
    expect(selectBaselineReleaseTag([...forkTags, 'v1.4.199'])).toBe('v1.4.199')
    vi.stubEnv('MANTA_CROSS_VERSION_BASELINE_REF', forkBaseline)
    expect(resolveBaselineReleaseRef()).toBe(forkBaseline)
  })
})
