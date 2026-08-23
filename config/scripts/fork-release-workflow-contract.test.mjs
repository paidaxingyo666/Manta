/**
 * Shape checks for the fork's own release workflow.
 *
 * Split out of package-electron-runtime-contract.test.mjs, which describes
 * upstream's release path and grows every time upstream adds a platform. Two
 * files that upstream never touches stay mergeable; one shared file does not.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflow = () =>
  parse(readFileSync(join(projectDir, '.github/workflows/fork-release.yml'), 'utf8'))

describe('fork release workflow contract', () => {
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
