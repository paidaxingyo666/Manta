import { isTailscaleEndpoint } from '../../../src/shared/remote-runtime-tailscale-hint'
import type { MobileAccessEndpoint } from '../transport/mobile-relay-host-overlay'
import type { HostProfile } from '../transport/types'
import { translate } from '../i18n/i18n'
import { formatEndpoint } from './host-reachability'

export type HostConnectionPathProbe = {
  kind: MobileAccessEndpoint['kind']
  url: string
  reachable: boolean
}

/**
 * Every path the client would actually dial, not just the direct endpoint.
 *
 * `host.endpoint` is the direct address the phone paired on. Once a host is
 * reachable through the relay, that address is often unreachable — a different
 * network, a sleeping LAN — while the connection itself is healthy. Probing it
 * alone reported a working host as unreachable.
 */
export function hostConnectionPathTargets(
  host: Pick<HostProfile, 'endpoint' | 'endpoints'>
): { kind: MobileAccessEndpoint['kind']; url: string }[] {
  if (host.endpoints && host.endpoints.length > 0) {
    return host.endpoints.map(({ kind, url }) => ({ kind, url }))
  }
  return [
    {
      kind: isTailscaleEndpoint(host.endpoint) ? 'tailscale' : 'lan',
      url: host.endpoint
    }
  ]
}

export function connectionPathName(kind: MobileAccessEndpoint['kind']): string {
  if (kind === 'relay') {
    return translate('mobile.diagnostics.path.relay', 'relay')
  }
  return kind === 'tailscale'
    ? translate('mobile.diagnostics.path.tailscale', 'Tailscale')
    : translate('mobile.diagnostics.path.lan', 'LAN')
}

/**
 * One verdict per host: reachable on any path is reachable.
 *
 * Naming the path that answered is the point — "reachable via relay" tells the
 * user their direct address is down without calling the host broken.
 */
export function summarizeHostConnectionPaths(probes: readonly HostConnectionPathProbe[]): {
  status: 'pass' | 'fail'
  detail: string
} {
  const reachable = probes.filter((probe) => probe.reachable)
  if (reachable.length > 0) {
    return {
      status: 'pass',
      detail: translate('mobile.diagnostics.host.reachableVia', 'Reachable via {{paths}}', {
        paths: reachable.map((probe) => connectionPathName(probe.kind)).join(' · ')
      })
    }
  }
  // Tailscale gets its own hint because a wedged tunnel is the common cause and
  // has a specific fix; without one, name what was actually tried.
  const tailscale = probes.find((probe) => probe.kind === 'tailscale')
  if (tailscale) {
    return {
      status: 'fail',
      detail: translate(
        'mobile.diagnostics.host.unreachableTailscale',
        'Cannot reach {{endpoint}} — check Tailscale',
        { endpoint: formatEndpoint(tailscale.url) }
      )
    }
  }
  const first = probes[0]
  return {
    status: 'fail',
    detail: first
      ? translate('mobile.diagnostics.host.unreachable', 'Cannot reach {{endpoint}}', {
          endpoint: formatEndpoint(first.url)
        })
      : translate('mobile.diagnostics.host.noPaths', 'No connection paths configured')
  }
}
