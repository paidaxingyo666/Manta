import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import Constants from 'expo-constants'
import { ChevronLeft, Copy, Check } from 'lucide-react-native'
import { colors, spacing, typography } from '../src/theme/mobile-theme'
import { ConnectionLog } from '../src/components/ConnectionLog'
import { loadHosts } from '../src/transport/host-store'
import { connectionLogStore } from '../src/transport/connection-log-buffer'
import { useHostClient } from '../src/transport/client-context'
import { clientActivePath } from '../src/transport/host-client-context-state'
import { mobileConnectionPathLabel } from '../src/transport/mobile-connection-path-label'
import {
  useLastConnectedAt,
  useReconnectAttempt
} from '../src/transport/client-context-connection-metrics'
import { buildConnectionDiagnosticsReport } from '../src/diagnostics/connection-diagnostics-report'
import type { ConnectionLogEntry, HostProfile } from '../src/transport/types'
import { translate } from '../src/i18n/i18n'

// Why: getSnapshot must be referentially stable when there's no data —
// a fresh [] per call would make useSyncExternalStore re-render forever.
const EMPTY_ENTRIES: readonly ConnectionLogEntry[] = []

// Why: reading the log is most needed while a host is failing, so this
// screen also *acquires* the host client — opening it kicks a dial and the
// log fills live instead of showing a stale tail.
export default function ConnectionLogScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [hosts, setHosts] = useState<HostProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let stale = false
    void loadHosts().then((loaded) => {
      if (stale) {
        return
      }
      setHosts(loaded)
      setSelectedId((prev) => prev ?? loaded[0]?.id ?? null)
    })
    return () => {
      stale = true
    }
  }, [])

  const selected = hosts.find((h) => h.id === selectedId) ?? null
  const { state, client } = useHostClient(selected?.id)
  const activePath = clientActivePath(client ?? undefined)
  const reconnectAttempts = useReconnectAttempt(selected?.id)
  const lastConnectedAt = useLastConnectedAt(selected?.id)

  const subscribe = useCallback(
    (listener: () => void) =>
      selectedId ? connectionLogStore.subscribe(selectedId, listener) : () => {},
    [selectedId]
  )
  const getSnapshot = useCallback(
    () => (selectedId ? connectionLogStore.get(selectedId) : EMPTY_ENTRIES),
    [selectedId]
  )
  const entries = useSyncExternalStore(subscribe, getSnapshot)

  const copyDiagnostics = useCallback(async () => {
    if (!selected) {
      return
    }
    const report = buildConnectionDiagnosticsReport({
      hostName: selected.name,
      endpoint: selected.endpoint,
      activePath,
      state,
      reconnectAttempts,
      lastConnectedAt,
      platform: `${Platform.OS} ${Platform.Version ?? ''}`.trim(),
      appVersion: Constants.expoConfig?.version ?? 'unknown',
      entries
    })
    await Clipboard.setStringAsync(report)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [selected, state, activePath, reconnectAttempts, lastConnectedAt, entries])

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }
      ]}
    >
      <View style={styles.topRow}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>
          {translate('auto.mobile.app.connection.log.c78dc5ccfb', 'Connection log')}
        </Text>
      </View>

      {hosts.length > 1 && (
        <View style={styles.hostPicker}>
          {hosts.map((host) => (
            <Pressable
              key={host.id}
              style={[styles.hostChip, host.id === selectedId && styles.hostChipActive]}
              onPress={() => setSelectedId(host.id)}
            >
              <Text
                style={[styles.hostChipText, host.id === selectedId && styles.hostChipTextActive]}
                numberOfLines={1}
              >
                {host.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {selected ? (
        <>
          <View style={styles.statusRow}>
            <Text style={styles.statusText}>
              {state}
              {state === 'connected' ? ` · ${mobileConnectionPathLabel(activePath)}` : ''}
              {reconnectAttempts > 0
                ? translate('auto.mobile.app.connection.log.9aee626b28', ' · attempt {{value0}}', {
                    value0: reconnectAttempts
                  })
                : ''}
            </Text>
            <Pressable style={styles.copyButton} onPress={() => void copyDiagnostics()}>
              {copied ? (
                <Check size={14} color={colors.statusGreen} />
              ) : (
                <Copy size={14} color={colors.textSecondary} />
              )}
              <Text style={styles.copyButtonText}>
                {copied
                  ? translate('auto.mobile.app.connection.log.0d8cbd791b', 'Copied')
                  : translate('auto.mobile.app.connection.log.1a265761bf', 'Copy diagnostics')}
              </Text>
            </Pressable>
          </View>
          {entries.length > 0 ? (
            <ConnectionLog entries={[...entries]} title={selected.name} fill />
          ) : (
            <Text style={styles.emptyText}>
              {translate(
                'auto.mobile.app.connection.log.157f65530a',
                'No connection events yet this session. Events appear as the app dials this host.'
              )}{' '}
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.emptyText}>
          {translate('auto.mobile.app.connection.log.3ce523c653', 'No paired hosts.')}
        </Text>
      )}
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
  hostPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md
  },
  hostChip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.bgRaised
  },
  hostChipActive: {
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  hostChipText: {
    fontSize: typography.metaSize,
    color: colors.textSecondary,
    maxWidth: 160
  },
  hostChipTextActive: {
    color: colors.textPrimary,
    fontWeight: '600'
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm
  },
  statusText: {
    fontSize: typography.metaSize,
    color: colors.textSecondary
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.bgRaised
  },
  copyButtonText: {
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.textPrimary
  },
  emptyText: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    lineHeight: 18
  }
})
