import type { DesktopMobileE2EEV2Session } from './mobile-e2ee-v2-desktop-session'
import { publicKeyFromBase64 } from './e2ee-crypto'
import { parseRemoteRuntimeJsonText } from '../../../shared/remote-runtime-request-frames'

export type MobileE2EEAuth = {
  type: 'e2ee_auth'
  deviceToken: string
  clientCapabilities?: unknown
  v?: 2
  transcriptHashB64?: string
}

export function isValidMobileE2EEAuthVersion(
  auth: MobileE2EEAuth,
  v2Session: DesktopMobileE2EEV2Session | null
): boolean {
  if (!v2Session) {
    return auth.v === undefined && auth.transcriptHashB64 === undefined
  }
  // Why: v2 keeps an exact transcript-bound shape, so unknown keys are refused
  // rather than ignored. `clientCapabilities` is the one addition, for a
  // desktop peer that reaches this host through a relay and has nowhere else to
  // declare them — phones still send the original four and still validate.
  const keys = Object.keys(auth).sort().join(',')
  return (
    (keys === 'deviceToken,transcriptHashB64,type,v' ||
      keys === 'clientCapabilities,deviceToken,transcriptHashB64,type,v') &&
    auth.v === 2 &&
    auth.transcriptHashB64 === v2Session.transcriptHashB64
  )
}

export function authenticateMobileE2EE<
  TDevice extends { deviceToken: string; scope?: 'mobile' | 'runtime' }
>(args: {
  plaintext: string
  v2Session: DesktopMobileE2EEV2Session | null
  resolveDevice: (token: string) => TDevice | null
}):
  | { ok: true; device: TDevice; auth: MobileE2EEAuth }
  | { ok: false; code: 'bad_auth' | 'unauthorized' } {
  let auth: MobileE2EEAuth
  try {
    auth = parseRemoteRuntimeJsonText(args.plaintext) as MobileE2EEAuth
  } catch {
    return { ok: false, code: 'bad_auth' }
  }
  if (
    auth.type !== 'e2ee_auth' ||
    !auth.deviceToken ||
    !isValidMobileE2EEAuthVersion(auth, args.v2Session)
  ) {
    return { ok: false, code: 'bad_auth' }
  }
  const device = args.resolveDevice(auth.deviceToken)
  if (device?.deviceToken !== auth.deviceToken) {
    return { ok: false, code: 'unauthorized' }
  }
  // Why here and not in the shape check: capabilities are allowed on a v2 frame
  // only for a runtime-scope peer, which reaches this host through a relay and
  // has nowhere else to declare them. A phone announcing the paired-runtime
  // surface is the downgrade this rule exists to refuse, and scope is only
  // known once the token resolves.
  if (args.v2Session && auth.clientCapabilities !== undefined && device.scope !== 'runtime') {
    return { ok: false, code: 'bad_auth' }
  }
  return { ok: true, device, auth }
}

export function decodeMobileE2EEPublicKey(value: string): Uint8Array | null {
  try {
    return publicKeyFromBase64(value)
  } catch {
    return null
  }
}
