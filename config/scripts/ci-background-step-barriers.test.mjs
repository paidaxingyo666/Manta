import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const pr = parse(readFileSync('.github/workflows/pr.yml', 'utf8'))
const mobile = parse(readFileSync('.github/workflows/mobile.yml', 'utf8'))
const cloud = parse(readFileSync('.github/workflows/cloud-verify.yml', 'utf8'))

function assertJoinedBefore(steps, id, consumer) {
  const start = steps.findIndex((step) => step.id === id)
  const join = steps.findIndex((step) => [step.wait].flat().includes(id))
  const end = steps.findIndex(consumer)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(steps[start].background).toBe(true)
  expect(join).toBeGreaterThan(start)
  expect(end).toBeGreaterThan(join)
}

describe('CI background step barriers', () => {
  it('joins every background check without suppressing failures', () => {
    for (const job of [
      pr.jobs.static_analysis,
      pr.jobs.mobile_web_app,
      pr.jobs.package,
      mobile.jobs.verify,
      cloud.jobs.security
    ]) {
      const pending = new Set()
      for (const step of job.steps) {
        if (step.background) {
          expect(step.id).toBeTruthy()
          expect(pending.has(step.id)).toBe(false)
          expect(step['continue-on-error']).toBeUndefined()
          pending.add(step.id)
        }
        if (step.wait) {
          expect(step.if).toBeUndefined()
          expect(step['continue-on-error']).toBeUndefined()
          for (const id of [step.wait].flat()) {
            expect(pending.delete(id), `missing background step ${id}`).toBe(true)
          }
        }
        expect(pending.size).toBeLessThanOrEqual(3)
      }
      expect([...pending]).toEqual([])
    }
  })

  it('finishes native import-cycle analysis before mobile installation changes resolution', () => {
    const steps = pr.jobs.static_analysis.steps
    assertJoinedBefore(steps, 'native-code-quality', (step) =>
      step.uses?.endsWith('/install-mobile-dependencies')
    )
    const install = steps.findIndex((step) => step.uses?.endsWith('/install-mobile-dependencies'))
    expect(steps[install].background).toBeUndefined()
    expect(steps.findIndex((step) => step.id === 'changed-code-quality')).toBeGreaterThan(install)
  })

  it('finishes both mobile typechecks before allocating test workers', () => {
    const steps = mobile.jobs.verify.steps
    assertJoinedBefore(steps, 'production-types', (step) => step.name === 'Test')
    const ratchet = steps.findIndex((step) => step.name === 'Typecheck tests (ratchet)')
    const join = steps.findIndex((step) => step.wait === 'production-types')
    expect(steps[ratchet].background).toBeUndefined()
    expect(ratchet).toBeLessThan(join)
  })

  it('waits for WebKit and the bundle before any browser tests', () => {
    const steps = pr.jobs.mobile_web_app.steps
    assertJoinedBefore(steps, 'webkit', (step) =>
      step.run?.includes('run-mobile-web-app-checks.mjs')
    )
    const build = steps.findIndex((step) => step.name === 'Build and verify the app bundle')
    expect(steps[build].background).toBeUndefined()
    expect(build).toBeLessThan(steps.findIndex((step) => step.wait === 'webkit'))
    expect(steps.findIndex((step) => step.id === 'webkit')).toBeLessThan(build)
  })

  it('joins package setup before reading outputs and preserves isolated native probes', () => {
    const steps = pr.jobs.package.steps
    for (const [id, consumer] of [
      ['linux-package-tools', 'Package unpacked app'],
      ['shutdown-fixture-cache', 'Verify headless serve signal shutdown'],
      ['cli-fixture-cache', 'Verify Linux CLI launch contract']
    ]) {
      assertJoinedBefore(steps, id, (step) => step.name === consumer)
      expect(steps.findIndex((step) => step.id === id)).toBeGreaterThan(
        steps.findIndex((step) => step.name === 'Test Linux Electron lifecycle boundary')
      )
    }
  })

  it('joins digest-pinned scanner downloads and the history scan without hiding failures', () => {
    const steps = cloud.jobs.security.steps
    const history = steps.findIndex((step) => step.name === 'Fetch complete scan history')
    for (const [id, imageName] of [
      ['gitleaks-image', 'gitleaks'],
      ['trufflehog-image', 'trufflehog']
    ]) {
      const download = steps.find((step) => step.id === id)
      const scan = steps.find(
        (step) => step.run?.includes('docker run') && step.run.includes(imageName)
      )
      const digestImage = scan.run.match(/\S+@sha256:[a-f0-9]{64}/)[0]
      expect(download.run).toBe(`docker pull ${digestImage}`)
      expect(steps.indexOf(download)).toBeLessThan(history)
      assertJoinedBefore(steps, id, (step) => step === scan)
      expect(steps.indexOf(scan)).toBeGreaterThan(history)
      expect(scan.run).toContain('/repo:ro')
    }
    expect(steps.at(-1).wait).toBe('history-scan')
  })
})
