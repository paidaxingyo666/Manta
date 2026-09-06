/**
 * Shape checks for the fork's own release workflow.
 *
 * Split out of package-electron-runtime-contract.test.mjs, which describes
 * upstream's release path and grows every time upstream adds a platform. Two
 * files that upstream never touches stay mergeable; one shared file does not.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflow = () =>
  parse(readFileSync(join(projectDir, '.github/workflows/fork-release.yml'), 'utf8'))

describe('fork release workflow contract', () => {
  // Upstream's pnpm 12 upgrade migrated the twenty workflows that exist
  // upstream to `pnpm/setup@v2`; this file exists only here, so nothing
  // migrated it, and the version pin it kept fought the packageManager field.
  // Whatever pnpm action the shared workflows use, the fork's must use too —
  // the check reads the answer from a workflow upstream maintains rather than
  // hard-coding a version that will move again.
  it("sets up pnpm the same way upstream's workflows do", () => {
    const dir = join(projectDir, '.github/workflows')
    const pnpmSteps = (file) =>
      Object.values(parse(readFileSync(join(dir, file), 'utf8')).jobs ?? {})
        .flatMap((job) => job.steps ?? [])
        .filter((step) => String(step.uses ?? '').startsWith('pnpm/'))
        .map((step) => String(step.uses))
    // Upstream's own workflows (gated on their repository slug) never run here
    // and may pin whatever they like; the contract is with the ones that do.
    // Two guards mean the same thing: a workflow that cannot run here. The second
    // arrived with upstream's cloud-operations family, gated on a repository
    // variable this fork never sets — and which pins a different pnpm action, so
    // counting it made the shared set disagree with itself.
    const upstreamOnly = (file) => {
      const text = readFileSync(join(dir, file), 'utf8')
      return (
        text.includes("github.repository == 'stablyai/orca'") ||
        text.includes('ORCA_CLOUD_OPERATIONS_ENABLED')
      )
    }
    const shared = readdirSync(dir)
      .filter((f) => f.endsWith('.yml') && f !== 'fork-release.yml' && f !== 'relay-release.yml')
      .filter((f) => !upstreamOnly(f))
      .flatMap(pnpmSteps)
    // The majority, not the only one: upstream's cloud-verify runs here and pins
    // pnpm/action-setup@v4 while everything else is on pnpm/setup@v2, so the
    // uniformity this once asserted no longer holds upstream. What still matters
    // is that the fork's release workflows do not drift onto an action upstream
    // has left behind, and the action most of its workflows use is that answer.
    const tally = new Map()
    for (const uses of shared) {
      tally.set(uses, (tally.get(uses) ?? 0) + 1)
    }
    expect(tally.size, 'no shared workflow sets up pnpm').toBeGreaterThan(0)
    const canonical = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]
    for (const own of ['fork-release.yml', 'relay-release.yml']) {
      for (const uses of pnpmSteps(own)) {
        expect(uses, `${own} must use the pnpm action most shared workflows use`).toBe(canonical)
      }
    }
  })

  // The fork's own release path is a separate file, and it escaped the check
  // above by exactly the margin that matters: it shipped `&&` on the Windows
  // leg, which Windows PowerShell 5.1 rejects while parsing — before either
  // command runs, so every retry fails in the same second.
  it('keeps the fork release workflow off `&&` on Windows', () => {
    const release = workflow()
    const packStep = (job) =>
      release.jobs[job].steps.find(
        (step) =>
          String(step.uses ?? '').startsWith('nick-fields/retry') &&
          String(step.with?.command ?? '').includes('electron-builder')
      )

    const win = packStep('windows').with.command
    expect(win).toContain(
      '; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; pnpm exec electron-builder '
    )
    expect(win).not.toContain(' && ')

    // macOS and Linux run under bash, where `&&` is the right separator.
    const mac = packStep('macos').with.command
    expect(mac).toContain(' && MANTA_MAC_RELEASE=1 ')

    const linux = packStep('linux').with.command
    expect(linux).toContain(' && pnpm exec electron-builder ')
    // A CLI target list replaces the config's outright, so this is the only
    // place rpm is asked for — and verify-release-required-assets.mjs requires
    // both rpms before it will let a release out of draft.
    expect(linux).toContain('--linux AppImage deb rpm')
  })

  // A retry budget larger than the job it runs in is not a retry budget: the
  // last attempt is cut off partway and the failure reads as a job timeout
  // rather than as whatever actually stalled.
  it('fits the fork release retries inside their job timeouts', () => {
    const release = workflow()
    for (const name of ['macos', 'windows', 'linux']) {
      const job = release.jobs[name]
      const worst = job.steps
        .filter((step) => String(step.uses ?? '').startsWith('nick-fields/retry'))
        .reduce((total, step) => total + step.with.timeout_minutes * step.with.max_attempts, 0)
      expect(worst).toBeLessThanOrEqual(job['timeout-minutes'])
    }
  })
})
