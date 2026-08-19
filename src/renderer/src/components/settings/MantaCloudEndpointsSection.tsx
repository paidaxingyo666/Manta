import type React from 'react'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { MantaCloudEndpointOverrides } from '../../../../shared/manta-cloud-endpoints'
import {
  normalizeMantaCloudClientId,
  normalizeMantaCloudEndpointUrl,
  normalizeMantaCloudEnrollmentSecret,
  normalizeMantaCloudOrigin
} from '../../../../shared/manta-cloud-endpoints'
import { cn } from '@/lib/utils'
import { useAppStore } from '../../store'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { getMantaCloudEndpointsSearchEntries } from './manta-cloud-endpoints-search'
import { SearchableSetting } from './SearchableSetting'
import { matchesSettingsSearch, normalizeSettingsSearchQuery } from './settings-search'
import { translate } from '@/i18n/i18n'

export function shouldOpenMantaCloudEndpoints(searchQuery: string): boolean {
  return (
    normalizeSettingsSearchQuery(searchQuery) !== '' &&
    matchesSettingsSearch(searchQuery, getMantaCloudEndpointsSearchEntries())
  )
}

/** Configured endpoints should reveal the fields so the values stay visible. */
export function hasConfiguredMantaCloudEndpoints(settings: GlobalSettings): boolean {
  const endpoints = settings.mantaCloudEndpoints
  return Boolean(
    endpoints?.apiBaseUrl ||
    endpoints?.relayDirectorUrl ||
    endpoints?.clientId ||
    endpoints?.enrollmentSecret
  )
}

export type MantaCloudEndpointsDraft = {
  apiBaseUrl: string
  relayDirectorUrl: string
  clientId: string
  enrollmentSecret: string
}

export function createMantaCloudEndpointsDraft(
  overrides: MantaCloudEndpointOverrides | undefined
): MantaCloudEndpointsDraft {
  return {
    apiBaseUrl: overrides?.apiBaseUrl ?? '',
    relayDirectorUrl: overrides?.relayDirectorUrl ?? '',
    clientId: overrides?.clientId ?? '',
    enrollmentSecret: overrides?.enrollmentSecret ?? ''
  }
}

/**
 * Why both must be set together: a self-hosted auth server issues relay tokens
 * the official director rejects, and that failure is a non-retried 400 that
 * leaves relay offline for minutes with no actionable error.
 */
export function validateMantaCloudEndpointsDraft(
  draft: MantaCloudEndpointsDraft
): { ok: true; value: MantaCloudEndpointOverrides | undefined } | { ok: false; message: string } {
  const api = normalizeMantaCloudEndpointUrl(draft.apiBaseUrl)
  if (!api.ok) {
    return { ok: false, message: api.message }
  }
  const relay = normalizeMantaCloudOrigin(draft.relayDirectorUrl)
  if (!relay.ok) {
    return { ok: false, message: relay.message }
  }
  const enrollmentSecret = normalizeMantaCloudEnrollmentSecret(draft.enrollmentSecret)
  if (!enrollmentSecret.ok) {
    return { ok: false, message: enrollmentSecret.message }
  }
  const clientId = normalizeMantaCloudClientId(draft.clientId)
  if (!clientId.ok) {
    return { ok: false, message: clientId.message }
  }
  if (Boolean(api.value) !== Boolean(relay.value)) {
    return {
      ok: false,
      message: translate(
        'auto.components.settings.MantaCloudEndpointsSection.pairRequired',
        'Set the sign-in server and the relay address together, or leave both empty.'
      )
    }
  }
  if (!api.value && !relay.value && !clientId.value && !enrollmentSecret.value) {
    return { ok: true, value: undefined }
  }
  const next: MantaCloudEndpointOverrides = {}
  if (api.value) {
    next.apiBaseUrl = api.value
  }
  if (relay.value) {
    next.relayDirectorUrl = relay.value
  }
  if (clientId.value) {
    next.clientId = clientId.value
  }
  if (enrollmentSecret.value) {
    next.enrollmentSecret = enrollmentSecret.value
  }
  return { ok: true, value: next }
}

type MantaCloudEndpointsSectionProps = {
  settings: GlobalSettings
}

export function MantaCloudEndpointsSection({
  settings
}: MantaCloudEndpointsSectionProps): React.JSX.Element {
  const searchQuery = useAppStore((s) => s.settingsSearchQuery)
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState(() =>
    createMantaCloudEndpointsDraft(settings.mantaCloudEndpoints)
  )
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const open =
    expanded ||
    shouldOpenMantaCloudEndpoints(searchQuery) ||
    hasConfiguredMantaCloudEndpoints(settings)

  const apply = (): void => {
    const validated = validateMantaCloudEndpointsDraft(draft)
    if (!validated.ok) {
      setError(validated.message)
      return
    }
    setError(null)
    setApplying(true)
    // Why a dedicated IPC instead of updateSettings: switching servers must sign
    // out with the OLD endpoints first, then persist, then relaunch — the relay
    // service snapshots the auth config at construction and never re-reads it.
    void window.api.mantaProfiles.applyCloudEndpoints(validated.value).catch(() => {
      setApplying(false)
      setError(
        translate(
          'auto.components.settings.MantaCloudEndpointsSection.applyFailed',
          'Could not apply the endpoints. Check the values and try again.'
        )
      )
    })
  }

  const field = (
    key: keyof MantaCloudEndpointsDraft,
    id: string,
    label: string,
    placeholder: string,
    secret = false
  ): React.JSX.Element => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={draft[key]}
        onChange={(e) => {
          setDraft((current) => ({ ...current, [key]: e.target.value }))
          setError(null)
        }}
        placeholder={placeholder}
        type={secret ? 'password' : 'text'}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        className="font-mono text-xs"
      />
    </div>
  )

  return (
    <SearchableSetting
      title={translate(
        'auto.components.settings.MantaCloudEndpointsSection.title',
        'Self-hosted server'
      )}
      description={translate(
        'auto.components.settings.MantaCloudEndpointsSection.description',
        'Point sign-in and the mobile relay at your own server instead of the official one.'
      )}
      keywords={['relay', 'self-hosted', 'endpoint', 'director', 'oauth', 'server', 'latency']}
      className="space-y-3"
      id="advanced-manta-cloud-endpoints"
    >
      <Collapsible open={open} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            {translate(
              'auto.components.settings.MantaCloudEndpointsSection.configure',
              'Configure endpoints'
            )}
            <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-4 rounded-md border border-border/60 bg-muted/20 px-3 py-3">
            {field(
              'apiBaseUrl',
              'settings-manta-cloud-api',
              translate(
                'auto.components.settings.MantaCloudEndpointsSection.apiLabel',
                'Sign-in server'
              ),
              'https://login.example.com'
            )}
            {field(
              'relayDirectorUrl',
              'settings-manta-cloud-relay',
              translate(
                'auto.components.settings.MantaCloudEndpointsSection.relayLabel',
                'Relay address'
              ),
              'https://relay.example.com'
            )}
            {field(
              'clientId',
              'settings-manta-cloud-client-id',
              translate(
                'auto.components.settings.MantaCloudEndpointsSection.clientIdLabel',
                'OAuth client ID'
              ),
              'manta-desktop'
            )}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.MantaCloudEndpointsSection.warning',
                'Both addresses must use https with a certificate your phone trusts. The relay only forwards end-to-end encrypted data, but its operator can see who connects and when. Applying signs you out and restarts Manta.'
              )}
            </p>
            <Button type="button" size="sm" disabled={applying} onClick={apply}>
              {applying
                ? translate(
                    'auto.components.settings.MantaCloudEndpointsSection.applying',
                    'Restarting…'
                  )
                : translate(
                    'auto.components.settings.MantaCloudEndpointsSection.apply',
                    'Apply and restart'
                  )}
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </SearchableSetting>
  )
}
