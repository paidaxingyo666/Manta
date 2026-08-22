/**
 * How a relay expects to be signed in to.
 *
 * The desktop cannot draw the right screen without asking: a password form
 * against a shared relay asks for credentials that do not exist, and no form at
 * all against a per-user relay leaves the person with no way in.
 *
 * This is the relay operator's decision, not the user's. A relay that offered
 * both would let one careless click put someone on the shared identity, where
 * their machines are everyone's.
 */
export type MantaRelaySignInMethods = {
  /** `shared` is the default and what every relay without the endpoint is. */
  accounts: 'shared' | 'per-user'
  /** Only meaningful under `per-user`. */
  registration?: 'open' | 'enrollment-secret' | 'disabled'
  enrollmentSecretRequired: boolean
}

/** What a relay that has never heard of the question is. */
export const SHARED_RELAY_SIGN_IN_METHODS: MantaRelaySignInMethods = Object.freeze({
  accounts: 'shared',
  enrollmentSecretRequired: true
})

export function parseMantaRelaySignInMethods(value: unknown): MantaRelaySignInMethods {
  const record = (value ?? {}) as Record<string, unknown>
  if (record.accounts !== 'per-user') {
    return SHARED_RELAY_SIGN_IN_METHODS
  }
  const registration = record.registration
  return {
    accounts: 'per-user',
    ...(registration === 'open' ||
    registration === 'enrollment-secret' ||
    registration === 'disabled'
      ? { registration }
      : {}),
    enrollmentSecretRequired: record.enrollmentSecretRequired === true
  }
}
