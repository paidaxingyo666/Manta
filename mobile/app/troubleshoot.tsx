import { useState, useCallback, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Activity,
  CheckCircle2,
  ScrollText,
  XCircle,
  AlertTriangle
} from 'lucide-react-native'
import { colors, spacing, typography } from '../src/theme/mobile-theme'
import { loadHosts } from '../src/transport/host-store'
import {
  startDiagnosticFetchTimeout,
  type DiagnosticFetchTimeout
} from '../src/diagnostics/diagnostic-fetch-timeout'
import { testHostReachability } from '../src/diagnostics/host-reachability'
import {
  hostConnectionPathTargets,
  summarizeHostConnectionPaths,
  type HostConnectionPathProbe
} from '../src/diagnostics/host-connection-path-probe'
import { probeHostName, testInternetReachability } from '../src/diagnostics/internet-reachability'
import { troubleshootCommonIssues } from '../src/diagnostics/troubleshoot-common-issues'
import { translate } from '../src/i18n/i18n'

type DiagnosticStatus = 'idle' | 'running' | 'done'

type CheckResult = {
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
}

function StatusIcon({ status }: { status: CheckResult['status'] }) {
  switch (status) {
    case 'pass':
      return <CheckCircle2 size={14} color={colors.statusGreen} />
    case 'fail':
      return <XCircle size={14} color={colors.statusRed} />
    case 'warn':
      return <AlertTriangle size={14} color={colors.textMuted} />
  }
}

export default function TroubleshootScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [diagnosticStatus, setDiagnosticStatus] = useState<DiagnosticStatus>('idle')
  const [checks, setChecks] = useState<CheckResult[]>([])
  const abortRef = useRef(false)
  const diagnosticRunRef = useRef(0)
  const activeInternetCheckRef = useRef<DiagnosticFetchTimeout | null>(null)

  const setTroubleshootRootRef = useCallback((node: View | null): void => {
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

  const toggleSection = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
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
              label: translate('m.troubleshoot.fc87d4676b', 'Paired hosts'),
              status: 'pass',
              detail: `${hosts.length} paired`
            }
          : {
              label: translate('m.troubleshoot.fc87d4676b', 'Paired hosts'),
              status: 'fail',
              detail: 'None — scan a QR to pair'
            }
      )
    } catch {
      results.push({
        label: translate('m.troubleshoot.fc87d4676b', 'Paired hosts'),
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
    const internet = await testInternetReachability(internetCheck)
    internetCheck.dispose()
    if (activeInternetCheckRef.current === internetCheck) {
      activeInternetCheckRef.current = null
    }
    if (!isCurrentRun()) {
      return
    }
    results.push({
      label: translate('m.troubleshoot.de003da9ea', 'Internet'),
      status:
        internet.status === 'online' ? 'pass' : internet.status === 'offline' ? 'fail' : 'warn',
      detail:
        internet.status === 'online'
          ? translate('mobile.diagnostics.internet.connected', 'Connected via {{host}}', {
              host: probeHostName(internet.via)
            })
          : internet.status === 'unexpected-response'
            ? translate(
                'mobile.diagnostics.internet.unexpected',
                'Unexpected response from {{host}}',
                {
                  host: probeHostName(internet.via)
                }
              )
            : translate('mobile.diagnostics.internet.offline', 'No connection')
    })

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
        // Probe every path the client would dial. A relay-connected host is
        // routinely unreachable at the direct address it paired on, and testing
        // only that reported a perfectly healthy host as down.
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
        label: translate('m.troubleshoot.21ef75f0f3', 'Hosts'),
        status: 'warn',
        detail: 'Could not test'
      })
    }

    if (!isCurrentRun()) {
      return
    }

    results.push({
      label: translate('m.troubleshoot.f2c3857280', 'Platform'),
      status: 'pass',
      detail: `${Platform.OS} ${Platform.Version ?? ''}`
    })

    setChecks([...results])
    setDiagnosticStatus('done')
  }, [])

  return (
    <View
      ref={setTroubleshootRootRef}
      style={[styles.container, { paddingTop: insets.top + spacing.sm }]}
    >
      <View style={styles.topRow}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>
          {translate('m.troubleshoot.0c81261ae3', 'Troubleshooting')}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          style={({ pressed }) => [
            styles.diagnosticButton,
            pressed && styles.diagnosticButtonPressed,
            diagnosticStatus === 'running' && styles.diagnosticButtonDisabled
          ]}
          onPress={runDiagnostics}
          disabled={diagnosticStatus === 'running'}
        >
          {diagnosticStatus === 'running' ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <Activity size={16} color={colors.textPrimary} />
          )}
          <Text style={styles.diagnosticButtonLabel}>
            {diagnosticStatus === 'running'
              ? translate('m.troubleshoot.750b3cfa37', 'Running…')
              : diagnosticStatus === 'done'
                ? translate('m.troubleshoot.0790b66aca', 'Run again')
                : translate('m.troubleshoot.e71414eafc', 'Run diagnostics')}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.diagnosticButton,
            pressed && styles.diagnosticButtonPressed
          ]}
          onPress={() => router.push('/connection-log')}
        >
          <ScrollText size={16} color={colors.textPrimary} />
          <Text style={styles.diagnosticButtonLabel}>
            {translate('m.troubleshoot.6f024bb4ae', 'View connection log')}
          </Text>
        </Pressable>

        {checks.length > 0 && (
          <View style={styles.section}>
            {checks.map((check, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.separator} />}
                <View style={styles.checkRow}>
                  <StatusIcon status={check.status} />
                  <Text style={styles.checkLabel}>{check.label}</Text>
                  <Text
                    style={[styles.checkDetail, check.status === 'fail' && styles.checkDetailFail]}
                  >
                    {check.detail}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionHeading}>
          {translate('m.troubleshoot.d89f2f9bbd', 'Common issues')}
        </Text>

        <View style={styles.section}>
          {troubleshootCommonIssues().map((section, i) => (
            <View key={section.id}>
              {i > 0 && <View style={styles.separator} />}
              <Pressable
                style={({ pressed }) => [styles.accordionHeader, pressed && styles.rowPressed]}
                onPress={() => toggleSection(section.id)}
              >
                {section.icon}
                <Text style={styles.accordionTitle}>{section.title}</Text>
                {expandedId === section.id ? (
                  <ChevronUp size={16} color={colors.textMuted} />
                ) : (
                  <ChevronDown size={16} color={colors.textMuted} />
                )}
              </Pressable>
              {expandedId === section.id && (
                <View style={styles.accordionBody}>
                  {section.steps.map((step, j) => (
                    <View key={j} style={styles.stepRow}>
                      <Text style={styles.bullet}>•</Text>
                      <Text style={styles.stepText}>{step}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
        </View>

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    padding: spacing.lg
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary
  },
  scroll: {
    flex: 1
  },
  scrollContent: {
    paddingBottom: spacing.xl
  },
  diagnosticButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgRaised,
    borderRadius: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg
  },
  diagnosticButtonPressed: {
    opacity: 0.7
  },
  diagnosticButtonDisabled: {
    opacity: 0.5
  },
  diagnosticButtonLabel: {
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: colors.textPrimary
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md + 2
  },
  checkLabel: {
    fontSize: typography.bodySize,
    fontWeight: '500',
    color: colors.textPrimary
  },
  checkDetail: {
    flex: 1,
    textAlign: 'right',
    fontSize: typography.metaSize,
    color: colors.textMuted
  },
  checkDetailFail: {
    color: colors.statusRed
  },
  sectionHeading: {
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs
  },
  section: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: spacing.lg
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md
  },
  rowPressed: {
    backgroundColor: colors.bgRaised
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2
  },
  accordionTitle: {
    flex: 1,
    fontSize: typography.bodySize,
    fontWeight: '500',
    color: colors.textPrimary
  },
  accordionBody: {
    paddingHorizontal: spacing.md + 2,
    paddingBottom: spacing.md,
    gap: spacing.xs + 2
  },
  stepRow: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  bullet: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    lineHeight: 18
  },
  stepText: {
    flex: 1,
    fontSize: typography.metaSize,
    color: colors.textMuted,
    lineHeight: 18
  }
})
