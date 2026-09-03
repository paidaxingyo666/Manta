/**
 * Branch protection on main requires `verify` and `Mobile Checks`. This pins the
 * two ways that arrangement breaks without anyone noticing until a pull request
 * refuses to merge.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflowsDir = resolve(import.meta.dirname, '../../.github/workflows')
const workflows = readdirSync(workflowsDir)
  .filter((file) => file.endsWith('.yml'))
  .map((file) => ({ file, parsed: parse(readFileSync(join(workflowsDir, file), 'utf8')) }))

// `on:` parses as the boolean true — YAML 1.1, which the Actions parser is not.
const triggers = (parsed) => parsed.on ?? parsed[true]

/** Every job whose check-run name is `name`, across all workflows. */
const jobsNamed = (name) =>
  workflows.flatMap(({ file, parsed }) =>
    Object.entries(parsed.jobs ?? {})
      .filter(([id, job]) => (job.name ?? id) === name)
      .map(([id, job]) => ({ file, id, job }))
  )

const REQUIRED = ['verify', 'Mobile Checks']

describe('required status checks', () => {
  it.each(REQUIRED)('%s is reported on every pull request', (name) => {
    // A workflow skipped by a `paths:` filter creates no check run at all, so a
    // pull request that misses those paths waits forever on a context that will
    // never appear. `Mobile Checks` was filtered that way and blocked a release
    // PR that touched no mobile file. Filtering has to happen at the job, with
    // an `if:` — a job skipped that way still reports, and counts as passing.
    const jobs = jobsNamed(name)
    expect(jobs.length, `no job produces the required check ${name}`).toBeGreaterThan(0)
    for (const { file, parsed } of jobs.map((entry) => ({
      ...entry,
      parsed: workflows.find((w) => w.file === entry.file).parsed
    }))) {
      const pullRequest = triggers(parsed)?.pull_request
      expect(pullRequest, `${file} does not run on pull_request`).toBeDefined()
      expect(pullRequest?.paths, `${file} filters ${name} at the trigger`).toBeUndefined()
      expect(
        pullRequest?.['paths-ignore'],
        `${file} filters ${name} at the trigger`
      ).toBeUndefined()
    }
  })

  it.each(REQUIRED)('%s is produced by exactly one job', (name) => {
    // Two jobs sharing a check name are one context to branch protection, and
    // the red one hides behind the green one. pr.yml's gate and mobile.yml's job
    // were both `verify` until mobile's was given a display name.
    expect(jobsNamed(name).map(({ file, id }) => `${file}:${id}`)).toHaveLength(1)
  })
})
