import { describe, expect, it } from 'vitest'
import { pluginConsentRequestSchema } from './plugin-consent-request'

describe('pluginConsentRequestSchema', () => {
  it('requires the exact reviewed consent fingerprint', () => {
    expect(
      pluginConsentRequestSchema.safeParse({
        pluginKey: 'manta-samples.demo',
        decision: 'approve'
      }).success
    ).toBe(false)
    expect(
      pluginConsentRequestSchema.safeParse({
        pluginKey: 'manta-samples.demo',
        reviewedFingerprint: '',
        decision: 'approve'
      }).success
    ).toBe(false)
  })

  it('accepts an explicit opaque fingerprint and rejects contract drift', () => {
    expect(
      pluginConsentRequestSchema.parse({
        pluginKey: 'manta-samples.demo',
        reviewedFingerprint: 'sha256-reviewed',
        decision: 'keep-disabled'
      })
    ).toEqual({
      pluginKey: 'manta-samples.demo',
      reviewedFingerprint: 'sha256-reviewed',
      decision: 'keep-disabled'
    })
    expect(() =>
      pluginConsentRequestSchema.parse({
        pluginKey: 'manta-samples.demo',
        reviewedFingerprint: 'sha256-reviewed',
        decision: 'approve',
        unexpected: true
      })
    ).toThrow()
  })
})
