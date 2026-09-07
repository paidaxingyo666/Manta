import { useEffect, useState } from 'react'
import type { RpcClient } from './rpc-client'
import type { ConnectionState } from './types'
import { readRuntimeCapabilities, startRuntimeStatusProbe } from './runtime-status-probe'
import { evaluateCompat, type CompatVerdict } from './protocol-compat'
import type { DesktopStatus } from '../worktree/host-worktree-rpc-types'
import { normalizeHostAppVersion, recordHostAppVersion } from './host-app-version-store'

export type HostStatusGates = {
  hostCapabilities: string[]
  floatingWorkspaceEnabled: boolean
  desktopAppVersion: string | null
  compatVerdict: CompatVerdict
  // Why: `compatVerdict.kind === 'ok'` is not proof. A host that never answers status.get settles
  // the same `ok` so navigation is not trapped, and that fallback must not read as a passing
  // verdict. Only an evaluated status reply sets this, so writes to the host can gate on it.
  compatVerified: boolean
  statusPending: boolean
}

// statusPending is not stored: pending-ness belongs to the live connection, not to the answer.
type LoadedHostStatusGates = Omit<HostStatusGates, 'statusPending'> & {
  hostId: string | undefined
  client: RpcClient
}

const EMPTY_HOST_CAPABILITIES: string[] = []

// The route tree's single status.get: it reads capabilities, the protocol-compat verdict, and
// the floating-workspace flag once per connection and publishes them through HostProtocolGate,
// so no descendant issues its own. The verdict really can block — evaluateCompat reads a missing
// protocolVersion as 0, below MIN_COMPATIBLE_DESKTOP_VERSION — so a pending verdict is a real
// state, not a formality, and anything that writes to the host must wait for it.
export function useHostStatusGates(args: {
  hostId: string | undefined
  client: RpcClient | null
  connState: ConnectionState
}): HostStatusGates {
  const { hostId, client, connState } = args
  const [loaded, setLoaded] = useState<LoadedHostStatusGates | null>(null)
  // Why (F10): a drop must not erase proven capabilities, but it does invalidate them — this keeps
  // statusPending true across the reconnect refetch, so gates stay "unknown" while the data survives.
  const [unverified, setUnverified] = useState(false)

  useEffect(() => {
    if (connState !== 'connected' || !client) {
      setUnverified(true)
      return
    }
    const requestClient = client
    const settle = (gates: Omit<HostStatusGates, 'statusPending'>) => {
      setLoaded({ hostId, client: requestClient, ...gates })
      setUnverified(false)
    }
    // Why: a transient status failure must not trap navigation, so the first miss settles
    // conservative gates and releases the pending overlay; the probe keeps retrying underneath
    // so a cutover or timeout no longer latches capability-gated UI hidden until a remount.
    // compatVerified stays false: this releases the UI, it proves nothing about the host.
    let failedOpen = false
    const failOpen = () => {
      if (failedOpen) {
        return
      }
      failedOpen = true
      settle({
        hostCapabilities: [],
        floatingWorkspaceEnabled: false,
        desktopAppVersion: null,
        compatVerdict: { kind: 'ok' },
        compatVerified: false
      })
    }
    return startRuntimeStatusProbe(requestClient, {
      onUnavailable: failOpen,
      onStatus: (result) => {
        const status = result as DesktopStatus & { capabilities?: string[] }
        const verdict = evaluateCompat({
          desktopProtocolVersion: status.protocolVersion,
          desktopMinCompatibleMobileVersion: status.minCompatibleMobileVersion
        })
        const desktopAppVersion = normalizeHostAppVersion(status.appVersion)
        if (hostId && desktopAppVersion) {
          void recordHostAppVersion(hostId, desktopAppVersion)
        }
        settle({
          hostCapabilities: [...readRuntimeCapabilities(result)],
          floatingWorkspaceEnabled: status.floatingWorkspaceEnabled === true,
          desktopAppVersion,
          compatVerdict: verdict,
          compatVerified: true
        })
        if (verdict.kind === 'blocked') {
          // Why: support breadcrumb to confirm a block fired vs a render bug; no PII, just version ints.
          console.warn('[protocol-compat] blocked', {
            reason: verdict.reason,
            desktopVersion: verdict.desktopVersion,
            requiredMobileVersion: verdict.requiredMobileVersion,
            requiredDesktopVersion: verdict.requiredDesktopVersion
          })
        }
      }
    })
  }, [client, connState, hostId])

  // Why: effects run after render, so key loaded gates by host and client to fail closed during route reuse.
  const proven = loaded && loaded.hostId === hostId && loaded.client === client ? loaded : null
  if (!proven) {
    return {
      hostCapabilities: EMPTY_HOST_CAPABILITIES,
      floatingWorkspaceEnabled: false,
      desktopAppVersion: null,
      compatVerdict: { kind: 'ok' },
      compatVerified: false,
      statusPending: connState === 'connected' && client !== null
    }
  }
  return {
    hostCapabilities: proven.hostCapabilities,
    floatingWorkspaceEnabled: proven.floatingWorkspaceEnabled,
    desktopAppVersion: proven.desktopAppVersion,
    compatVerdict: proven.compatVerdict,
    compatVerified: proven.compatVerified,
    // Why (F10): unchanged pending timing — the reconnect refetch is still "unknown", it just no
    // longer blanks the capabilities this same host already proved.
    statusPending: connState === 'connected' && unverified
  }
}
