/**
 * How far a delivered push carried the desktop's notification counter.
 *
 * The catch-up watermark only advances on a live socket delivery, so everything
 * APNs showed while the app was closed is still "missed" on the next open and
 * gets notified again. The notification service extension records each push as
 * it arrives; this reads that back so the catch-up can skip what the user has
 * already seen.
 *
 * Optional on purpose: a build without the module — Android, a simulator, an
 * older install — simply learns nothing, and the catch-up behaves as it did
 * before, which over-notifies rather than under-notifies.
 *
 * Resolved lazily rather than at import time. expo-modules-core reaches
 * react-native, whose Flow source the test runner cannot parse, so a top-level
 * import would take every test that transitively touches notifications with it.
 */
type PushDeliveredSeq = {
  seqForEpoch: (epoch: string) => number | null
}

function native(): PushDeliveredSeq | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require('expo-modules-core') as {
      requireOptionalNativeModule: <T>(name: string) => T | null
    }
    return core.requireOptionalNativeModule<PushDeliveredSeq>('PushDeliveredSeq')
  } catch {
    return null
  }
}

/** Tells a missing native module apart from an epoch no push has covered. */
export function isPushDeliveredSeqLinked(): boolean {
  return native() !== null
}

export function readDeliveredSeq(epoch: string): number | null {
  try {
    return native()?.seqForEpoch(epoch) ?? null
  } catch {
    // A throw here would take the catch-up down with it, and the whole point of
    // this value is to make the catch-up quieter, never to gate it.
    return null
  }
}
