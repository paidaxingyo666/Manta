import { useEffect } from 'react'
import { Laptop, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { MantaRelayHostSummary } from '../../../../shared/manta-relay-hosts'

function machineLabel(host: MantaRelayHostSummary): string {
  return (
    host.displayName ||
    translate('auto.components.settings.relayMachines.unnamed', 'Unnamed machine')
  )
}

function lastSeenCopy(host: MantaRelayHostSummary): string {
  if (host.online) {
    return translate('auto.components.settings.relayMachines.online', 'Online now')
  }
  if (host.lastSeenAt === undefined) {
    return translate('auto.components.settings.relayMachines.neverSeen', 'Not connected yet')
  }
  return translate('auto.components.settings.relayMachines.lastSeen', 'Last seen {{when}}', {
    when: new Date(host.lastSeenAt).toLocaleString()
  })
}

function emptyCopy(state: string | null): string {
  if (state === 'unsupported') {
    return translate(
      'auto.components.settings.relayMachines.unsupported',
      'This relay is too old to list machines. Update it to see every computer on your account.'
    )
  }
  if (state === 'signed-out') {
    return translate(
      'auto.components.settings.relayMachines.signedOut',
      'Sign in to see the machines on your account.'
    )
  }
  if (state === 'unconfigured') {
    return translate(
      'auto.components.settings.relayMachines.unconfigured',
      'No relay is configured, so there are no machines to list.'
    )
  }
  if (state === 'failed') {
    return translate(
      'auto.components.settings.relayMachines.failed',
      'Could not read the machine list from the relay.'
    )
  }
  return translate(
    'auto.components.settings.relayMachines.empty',
    'No machines yet. Sign in to the same relay on another computer and it will appear here.'
  )
}

/** Every computer signed in to this account on the configured relay. */
export function MantaRelayMachinesSection(): React.JSX.Element {
  const hosts = useAppStore((state) => state.mantaRelayHosts)
  const loading = useAppStore((state) => state.mantaRelayHostsLoading)
  const state = useAppStore((state) => state.mantaRelayHostsState)
  const fetchHosts = useAppStore((state) => state.fetchMantaRelayHosts)
  const forgetHost = useAppStore((state) => state.forgetMantaRelayHost)

  useEffect(() => {
    if (state === null) {
      void fetchHosts()
    }
  }, [state, fetchHosts])

  return (
    <div className="space-y-4 border-t border-border/60 pt-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {translate('auto.components.settings.relayMachines.title', 'Your machines')}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => void fetchHosts()}
        >
          <RefreshCw className="size-3.5" />
          {translate('auto.components.settings.relayMachines.refresh', 'Refresh')}
        </Button>
      </div>
      {hosts.length === 0 ? (
        <p className="text-xs leading-5 text-muted-foreground">{emptyCopy(state)}</p>
      ) : (
        <div className="space-y-2">
          {hosts.map((host) => (
            <div
              key={host.relayHostId}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
            >
              <Laptop className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{machineLabel(host)}</span>
                  {host.isThisMachine ? (
                    <Badge variant="outline" className="text-[11px] text-muted-foreground">
                      {translate(
                        'auto.components.settings.relayMachines.thisMachine',
                        'This machine'
                      )}
                    </Badge>
                  ) : null}
                  {host.online ? (
                    <Badge variant="outline" className="text-[11px] text-muted-foreground">
                      {translate('auto.components.settings.relayMachines.onlineBadge', 'Online')}
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {[host.platform, host.appVersion].filter(Boolean).join(' · ') || host.relayHostId}
                  {' — '}
                  {lastSeenCopy(host)}
                </p>
              </div>
              {host.isThisMachine ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  className="text-destructive hover:text-destructive"
                  onClick={() => void forgetHost(host.relayHostId)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
