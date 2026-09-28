import os from 'node:os'
import { NO_FEEDBACK_ENDPOINT_ERROR } from '../../shared/crash-reporting'
import { app, ipcMain } from 'electron'
import {
  readFeedbackImagesDelivered,
  validateFeedbackImages,
  type FeedbackImageAttachment
} from './feedback-image-attachments'
import {
  errorFailure,
  messageFromError,
  postFeedback,
  responseFailure
} from './feedback-request-transport'
import type {
  FeedbackDiagnosticBundleAttachment,
  FeedbackSubmissionType,
  FeedbackSubmitBody
} from './feedback-submit-body'
import type {
  FeedbackRequestFailure,
  FeedbackSubmitArgs,
  FeedbackSubmitResult
} from '../../shared/feedback-submit-contract'

export type {
  FeedbackDiagnosticBundleAttachment,
  FeedbackImageAttachment,
  FeedbackRequestFailure,
  FeedbackSubmissionType,
  FeedbackSubmitArgs,
  FeedbackSubmitResult
}

// Upstream serves this endpoint; this fork does not. The feedback dialog now
// hands its text to a GitHub issue instead, and the crash reporter has nowhere
// to send to — so with nothing configured the submit path answers immediately
// rather than spending a 10s timeout plus a retry on a host that never resolves.
// MANTA_FEEDBACK_API_URL points it at a collector the operator runs.
export function hasFeedbackEndpoint(): boolean {
  return resolveFeedbackApiUrl() !== null
}

function resolveFeedbackApiUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.MANTA_FEEDBACK_API_URL?.trim()
  if (!configured) {
    return null
  }
  // Reports carry the sender's GitHub identity, screenshots, and up to 4 MiB of
  // diagnostic logs, so the same HTTPS floor the artifact endpoint has applies
  // here. A malformed value is a configuration mistake, not a reason to put all
  // that on the wire in the clear.
  try {
    const url = new URL(configured)
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) {
      return url.toString()
    }
  } catch {
    // fall through
  }
  console.warn('[feedback] ignoring MANTA_FEEDBACK_API_URL: not an HTTPS (or loopback) URL')
  return null
}
const FEEDBACK_ATTACHMENT_REQUEST_TIMEOUT_MS = 60_000
// Why: corporate filters can reject multipart with 403 and hosts cap body size
// (413) while allowing the small JSON report, so content-shaped failures should
// shed the attachment.
const ATTACHMENT_JSON_RETRY_STATUSES = new Set([400, 403, 408, 413, 415, 422])

type InternalFeedbackSubmitArgs = FeedbackSubmitArgs & {
  submissionType?: FeedbackSubmissionType
  diagnosticBundle?: FeedbackDiagnosticBundleAttachment
  feedbackWithoutDiagnosticBundle?: string
}

// Why: the Slack notification and any follow-up investigation need to know
// which Manta build and which OS the feedback came from. The main process is
// the only place with trusted access to these values (app.getVersion and the
// node os module), so we enrich the payload here rather than trusting the
// renderer.
function buildSubmitBody(args: InternalFeedbackSubmitArgs): FeedbackSubmitBody {
  const identity = args.submitAnonymously
    ? { githubLogin: null, githubEmail: null }
    : { githubLogin: args.githubLogin, githubEmail: args.githubEmail }

  // Why: anonymity is an IPC-only privacy decision. Allow-list fields here so
  // stale renderer state or future identity-shaped fields cannot leak upstream.
  return {
    feedback: args.feedback,
    submissionType: args.submissionType ?? 'feedback',
    ...identity,
    appVersion: app.getVersion(),
    platform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    ...(args.submissionType === 'crash' && args.diagnosticBundle
      ? { diagnosticBundle: args.diagnosticBundle }
      : {}),
    // Why: images are a feedback-only affordance; crash reports already carry
    // diagnostic bundles and the server rejects images on that lane.
    ...(args.submissionType !== 'crash' && args.images?.length ? { images: args.images } : {})
  }
}

async function retryFeedbackOnPrimary(
  apiUrl: string,
  body: FeedbackSubmitBody,
  primaryError?: unknown
): Promise<FeedbackSubmitResult> {
  try {
    const retry = await postFeedback(apiUrl, body)
    if (retry.ok) {
      return { ok: true }
    }
    const retryMessage = `status ${retry.status}`
    if (primaryError === undefined) {
      return { ok: false, status: retry.status, error: retryMessage }
    }
    // Why: keep the first failure visible so support can see 5xx → retry outcome,
    // not only the last error in a same-host retry chain.
    return {
      ok: false,
      status: retry.status,
      error: `${messageFromError(primaryError)}; retry: ${retryMessage}`
    }
  } catch (retryError) {
    const message = messageFromError(retryError)
    if (primaryError === undefined) {
      return { ok: false, status: null, error: message }
    }
    return {
      ok: false,
      status: null,
      error: `${messageFromError(primaryError)}; retry: ${message}`
    }
  }
}

function shouldRetryWithoutDiagnosticBundle(status: number): boolean {
  return ATTACHMENT_JSON_RETRY_STATUSES.has(status) || status === 404 || status >= 500
}

/** Posts the attachment-free report; resolves to the failure, or null once it lands. */
async function postFeedbackWithoutAttachment(
  apiUrl: string,
  body: FeedbackSubmitBody
): Promise<FeedbackRequestFailure | null> {
  try {
    const response = await postFeedback(apiUrl, body)
    return response.ok ? null : responseFailure(response)
  } catch (error) {
    return errorFailure(error)
  }
}

async function submitFeedbackWithoutDiagnosticBundle(
  apiUrl: string,
  body: FeedbackSubmitBody,
  diagnosticBundleFailure: FeedbackRequestFailure
): Promise<FeedbackSubmitResult> {
  const failure = await postFeedbackWithoutAttachment(apiUrl, body)
  return failure
    ? { ok: false, ...failure, diagnosticBundleFailure }
    : { ok: true, diagnosticBundleFailure }
}

async function submitFeedbackWithImages(
  apiUrl: string,
  body: FeedbackSubmitBody,
  bodyWithoutImages: FeedbackSubmitBody
): Promise<FeedbackSubmitResult> {
  try {
    let imagesDelivered = true
    const response = await postFeedback(
      apiUrl,
      body,
      FEEDBACK_ATTACHMENT_REQUEST_TIMEOUT_MS,
      async (nextResponse) => {
        imagesDelivered = nextResponse.ok ? await readFeedbackImagesDelivered(nextResponse) : true
      }
    )
    if (response.ok) {
      return { ok: true, imagesDelivered }
    }
    const imagesFailure = responseFailure(response)
    if (ATTACHMENT_JSON_RETRY_STATUSES.has(response.status)) {
      const failure = await postFeedbackWithoutAttachment(apiUrl, bodyWithoutImages)
      return failure
        ? {
            ok: false,
            status: failure.status,
            error: `${imagesFailure.error}; retry: ${failure.error}`
          }
        : { ok: true, imagesDelivered: false, imagesFailure }
    }
    // Why: the text lane retries 5xx, this one does not. Replaying the
    // attachments on a flaky link costs more than it saves, and the caller
    // still holds the draft and images, so a manual resend loses nothing.
    return { ok: false, ...imagesFailure }
  } catch (error) {
    return { ok: false, ...errorFailure(error) }
  }
}

async function submitFeedbackWithDiagnosticBundle(
  apiUrl: string,
  body: FeedbackSubmitBody,
  bodyWithoutDiagnosticBundle: FeedbackSubmitBody | null
): Promise<FeedbackSubmitResult> {
  try {
    // Why: diagnostic bundles can approach 4 MiB and need more upload time than
    // the small JSON report-only path, especially on constrained connections.
    const response = await postFeedback(apiUrl, body, FEEDBACK_ATTACHMENT_REQUEST_TIMEOUT_MS)
    if (response.ok) {
      return { ok: true }
    }
    const failure = responseFailure(response)
    if (bodyWithoutDiagnosticBundle && shouldRetryWithoutDiagnosticBundle(response.status)) {
      return submitFeedbackWithoutDiagnosticBundle(apiUrl, bodyWithoutDiagnosticBundle, failure)
    }
    return { ok: false, ...failure }
  } catch (error) {
    const failure = errorFailure(error)
    return bodyWithoutDiagnosticBundle
      ? submitFeedbackWithoutDiagnosticBundle(apiUrl, bodyWithoutDiagnosticBundle, failure)
      : { ok: false, ...failure }
  }
}

export async function submitFeedback(
  args: InternalFeedbackSubmitArgs
): Promise<FeedbackSubmitResult> {
  const apiUrl = resolveFeedbackApiUrl()
  if (!apiUrl) {
    return {
      ok: false,
      status: null,
      error: NO_FEEDBACK_ENDPOINT_ERROR
    }
  }
  // Why: buildSubmitBody drops images on the crash lane, so validating them
  // there would abort a crash report over attachments it never meant to send.
  if (args.submissionType !== 'crash' && args.images !== undefined) {
    const imageError = validateFeedbackImages(args.images)
    if (imageError) {
      return { ok: false, status: null, error: imageError }
    }
  }
  const body = buildSubmitBody(args)
  if (body.images?.length) {
    return submitFeedbackWithImages(apiUrl, body, buildSubmitBody({ ...args, images: undefined }))
  }
  if (body.diagnosticBundle) {
    const bodyWithoutDiagnosticBundle =
      args.feedbackWithoutDiagnosticBundle !== undefined
        ? buildSubmitBody({
            ...args,
            feedback: args.feedbackWithoutDiagnosticBundle,
            diagnosticBundle: undefined
          })
        : null
    return submitFeedbackWithDiagnosticBundle(apiUrl, body, bodyWithoutDiagnosticBundle)
  }
  try {
    const res = await postFeedback(apiUrl, body)
    if (res.ok) {
      return { ok: true }
    }
    if (res.status >= 500) {
      return retryFeedbackOnPrimary(apiUrl, body, new Error(`status ${res.status}`))
    }
    return { ok: false, status: res.status, error: `status ${res.status}` }
  } catch (error) {
    return retryFeedbackOnPrimary(apiUrl, body, error)
  }
}

export function registerFeedbackHandlers(): void {
  ipcMain.removeHandler('feedback:submit')
  ipcMain.handle('feedback:submit', (_event, args: FeedbackSubmitArgs) => {
    // Why: validate the raw clone before normalization so a tiny hostile value
    // cannot become a large main-process typed-array allocation.
    if (args.images !== undefined) {
      const imageError = validateFeedbackImages(args.images)
      if (imageError) {
        return { ok: false, status: null, error: imageError }
      }
    }
    // Why: crash submissions are main-only. A compromised renderer can invoke
    // this channel directly, so force the public feedback lane at the boundary.
    return submitFeedback({
      ...args,
      submissionType: 'feedback'
    })
  })
}
