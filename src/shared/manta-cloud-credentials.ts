/**
 * Email and password for a self-hosted relay's own account system.
 *
 * Separate from the enrolment secret: that one is a single shared key for the
 * whole deployment, so it can say "you may use this relay" but never "you are
 * this person", which is what a machine list needs.
 */
export type MantaCloudCredentials = {
  email: string
  password: string
  /** 'register' creates the account first; either way the relay signs it in. */
  mode: 'sign-in' | 'register'
  displayName?: string
  /** Some relays gate registration behind the enrolment secret. */
  enrollmentSecret?: string
}

export type ConnectCurrentMantaProfileArgs = {
  credentials?: MantaCloudCredentials
}
