import type { MantaCloudCredentials } from '../../shared/manta-cloud-credentials'
import type { MantaCloudAuthConfig } from './profile-cloud-auth-config'
import { MantaCloudRequestError } from './profile-cloud-client'
import { registerMantaCloudAccount, signInToMantaCloud } from './profile-cloud-account-client'
import type { MantaCloudSessionExchangeResponse } from './profile-cloud-session-exchange'

/**
 * Turns the relay's error discriminator into something worth reading.
 *
 * The form has one message line, and 'manta_cloud_request_failed_401' tells the
 * user nothing about whether they mistyped a password, picked an address that
 * is already taken, or hit a relay that has signup switched off.
 */
function describeFailure(
  error: MantaCloudRequestError,
  mode: MantaCloudCredentials['mode']
): string {
  switch (error.errorCode) {
    case 'invalid_credentials':
      return 'That email and password did not match an account on this relay.'
    case 'email_taken':
      return 'An account already uses that email on this relay. Sign in instead.'
    case 'weak_password':
      return 'Choose a password of at least 8 characters.'
    case 'invalid_email':
      return 'Enter a valid email address.'
    case 'registration_disabled':
      return 'This relay does not accept new accounts. Ask its operator to create one for you.'
    case 'invalid_enrollment_secret':
      return 'This relay requires its enrolment secret to create an account. Set it in Settings → Advanced → Manta Cloud endpoints.'
    case 'too_many_accounts':
      return 'This relay has reached its account limit.'
    case 'rate_limited':
      return 'Too many attempts. Wait a moment and try again.'
    case undefined:
    default:
      break
  }
  if (error.statusCode === 404) {
    return mode === 'register'
      ? 'This relay is too old to create accounts. Update it, or connect with its enrolment secret instead.'
      : 'This relay is too old for password sign-in. Update it, or connect with its enrolment secret instead.'
  }
  return `The relay refused the request (${error.statusCode}).`
}

export class MantaCloudCredentialError extends Error {
  constructor(
    message: string,
    /** The relay's own discriminator, for callers that branch on it. */
    readonly errorCode: string | undefined,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'MantaCloudCredentialError'
  }
}

export async function exchangeMantaCloudCredentials(
  config: MantaCloudAuthConfig,
  credentials: MantaCloudCredentials
): Promise<MantaCloudSessionExchangeResponse> {
  const grant = {
    email: credentials.email,
    password: credentials.password,
    ...(credentials.displayName ? { displayName: credentials.displayName } : {}),
    ...(credentials.enrollmentSecret ? { enrollmentSecret: credentials.enrollmentSecret } : {})
  }
  try {
    return credentials.mode === 'register'
      ? await registerMantaCloudAccount(config, grant)
      : await signInToMantaCloud(config, grant)
  } catch (error) {
    if (error instanceof MantaCloudRequestError) {
      throw new MantaCloudCredentialError(
        describeFailure(error, credentials.mode),
        // A 404 carries no discriminator of its own — the endpoint simply is
        // not there — so it gets one here. It is the first thing anyone
        // running an older relay will hit, and it deserves a sentence in the
        // reader's own language rather than this one.
        error.statusCode === 404
          ? credentials.mode === 'register'
            ? 'relay_too_old_to_register'
            : 'relay_too_old_to_sign_in'
          : error.errorCode,
        error.statusCode
      )
    }
    throw error
  }
}
