import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { signInFailureMessage } from './manta-account-sign-in-message'

type Mode = 'sign-in' | 'register'

/**
 * Email and password against the user's own relay.
 *
 * Kept apart from the account pane because it is a form with its own state,
 * and because it is only one of three ways in — a relay may still be reached
 * with a deployment-wide enrolment secret or the browser code flow, which the
 * pane falls back to when nothing is typed here.
 */
export function MantaAccountSignInForm({
  onDone
}: {
  onDone?: () => void
} = {}): React.JSX.Element {
  const connect = useAppStore((state) => state.connectCurrentMantaProfile)
  const connecting = useAppStore((state) => state.mantaProfileConnecting)
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const registering = mode === 'register'

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (connecting || !email.trim() || !password) {
      return
    }
    setError(null)
    const result = await connect({
      credentials: {
        email: email.trim(),
        password,
        mode,
        ...(registering && displayName.trim() ? { displayName: displayName.trim() } : {})
      }
    })
    if (result?.status === 'connected') {
      // Never keep the password around once it has been exchanged for a token.
      setPassword('')
      setDisplayName('')
      onDone?.()
      return
    }
    const unreachable = translate(
      'auto.components.settings.mantaAccount.signInFailed',
      'Could not reach the relay.'
    )
    setError(
      result?.status === 'failed'
        ? signInFailureMessage(result.errorCode, result.error || unreachable)
        : unreachable
    )
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <div className="space-y-1.5">
        <Label htmlFor="manta-account-email" className="text-xs">
          {translate('auto.components.settings.mantaAccount.emailLabel', 'Email')}
        </Label>
        <Input
          id="manta-account-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={translate(
            'auto.components.settings.mantaAccount.emailPlaceholder',
            'you@example.com'
          )}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="manta-account-password" className="text-xs">
          {translate('auto.components.settings.mantaAccount.passwordLabel', 'Password')}
        </Label>
        <Input
          id="manta-account-password"
          type="password"
          autoComplete={registering ? 'new-password' : 'current-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {registering ? (
        <div className="space-y-1.5">
          <Label htmlFor="manta-account-name" className="text-xs">
            {translate('auto.components.settings.mantaAccount.displayNameLabel', 'Display name')}
          </Label>
          <Input
            id="manta-account-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={translate(
              'auto.components.settings.mantaAccount.displayNameOptional',
              'Optional'
            )}
          />
        </div>
      ) : null}
      {error ? <p className="text-xs leading-5 text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={connecting || !email.trim() || !password}>
          {connecting
            ? translate('auto.components.settings.mantaAccount.signingIn', 'Signing in…')
            : registering
              ? translate('auto.components.settings.mantaAccount.createAccount', 'Create account')
              : translate('auto.components.settings.mantaAccount.signIn', 'Sign in to Manta')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={connecting}
          onClick={() => {
            setMode(registering ? 'sign-in' : 'register')
            setError(null)
          }}
        >
          {registering
            ? translate('auto.components.settings.mantaAccount.haveAccount', 'I have an account')
            : translate(
                'auto.components.settings.mantaAccount.needAccount',
                'Create one on this relay'
              )}
        </Button>
      </div>
    </form>
  )
}
