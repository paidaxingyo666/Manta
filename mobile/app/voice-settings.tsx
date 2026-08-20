import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'
import { loadHosts } from '../src/transport/host-store'
import type { HostProfile } from '../src/transport/types'
import { useFocusedSettingsHostClients } from '../src/transport/settings-host-client-connections'
import type { RpcClient } from '../src/transport/rpc-client'
import { BottomDrawer } from '../src/components/BottomDrawer'
import { VoiceModelList } from '../src/components/VoiceModelList'
import { useDictationSetupPoller } from '../src/dictation/use-dictation-setup-poller'
import {
  deleteDictationModel,
  downloadDictationModel,
  fetchDictationSetup,
  isModelInFlight,
  setDictationConfig,
  type MobileSpeechModel,
  type MobileSpeechSetup
} from '../src/dictation/mobile-dictation-setup'
import { translate } from '../src/i18n/i18n'
import { localizedConstant } from '../src/i18n/localized-constant'
import { styles } from '../src/theme/voice-settings-styles'

const POLL_INTERVAL_MS = 1500

const dictationModes = localizedConstant(
  () =>
    [
      { value: 'toggle', label: translate('m.voice.settings.cb11e9d147', 'Toggle') },
      { value: 'hold', label: translate('m.voice.settings.858525ff0d', 'Hold') }
    ] as const
)

type ModelBusyAction = { modelId: string; type: 'download' | 'select' | 'delete' }

export default function VoiceSettingsScreen(): React.JSX.Element {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [hosts, setHosts] = useState<HostProfile[]>([])
  useEffect(() => {
    void loadHosts().then(setHosts)
  }, [])
  const hostIds = useMemo(() => hosts.map((h) => h.id), [hosts])
  const { clients: hostClients, focused: routeFocused } = useFocusedSettingsHostClients(hostIds)
  // Voice dictation runs on the paired desktop, so pick the first connected host.
  const client: RpcClient | null = useMemo(
    () => hostClients.find((entry) => entry.state === 'connected')?.client ?? null,
    [hostClients]
  )

  const [setup, setSetup] = useState<MobileSpeechSetup | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<ModelBusyAction | null>(null)
  const [modelDrawerOpen, setModelDrawerOpen] = useState(false)
  const refresh = useCallback(async (): Promise<boolean | undefined> => {
    if (!client) {
      return false
    }
    try {
      const next = await fetchDictationSetup(client)
      setSetup(next)
      setError(null)
      return next.models.some(isModelInFlight)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voice settings')
      return undefined
    } finally {
      setLoading(false)
    }
  }, [client])

  const polling = setup?.models.some(isModelInFlight) ?? false
  const refreshSetup = useDictationSetupPoller({
    visible: routeFocused && client !== null,
    polling,
    refresh,
    intervalMs: POLL_INTERVAL_MS
  })

  useEffect(() => {
    if (routeFocused && client && setup === null) {
      setLoading(true)
    }
  }, [routeFocused, client, setup])

  const handleToggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (!client) {
        return
      }
      setError(null)
      // Optimistic flip so the switch responds instantly; reconcile below.
      setSetup((prev) => (prev ? { ...prev, enabled } : prev))
      try {
        setSetup(await setDictationConfig(client, { enabled }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update')
        void refreshSetup()
      }
    },
    [client, refreshSetup]
  )

  const handleSelectMode = useCallback(
    async (dictationMode: 'toggle' | 'hold') => {
      if (!client) {
        return
      }
      setError(null)
      setSetup((prev) => (prev ? { ...prev, dictationMode } : prev))
      try {
        setSetup(await setDictationConfig(client, { dictationMode }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update')
        void refreshSetup()
      }
    },
    [client, refreshSetup]
  )

  const handleUseModel = useCallback(
    async (model: MobileSpeechModel) => {
      if (!client) {
        return
      }
      setBusyAction({ modelId: model.id, type: 'select' })
      setError(null)
      try {
        setSetup(await setDictationConfig(client, { enabled: true, modelId: model.id }))
        setModelDrawerOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not select model')
      } finally {
        setBusyAction(null)
      }
    },
    [client]
  )

  const handleDownload = useCallback(
    async (model: MobileSpeechModel) => {
      if (!client) {
        return
      }
      setBusyAction({ modelId: model.id, type: 'download' })
      setError(null)
      try {
        await downloadDictationModel(client, model.id)
        await refreshSetup()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Download failed')
      } finally {
        setBusyAction(null)
      }
    },
    [client, refreshSetup]
  )

  const handleDelete = useCallback(
    async (model: MobileSpeechModel) => {
      if (!client) {
        return
      }
      const deletedSelectedModel = setup?.selectedModelId === model.id
      setBusyAction({ modelId: model.id, type: 'delete' })
      setError(null)
      try {
        setSetup(await deleteDictationModel(client, model.id))
        if (deletedSelectedModel) {
          setModelDrawerOpen(false)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Delete failed')
      } finally {
        setBusyAction(null)
      }
    },
    [client, setup?.selectedModelId]
  )

  const enabled = setup?.enabled ?? false
  const selectedModel = setup?.models.find((m) => m.id === setup.selectedModelId)
  const selectedModelLabel =
    selectedModel?.label ?? translate('m.voice.settings.274e79be5b', 'None selected')

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>{translate('m.voice.settings.a529906cda', 'Voice')}</Text>
      </View>

      {!client ? (
        <View style={[styles.section, styles.sectionTopGap]}>
          <Text style={styles.emptyText}>
            {translate(
              'm.voice.settings.a49af08edd',
              'Connect to a desktop to manage voice settings.'
            )}
          </Text>
        </View>
      ) : loading && setup === null ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : setup === null ? (
        <View style={[styles.section, styles.sectionTopGap]}>
          <Text style={styles.errorText}>
            {error ?? translate('m.voice.settings.15b9dfdf5d', 'Failed to load voice settings.')}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.groupHeading}>
            {translate('m.voice.settings.2f87394b1c', 'DICTATION')}
          </Text>
          <View style={[styles.section, styles.sectionTopGap]}>
            <View style={styles.row}>
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>
                  {translate('m.voice.settings.db7bf75951', 'Enable Voice Dictation')}
                </Text>
                <Text style={styles.rowSublabel}>
                  {translate(
                    'm.voice.settings.e20d603180',
                    'Dictate text into any focused pane on your desktop.'
                  )}{' '}
                </Text>
              </View>
              <Switch
                value={enabled}
                onValueChange={(v) => void handleToggleEnabled(v)}
                trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
                thumbColor={colors.textPrimary}
              />
            </View>

            <View style={styles.separator} />

            <View
              style={[styles.row, !enabled && styles.disabled]}
              pointerEvents={enabled ? 'auto' : 'none'}
            >
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>
                  {translate('m.voice.settings.261e33b845', 'Dictation Mode')}
                </Text>
                <Text style={styles.rowSublabel}>
                  {translate(
                    'm.voice.settings.bb05560461',
                    'Toggle: press once to start, again to stop. Hold: dictate while held.'
                  )}{' '}
                </Text>
              </View>
              <View style={styles.segmented}>
                {dictationModes().map((mode) => {
                  const active = setup.dictationMode === mode.value
                  return (
                    <Pressable
                      key={mode.value}
                      onPress={() => void handleSelectMode(mode.value)}
                      style={[styles.segment, active && styles.segmentActive]}
                    >
                      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                        {mode.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          </View>

          <Text style={[styles.groupHeading, styles.inputGroupGap]}>
            {translate('m.voice.settings.9fe0492be7', 'SPEECH MODEL')}
          </Text>
          <View style={[styles.section, styles.sectionTopGap]}>
            <Pressable
              style={({ pressed }) => [
                styles.row,
                !enabled && styles.disabled,
                pressed && styles.rowPressed
              ]}
              disabled={!enabled}
              onPress={() => setModelDrawerOpen(true)}
            >
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>
                  {translate('m.voice.settings.0beb7ba66f', 'Speech Model')}
                </Text>
                <Text style={styles.rowSublabel} numberOfLines={1}>
                  {selectedModelLabel}
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textMuted} />
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      )}

      <BottomDrawer visible={modelDrawerOpen} onClose={() => setModelDrawerOpen(false)}>
        <Text style={styles.drawerTitle}>
          {translate('m.voice.settings.0beb7ba66f', 'Speech Model')}
        </Text>
        {setup ? (
          <VoiceModelList
            setup={setup}
            disabled={false}
            busyAction={busyAction}
            onUseModel={(m) => void handleUseModel(m)}
            onDownload={(m) => void handleDownload(m)}
            onDelete={(m) => void handleDelete(m)}
          />
        ) : null}
      </BottomDrawer>
    </View>
  )
}
