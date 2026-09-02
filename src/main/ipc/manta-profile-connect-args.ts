import type {
  ConnectCurrentMantaProfileArgs,
  MantaCloudCredentials
} from '../../shared/manta-cloud-credentials'

const MAX_EMAIL = 256
const MAX_PASSWORD = 256
const MAX_DISPLAY_NAME = 120
const MAX_SECRET = 512

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

/**
 * Normalizes what the renderer sent.
 *
 * The renderer is outside the trust boundary, so the password path must not be
 * reachable by sending a half-formed object: without both fields this falls
 * back to the enrolment-secret flow, which is the behaviour that existed
 * before credentials did.
 */
export function connectArgsFromUnknown(raw: unknown): ConnectCurrentMantaProfileArgs | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const candidate = (raw as ConnectCurrentMantaProfileArgs).credentials
  if (!candidate || typeof candidate !== 'object') {
    return undefined
  }
  const email = text(candidate.email, MAX_EMAIL).trim()
  const password = text(candidate.password, MAX_PASSWORD)
  if (!email || !password) {
    return undefined
  }
  const displayName = text(candidate.displayName, MAX_DISPLAY_NAME).trim()
  const enrollmentSecret = text(candidate.enrollmentSecret, MAX_SECRET).trim()
  const credentials: MantaCloudCredentials = {
    email,
    password,
    mode: candidate.mode === 'register' ? 'register' : 'sign-in',
    ...(displayName ? { displayName } : {}),
    ...(enrollmentSecret ? { enrollmentSecret } : {})
  }
  return { credentials }
}
