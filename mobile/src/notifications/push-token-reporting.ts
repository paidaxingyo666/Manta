import { readDevicePushToken } from './device-push-token'

/**
 * Tells the desktop where this phone can be reached while its socket is gone.
 *
 * Sent on every connect, not once at pair time. A push token is not stable —
 * reinstalling, restoring a backup, and some OS updates each mint a new one —
 * and the desktop has no way to discover a replacement except by being told.
 * Re-sending an unchanged token is free; the desktop overwrites.
 */

type Client = {
  sendRequest: (method: string, params: unknown) => Promise<{ ok: boolean }>
}

export type PushTokenReport =
  | { reported: true }
  | { reported: false; reason: 'not-permitted' | 'unavailable' | 'failed' | 'rejected' }

export async function reportPushToken(client: Client): Promise<PushTokenReport> {
  const token = await readDevicePushToken()
  if (token.status !== 'ready') {
    // None of these are errors worth retrying: no permission is the user's
    // choice, and a simulator or Android has no APNs token to give.
    return { reported: false, reason: token.status }
  }
  try {
    const response = await client.sendRequest('notifications.registerPushToken', {
      deviceToken: token.token,
      platform: 'ios'
    })
    // `ok` alone is the whole answer now: the desktop throws rather than
    // returning a successful response that says it stored nothing. An older
    // desktop that does not know the method also lands here — that is not a
    // failure to recover from, it simply has no push, and the reconnect
    // catch-up that predates this still delivers everything on open.
    return response.ok ? { reported: true } : { reported: false, reason: 'rejected' }
  } catch {
    return { reported: false, reason: 'failed' }
  }
}
