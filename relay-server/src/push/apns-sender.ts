import { connect, constants, type ClientHttp2Session } from 'node:http2'
import { ApnsProviderToken, type ApnsCredentials } from './apns-provider-token.js'

/**
 * Sends one push to APNs over a reused HTTP/2 session.
 *
 * Deliberately dependency-free: the relay ships two dependencies and this needs
 * neither a third nor a vendored SDK — node:http2 and node:crypto cover it.
 */

export const APNS_PRODUCTION_HOST = 'https://api.push.apple.com'
/**
 * Only a build signed with a development provisioning profile talks to this.
 * TestFlight and the App Store both use production, which is the single most
 * common reason a push that works in Xcode goes nowhere from TestFlight.
 */
export const APNS_SANDBOX_HOST = 'https://api.sandbox.push.apple.com'

export type ApnsSendResult =
  | { ok: true }
  /** The token is dead — 410 Unregistered, or 400 BadDeviceToken. Stop using it. */
  | { ok: false; retryable: false; discardToken: true; status: number; reason: string }
  | { ok: false; retryable: boolean; discardToken: false; status: number; reason: string }

export type ApnsRequest = {
  deviceToken: string
  /** The full APNs body, including the `aps` dictionary. */
  payload: Record<string, unknown>
  /** Replaces an undelivered push carrying the same id — how a backlog stays one line. */
  collapseId?: string
  /** 10 delivers at Apple's discretion (required for background pushes); 10 is immediate. */
  priority?: 5 | 10
  /** Seconds since epoch after which Apple stops trying. 0 means "one attempt only". */
  expiration?: number
}

const DEAD_TOKEN_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'])

export class ApnsSender {
  private readonly token: ApnsProviderToken
  private session: ClientHttp2Session | null = null

  constructor(
    credentials: ApnsCredentials,
    private readonly topic: string,
    private readonly host: string = APNS_PRODUCTION_HOST
  ) {
    this.token = new ApnsProviderToken(credentials)
  }

  async send(request: ApnsRequest): Promise<ApnsSendResult> {
    const first = await this.attempt(request)
    // Why one retry, only here: a provider token can be rejected because it aged
    // out mid-flight. Re-signing costs nothing and the alternative is dropping a
    // notification for a clock, not a fault.
    if (!first.ok && first.status === 403 && first.reason === 'InvalidProviderToken') {
      this.token.invalidate()
      return this.attempt(request)
    }
    return first
  }

  close(): void {
    this.session?.close()
    this.session = null
  }

  private connectSession(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) {
      return this.session
    }
    const session = connect(this.host)
    // Why swallow: an errored session is replaced on the next send; an unhandled
    // 'error' would take the relay process down with it.
    session.on('error', () => {
      if (this.session === session) {
        this.session = null
      }
    })
    session.on('close', () => {
      if (this.session === session) {
        this.session = null
      }
    })
    this.session = session
    return session
  }

  private attempt(request: ApnsRequest): Promise<ApnsSendResult> {
    return new Promise((resolve) => {
      let session: ClientHttp2Session
      try {
        session = this.connectSession()
      } catch (error) {
        resolve(failure(0, String(error), true))
        return
      }
      const headers: Record<string, string | number> = {
        [constants.HTTP2_HEADER_METHOD]: 'POST',
        [constants.HTTP2_HEADER_PATH]: `/3/device/${request.deviceToken}`,
        authorization: `bearer ${this.token.value()}`,
        'apns-topic': this.topic,
        'apns-push-type': 'alert',
        'apns-priority': request.priority ?? 10
      }
      if (request.collapseId) {
        headers['apns-collapse-id'] = request.collapseId
      }
      if (request.expiration !== undefined) {
        headers['apns-expiration'] = request.expiration
      }

      const stream = session.request(headers)
      let status = 0
      let body = ''
      stream.setEncoding('utf8')
      stream.on('response', (responseHeaders) => {
        status = Number(responseHeaders[constants.HTTP2_HEADER_STATUS] ?? 0)
      })
      stream.on('data', (chunk: string) => {
        body += chunk
      })
      stream.on('error', (error) => resolve(failure(0, String(error), true)))
      stream.on('end', () => {
        if (status === 200) {
          resolve({ ok: true })
          return
        }
        let reason = body
        try {
          reason = String(JSON.parse(body).reason ?? body)
        } catch {
          // APNs sends JSON on every failure; a non-JSON body is a proxy talking.
        }
        resolve(failure(status, reason, status === 429 || status >= 500))
      })
      stream.end(JSON.stringify(request.payload))
    })
  }
}

function failure(status: number, reason: string, retryable: boolean): ApnsSendResult {
  return DEAD_TOKEN_REASONS.has(reason)
    ? { ok: false, retryable: false, discardToken: true, status, reason }
    : { ok: false, retryable, discardToken: false, status, reason }
}
