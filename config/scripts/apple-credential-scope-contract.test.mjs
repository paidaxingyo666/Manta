/**
 * The Apple signing credentials must stay unreachable from anything automatic.
 *
 * This fork signs macOS releases with one person's Developer ID and notarizes
 * with one person's Apple ID. Upstream's dev-channel workflows are wired to the
 * same secret names and one of them is hourly — they cannot succeed here, but
 * they can sign, and repointing a runner label reads like tidying up a broken
 * workflow rather than like handing out a certificate.
 *
 * Three things keep that from happening, and none of them is visible in a diff
 * on its own: a job guard that points at upstream, a GitHub-side disable, and an
 * environment whose deployment policy admits only `v*` tags. The disable and the
 * policy live in repository settings where no review can see them. The guards
 * live in files this fork merges from upstream, where a conflict resolved the
 * wrong way silently undoes them.
 *
 * So this is the part that can actually fail a build, and it is deliberately
 * about shape rather than behaviour.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowDir = join(projectDir, '.github/workflows')

const readWorkflow = (name) => parse(readFileSync(join(workflowDir, name), 'utf8'))
const readRaw = (name) => readFileSync(join(workflowDir, name), 'utf8')

/** Upstream's dev-channel mac builds. Every one is wired to MAC_CERTS. */
const DEV_CHANNEL_MAC = [
  ['hourly', 'hourly-mac-build.yml', 'build-hourly-mac'],
  ['daily', 'daily-mac-build.yml', 'build-daily-mac'],
  ['adhoc', 'adhoc-mac-build.yml', 'build-adhoc-mac']
]

/**
 * The names that are actually credentials.
 *
 * APPLE_TEAM_ID is deliberately absent: it is a public team identifier, it is
 * useless without the other four, and mobile-ios-release.yml needs it from a
 * job that has no environment.
 */
const CREDENTIALS = ['MAC_CERTS', 'MAC_CERTS_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD']

const RELEASE_ENVIRONMENT = 'apple-signing'

describe('Apple credential scope', () => {
  it.each(DEV_CHANNEL_MAC)(
    'keeps the %s mac build pointed at upstream so this fork never runs it',
    (_channel, file, jobName) => {
      const job = readWorkflow(file).jobs[jobName]

      // Not `!== 'paidaxingyo666/Manta'`: the point is that the job is skipped
      // here, and only an exact upstream guard guarantees that.
      expect(job.if).toBe("github.repository == 'stablyai/orca'")
    }
  )

  it.each(DEV_CHANNEL_MAC)('keeps the %s schedule switched off', (_channel, file) => {
    const on = readWorkflow(file).on ?? readWorkflow(file)[true]

    // A cron here fires against the default branch's copy of the file, so it
    // outlives any branch-level care taken elsewhere.
    expect(on.schedule).toBeUndefined()
  })

  it('reads the Apple credentials only from the credential-scoped environment', () => {
    const offenders = []
    for (const file of [
      'hourly-mac-build.yml',
      'daily-mac-build.yml',
      'adhoc-mac-build.yml',
      'release-mac-build.yml',
      'fork-release.yml',
      'mobile-ios-release.yml',
      'dev-channel-win-build.yml',
      'release-cut.yml'
    ]) {
      const workflow = readWorkflow(file)
      for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
        const body = JSON.stringify(job)
        const used = CREDENTIALS.filter((name) => body.includes(`secrets.${name}`))
        if (used.length === 0) {
          continue
        }
        const skippedInThisFork = job.if === "github.repository == 'stablyai/orca'"
        if (skippedInThisFork || job.environment === RELEASE_ENVIRONMENT) {
          continue
        }
        offenders.push(`${file}:${jobName} reads ${used.join(', ')}`)
      }
    }

    // A job that reads these without the environment reads whatever exists at
    // repository scope — which is why the five secrets must be created with
    // `--env apple-signing` and must not also exist as repository secrets.
    expect(offenders).toEqual([])
  })

  it('gates the release signing job on the environment rather than on a guard alone', () => {
    const macos = readWorkflow('fork-release.yml').jobs.macos

    expect(macos.environment).toBe(RELEASE_ENVIRONMENT)
  })

  it('leaves the release workflow with no way to run from a branch', () => {
    const workflow = readWorkflow('fork-release.yml')
    const on = workflow.on ?? workflow[true]

    // A `tag` input would let a dispatch from a branch look right for forty
    // minutes and then die at the environment gate. The ref is the tag.
    expect(on.workflow_dispatch ?? null).toBeNull()
    expect(on.push.tags).toEqual(['v*'])
    expect(JSON.stringify(workflow)).not.toContain('inputs.tag')
  })

  it('does not invite anyone to move credentials into the environment that has no rules', () => {
    // Referencing an environment that does not exist creates it on first use
    // with no protection rules at all. Upstream's comment here used to name the
    // five secrets as an intended follow-up.
    const adhoc = readRaw('adhoc-mac-build.yml')

    expect(adhoc).toContain('Do not put credentials here')

    // Comments that merely name a credential are fine — several of them warn
    // about it. What must not come back is one that says to put it here.
    const invitations = adhoc
      .split('\n')
      .filter((line) => line.trimStart().startsWith('#'))
      .filter((line) => /\bmove\b/i.test(line) || /follow-up/i.test(line))
      .filter((line) => CREDENTIALS.some((name) => line.includes(name)))
    expect(invitations).toEqual([])
  })
})
