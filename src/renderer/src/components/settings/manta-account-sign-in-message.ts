import { translate } from '@/i18n/i18n'

/**
 * A sentence for each way a relay can refuse a sign-in.
 *
 * The main process already produces one, but it is English and built where no
 * catalog exists — so the code travels alongside it and the wording is chosen
 * here, where it can be translated.
 */
export function signInFailureMessage(errorCode: string | undefined, fallback: string): string {
  switch (errorCode) {
    case 'invalid_credentials':
      return translate(
        'auto.components.settings.mantaAccount.errorInvalidCredentials',
        'That email and password did not match an account on this relay.'
      )
    case 'email_taken':
      return translate(
        'auto.components.settings.mantaAccount.errorEmailTaken',
        'An account already uses that email on this relay. Sign in instead.'
      )
    case 'weak_password':
      return translate(
        'auto.components.settings.mantaAccount.errorWeakPassword',
        'Choose a password of at least 8 characters.'
      )
    case 'invalid_email':
      return translate(
        'auto.components.settings.mantaAccount.errorInvalidEmail',
        'Enter a valid email address.'
      )
    case 'registration_disabled':
      return translate(
        'auto.components.settings.mantaAccount.errorRegistrationDisabled',
        'This relay does not accept new accounts. Ask its operator to create one for you.'
      )
    case 'invalid_enrollment_secret':
      return translate(
        'auto.components.settings.mantaAccount.errorEnrollmentSecret',
        'This relay needs its enrolment secret to create an account. Set it in Settings → Advanced → Manta Cloud endpoints.'
      )
    case 'too_many_accounts':
      return translate(
        'auto.components.settings.mantaAccount.errorTooManyAccounts',
        'This relay has reached its account limit.'
      )
    case 'too_many_hosts':
      return translate(
        'auto.components.settings.mantaAccount.errorTooManyHosts',
        'This account already has as many machines as the relay allows.'
      )
    case 'relay_too_old_to_register':
      return translate(
        'auto.components.settings.mantaAccount.errorRelayTooOldRegister',
        'This relay is too old to create accounts. Update it, or connect with its relay credential instead.'
      )
    case 'relay_too_old_to_sign_in':
      return translate(
        'auto.components.settings.mantaAccount.errorRelayTooOldSignIn',
        'This relay is too old for password sign-in. Update it, or connect with its relay credential instead.'
      )
    case 'rate_limited':
      return translate(
        'auto.components.settings.mantaAccount.errorRateLimited',
        'Too many attempts. Wait a moment and try again.'
      )
    case undefined:
    default:
      return fallback
  }
}
