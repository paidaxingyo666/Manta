/**
 * Shape checks for the automation that turns a merged release commit into
 * pushed tags.
 *
 * Everything here fails silently in production if it drifts: a tag lands and no
 * build starts, or no tag lands at all, and the only symptom is a release that
 * never appears. None of it is caught by running the workflow, because the
 * workflow succeeds either way.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { pendingReleaseTags } from './pending-release-tags.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowsDir = join(projectDir, '.github/workflows')
const workflow = (file) => parse(readFileSync(join(workflowsDir, file), 'utf8'))
const autoReleaseText = readFileSync(join(workflowsDir, 'auto-release.yml'), 'utf8')

// `on:` parses as the boolean true — YAML 1.1, which the Actions parser is not.
const triggers = (parsed) => parsed.on ?? parsed[true]

/** Tag patterns each release workflow starts on, e.g. ['v*']. */
const tagTriggers = (file) => triggers(workflow(file))?.push?.tags ?? []

describe('auto release workflow contract', () => {
  it('runs on pushes to main', () => {
    expect(triggers(workflow('auto-release.yml')).push.branches).toEqual(['main'])
  })

  it('emits tags the release workflows actually trigger on', () => {
    // The coupling that breaks quietly: if a release workflow narrows its tag
    // pattern, the automation keeps pushing tags nothing listens for.
    const emitted = pendingReleaseTags(
      {
        desktop: '1.4.196-rc.0',
        previousDesktop: '1.4.193-rc.0',
        mobile: '0.0.47',
        previousMobile: '0.0.44'
      },
      () => false
    )
    const patterns = [
      ...tagTriggers('fork-release.yml'),
      ...tagTriggers('mobile-ios-release.yml'),
      ...tagTriggers('mobile-android-release.yml')
    ]
    const matches = (tag) =>
      patterns.some((pattern) => new RegExp(`^${pattern.replaceAll('*', '.*')}$`).test(tag))

    expect(emitted).toHaveLength(3)
    for (const tag of emitted) {
      expect(matches(tag), `${tag} matches no release workflow trigger`).toBe(true)
    }
  })

  it('pushes the tags with the deploy key, not the job token', () => {
    // A push made with GITHUB_TOKEN deliberately raises no events, so the tag
    // would land and nothing would build — a green run that shipped nothing.
    const steps = Object.values(workflow('auto-release.yml').jobs).flatMap((job) => job.steps ?? [])
    const push = steps.find((step) => String(step.run ?? '').includes('git push origin'))
    expect(push).toBeDefined()
    expect(push.env.DEPLOY_KEY).toContain('RELEASE_TAGGER_KEY')
    expect(push.run).toContain('GIT_SSH_COMMAND')
    expect(push.run).toContain('git@github.com:')
  })

  it('asks for no more write access than it uses', () => {
    // The tags go out over SSH, so the job token needs nothing but a checkout.
    expect(workflow('auto-release.yml').permissions).toEqual({ contents: 'read' })
  })

  it('stays green when the credential is missing', () => {
    // A setup gap must not read as a broken build, or every sync merge goes red
    // until someone sets a secret that has nothing to do with the sync.
    const steps = Object.values(workflow('auto-release.yml').jobs).flatMap((job) => job.steps ?? [])
    const push = steps.find((step) => String(step.run ?? '').includes('git push origin'))
    expect(push.if).toContain('present')
    expect(autoReleaseText).toContain('::warning::')
  })

  it('documents the setup the automation cannot do for itself', () => {
    expect(autoReleaseText).toContain('docs/reference/fork-release-automation.md')
    expect(
      readFileSync(join(projectDir, 'docs/reference/fork-release-automation.md'), 'utf8')
    ).toContain('RELEASE_TAGGER_KEY')
  })
})
