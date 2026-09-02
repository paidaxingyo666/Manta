import { describe, expect, it, vi } from 'vitest'

const { submitFeedbackMock, prepareBundleMock } = vi.hoisted(() => ({
  submitFeedbackMock: vi.fn(),
  prepareBundleMock: vi.fn()
}))

vi.mock('./feedback', () => ({
  submitFeedback: submitFeedbackMock,
  hasFeedbackEndpoint: () => false
}))

vi.mock('../crash-reporting/crash-feedback-diagnostic-bundle', () => ({
  prepareCrashDiagnosticBundle: prepareBundleMock,
  diagnosticBundleForReportOnlyRetry: vi.fn(),
  resolveSubmittedDiagnosticBundle: vi.fn()
}))

import { submitCrashReport } from './crash-reporting-submission'
import { NO_FEEDBACK_ENDPOINT_ERROR } from '../../shared/crash-reporting'

/**
 * The shipped default has no feedback endpoint. Before this, the send button
 * still redacted and packed up to 4 MiB of logs, posted them at a host that
 * does not resolve, and handed back a network error — three wrong answers to
 * "there is nowhere to send this".
 */
describe('submitCrashReport with no endpoint configured', () => {
  it('refuses before building a diagnostic bundle it would throw away', async () => {
    const store = { get: vi.fn(), list: vi.fn(() => []) }

    const result = await submitCrashReport(store as never, {
      notes: 'It froze on quit.',
      includeDiagnosticLogs: true,
      submitAnonymously: true,
      githubLogin: null,
      githubEmail: null
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe(NO_FEEDBACK_ENDPOINT_ERROR)
    expect(prepareBundleMock).not.toHaveBeenCalled()
    expect(submitFeedbackMock).not.toHaveBeenCalled()
  })
})
