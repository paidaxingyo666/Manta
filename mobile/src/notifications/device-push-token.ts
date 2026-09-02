import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

/**
 * The APNs device token this install can be reached at.
 *
 * Deliberately `getDevicePushTokenAsync`, not `getExpoPushTokenAsync`: the Expo
 * token routes through Expo's servers, and this fork pushes from its own relay
 * straight to Apple. The native token is the one APNs addresses.
 *
 * Re-read on every launch rather than cached at pair time. A push token is not
 * stable — reinstalling, restoring from a backup, and some OS updates all mint a
 * new one, and the old one starts returning 410 Unregistered to a sender who has
 * no way to notice except by being told.
 */

export type DevicePushToken =
  | { status: 'ready'; token: string }
  /** The user has not granted notification permission, so there is nothing to ask for. */
  | { status: 'not-permitted' }
  /** Simulators and Android have no APNs token; neither is an error worth surfacing. */
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string }

export async function readDevicePushToken(): Promise<DevicePushToken> {
  if (Platform.OS !== 'ios') {
    return { status: 'unavailable', reason: `push is iOS-only for now (${Platform.OS})` }
  }
  const { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') {
    // Why not request here: asking is a decision the opt-in screen owns, and a
    // prompt raised from a background reconnect is one the user cannot place.
    return { status: 'not-permitted' }
  }
  try {
    const token = await Notifications.getDevicePushTokenAsync()
    if (typeof token.data !== 'string' || !token.data) {
      return { status: 'failed', reason: 'empty token' }
    }
    // APNs hands back raw bytes; expo-notifications hex-encodes them. Anything
    // else means the platform gave us something we would go on to send to Apple
    // as a URL path.
    if (!/^[0-9a-fA-F]{64,200}$/.test(token.data)) {
      return { status: 'failed', reason: 'token is not hex' }
    }
    return { status: 'ready', token: token.data.toLowerCase() }
  } catch (error) {
    // The simulator throws here rather than returning a sentinel.
    const reason = error instanceof Error ? error.message : String(error)
    return /simulator/i.test(reason)
      ? { status: 'unavailable', reason: 'simulator' }
      : { status: 'failed', reason }
  }
}
