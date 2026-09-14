import { useCallback, useRef, useState } from 'react'
import type { View } from 'react-native'
import { Platform } from 'react-native'
import { loadHosts } from '../transport/host-store'
import {
  startDiagnosticFetchTimeout,
  type DiagnosticFetchTimeout
} from './diagnostic-fetch-timeout'
import { testHostReachability } from './host-reachability'
import {
  hostConnectionPathTargets,
  summarizeHostConnectionPaths,
  type HostConnectionPathProbe
} from './host-connection-path-probe'
import type { CheckResult, DiagnosticStatus } from './troubleshoot-view'
import { translate } from '../i18n/i18n'

export function useTroubleshootDiagnostics() {
  const [diagnosticStatus, setDiagnosticStatus] = useState<DiagnosticStatus>('idle')
  const [checks, setChecks] = useState<CheckResult[]>([])
  const abortRef = useRef(false)
  const diagnosticRunRef = useRef(0)
  const activeInternetCheckRef = useRef<DiagnosticFetchTimeout | null>(null)

  const rootRef = useCallback((node: View | null): void => {
    if (node !== null) {
      return
    }
    // Why: diagnostics can outlive the screen; cancel the active run when the
    // route detaches without a passive cleanup-only Effect.
    abortRef.current = true
    diagnosticRunRef.current += 1
    activeInternetCheckRef.current?.dispose()
    activeInternetCheckRef.current = null
  }, [])

  const runDiagnostics = useCallback(async () => {
    const runId = diagnosticRunRef.current + 1
    diagnosticRunRef.current = runId
    abortRef.current = false
    activeInternetCheckRef.current?.dispose()
    activeInternetCheckRef.current = null
    setDiagnosticStatus('running')
    setChecks([])

    const results: CheckResult[] = []
    const isCurrentRun = () => !abortRef.current && diagnosticRunRef.current === runId

    try {
      const hosts = await loadHosts()
      results.push(
        hosts.length > 0
          ? {
              label: translate('m.use.troubleshoot.diagnostics.c13e221cc4', 'Paired hosts'),
              status: 'pass',
              detail: `${hosts.length} paired`
            }
          : {
              label: translate('m.use.troubleshoot.diagnostics.c13e221cc4', 'Paired hosts'),
              status: 'fail',
              detail: 'None — scan a QR to pair'
            }
      )
    } catch {
      results.push({
        label: translate('m.use.troubleshoot.diagnostics.c13e221cc4', 'Paired hosts'),
        status: 'warn',
        detail: 'Could not read host data'
      })
    }

    if (!isCurrentRun()) {
      return
    }
    setChecks([...results])

    const internetCheck = startDiagnosticFetchTimeout(5000)
    activeInternetCheckRef.current = internetCheck
    try {
      const resp = await fetch('https://dns.google/resolve?name=example.com&type=A', {
        signal: internetCheck.signal
      })
      if (!isCurrentRun()) {
        return
      }
      results.push(
        resp.ok
          ? {
              label: translate('m.use.troubleshoot.diagnostics.799b75f17e', 'Internet'),
              status: 'pass',
              detail: 'Connected'
            }
          : {
              label: translate('m.use.troubleshoot.diagnostics.799b75f17e', 'Internet'),
              status: 'warn',
              detail: 'Unexpected response'
            }
      )
    } catch {
      if (!isCurrentRun()) {
        return
      }
      results.push({
        label: translate('m.use.troubleshoot.diagnostics.799b75f17e', 'Internet'),
        status: 'fail',
        detail: 'No connection'
      })
    } finally {
      internetCheck.dispose()
      if (activeInternetCheckRef.current === internetCheck) {
        activeInternetCheckRef.current = null
      }
    }

    if (!isCurrentRun()) {
      return
    }
    setChecks([...results])

    try {
      const hosts = await loadHosts()
      for (const host of hosts) {
        if (!isCurrentRun()) {
          return
        }
        const probes: HostConnectionPathProbe[] = []
        for (const target of hostConnectionPathTargets(host)) {
          if (!isCurrentRun()) {
            return
          }
          probes.push({ ...target, reachable: await testHostReachability(target.url) })
        }
        if (!isCurrentRun()) {
          return
        }
        results.push({ label: host.name, ...summarizeHostConnectionPaths(probes) })
        setChecks([...results])
      }
    } catch {
      results.push({
        label: translate('m.use.troubleshoot.diagnostics.b634cefbb9', 'Hosts'),
        status: 'warn',
        detail: 'Could not test'
      })
    }

    if (!isCurrentRun()) {
      return
    }

    results.push({
      label: translate('m.use.troubleshoot.diagnostics.3882870670', 'Platform'),
      status: 'pass',
      detail: `${Platform.OS} ${Platform.Version ?? ''}`
    })

    setChecks([...results])
    setDiagnosticStatus('done')
  }, [])

  return { rootRef, diagnosticStatus, checks, runDiagnostics }
}
