import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const prWorkflow = parse(readFileSync(join(projectDir, '.github/workflows/pr.yml'), 'utf8'))

const expensiveJobs = [
  'static_analysis',
  'typecheck',
  'git_compatibility',
  'codex_index_heal_contract',
  'xterm_patch_sync',
  'shell_contracts',
  'test',
  'mantad_browser',
  'relay',
  'cross-version-wire',
  'managed_hook_node18',
  'package',
  'package_windows'
]

describe('PR Checks skip wiring', () => {
  it('runs the candidate daemon shutdown Docker oracle in the existing Linux package job', () => {
    const steps = prWorkflow.jobs.package.steps
    const install = steps.findIndex(
      (step) => step.uses === './.github/actions/install-node-dependencies'
    )
    const oracle = steps.findIndex(
      (step) => step.name === 'Verify Linux daemon shutdown descendant cleanup'
    )
    expect(install).toBeGreaterThan(-1)
    expect(oracle).toBeGreaterThan(install)
    expect(steps[oracle].run).toBe('node config/scripts/run-daemon-shutdown-descendants-docker.mjs')
    expect(steps[oracle].env.MANTA_BACKGROUND_LAUNCH).toBe('1')
  })

  it('classifies the PR range with a tested script and expands renames', () => {
    const classify = prWorkflow.jobs.code_paths.steps.find(
      (step) => step.name === 'Classify changed paths'
    )
    expect(classify.run).toContain('--diff-filter=ACDMR')
    expect(classify.run).toContain('--no-renames')
    // HEAD is the merge commit, so HEAD^1 is the base side and no merge base is computed.
    // That is what lets this job check out shallowly, which every other job waits on.
    expect(classify.run).toContain('node config/scripts/git-pull-request-diff-base.mjs "$BASE_SHA"')
    expect(classify.run).toContain('"$DIFF_BASE" HEAD')
    expect(classify.run).not.toContain('--merge-base "$')
    expect(classify.run).toContain('node config/scripts/pr-code-change-scope.mjs')
    expect(classify.run).toContain('tee -a "$GITHUB_OUTPUT"')
    expect(prWorkflow.jobs.code_paths.outputs.should_run).toBe(
      '${{ steps.filter.outputs.should_run }}'
    )
    for (const jobName of expensiveJobs) {
      expect(prWorkflow.jobs.code_paths.outputs[jobName], jobName).toBe(
        `\${{ steps.readiness.outputs.reused != 'true' && steps.filter.outputs.${jobName} }}`
      )
    }
  })

  it('gives static analysis the mobile types its type-aware pass resolves', () => {
    expect(prWorkflow.jobs.code_paths.outputs.mobile_dependencies).toBe(
      '${{ steps.filter.outputs.mobile_dependencies }}'
    )
    const steps = prWorkflow.jobs.preflight.steps
    const install = steps.findIndex(
      (step) => step.uses === './.github/actions/install-mobile-dependencies'
    )
    const gate = steps.findIndex((step) => step.name === 'Enforce changed-code quality')
    expect(install).toBeGreaterThan(-1)
    expect(install).toBeLessThan(gate)
    expect(steps[install].if).toBe(
      "needs.code_paths.outputs.static_analysis == 'true' && needs.code_paths.outputs.mobile_dependencies == 'true'"
    )
    // The install itself moved into the action the packaging jobs share; assert it there so
    // this job cannot keep the step while the action stops installing anything.
    const action = parse(
      readFileSync(
        join(projectDir, '.github/actions/install-mobile-dependencies/action.yml'),
        'utf8'
      )
    )
    const [installStep] = action.runs.steps
    expect(installStep['working-directory']).toBe('mobile')
    expect(installStep.run).toContain('--frozen-lockfile')
  })

  it('keeps the root and README guards on docs-only PRs without another runner', () => {
    const detector = prWorkflow.jobs.code_paths
    expect(detector.if).toBeUndefined()
    expect(detector.needs).toBeUndefined()
    for (const name of ['Reject new root-level files and folders', 'Check README local links']) {
      const step = detector.steps.find((candidate) => candidate.name === name)
      expect(step).toBeDefined()
      expect(step.if).toBeUndefined()
    }
    expect(prWorkflow.jobs.root_directory_guard).toBeUndefined()
  })

  it('gates each expensive job on its classifier and cache prerequisite', () => {
    for (const jobName of expensiveJobs.filter(
      (jobName) => !['test', 'static_analysis', 'typecheck'].includes(jobName)
    )) {
      expect(prWorkflow.jobs[jobName].needs, jobName).toEqual(['code_paths', 'preflight'])
      expect(prWorkflow.jobs[jobName].if, jobName).toContain(
        `needs.code_paths.outputs.${jobName} == 'true'`
      )
    }
    expect(prWorkflow.jobs.test.if).toContain("needs.preflight.result == 'success'")
    expect(prWorkflow.jobs.test.if).toContain("needs.code_paths.outputs.test == 'true'")
    expect(prWorkflow.jobs.test.with.shards).toBe('${{ needs.preflight.outputs.shards }}')
    expect(prWorkflow.jobs.unit_plan).toBeUndefined()
    expect(prWorkflow.jobs.test_native_cache).toBeUndefined()
  })

  it('skips e2e detection on docs-only PRs without dropping the draft gate', () => {
    const filter = prWorkflow.jobs.code_paths.steps.find((step) => step.id === 'e2e_filter')
    expect(filter.if).toBe(
      "github.event.pull_request.draft != true && steps.filter.outputs.should_run == 'true'"
    )
    expect(prWorkflow.jobs['e2e-paths']).toBeUndefined()
  })

  it('lets verify pass skipped jobs the classifier turned off', () => {
    const verifyStep = prWorkflow.jobs.verify.steps.find(
      (step) => step.name === 'Require successful checks'
    )
    expect(prWorkflow.jobs.verify.needs[0]).toBe('code_paths')
    expect(verifyStep.env.SHOULD_RUN).toBe('${{ needs.code_paths.outputs.should_run }}')
    expect(verifyStep.run).toContain('"$CODE_PATHS" != "success"')
    expect(verifyStep.run).toContain('# Require success when the PR has code-relevant changes')
    expect(verifyStep.run).toContain('expected skipped')
    expect(verifyStep.run).toContain('expected success')
    for (const job of prWorkflow.jobs.verify.needs) {
      if (job === 'code_paths' || job === 'preflight') {
        continue
      }
      const envVar = `${job.replaceAll('-', '_').toUpperCase()}_SHOULD_RUN`
      expect(verifyStep.env[envVar]).toBe(`\${{ needs.code_paths.outputs.${job} }}`)
      expect(verifyStep.run).toContain(`"$${envVar}"`)
    }
  })
})
