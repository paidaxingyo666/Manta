import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { VoiceSettingsOperations } from './voice-settings-operations'
import { voiceSettingsStyles as styles } from './voice-settings-styles'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { colors, spacing } from '../theme/mobile-theme'
import { BottomDrawer } from '../components/BottomDrawer'
import { VoiceModelList } from '../components/VoiceModelList'
import { useDictationSetupPoller } from '../dictation/use-dictation-setup-poller'
import {
  isModelInFlight,
  type MobileSpeechModel,
  type MobileSpeechSetup
} from '../dictation/mobile-dictation-setup'
import { translate } from '../i18n/i18n'
import { localizedConstant } from '../i18n/localized-constant'

const POLL_INTERVAL_MS = 1500

const dictationModes = localizedConstant(
  () =>
    [
      { value: 'toggle', label: translate('m.voice.settings.cb11e9d147', 'Toggle') },
      { value: 'hold', label: translate('m.voice.settings.858525ff0d', 'Hold') }
    ] as const
)

type ModelBusyAction = { modelId: string; type: 'download' | 'select' | 'delete' }

export default function VoiceSettingsScreen({
  operations,
  focused,
  onBack
}: {
  operations: VoiceSettingsOperations | null
  focused: boolean
  onBack: () => void
}): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const [setup, setSetup] = useState<MobileSpeechSetup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<ModelBusyAction | null>(null)
  const requestEpoch = useRef(0)
  const [modelDrawerOpen, setModelDrawerOpen] = useState(false)
  const refresh = useCallback(async (): Promise<boolean | undefined> => {
    if (!operations) {
      return false
    }
    const epoch = requestEpoch.current
    // Own the spinner from the read that clears it, so a retry after a failed load shows
    // the spinner again instead of the stale error card. Reads are serialised by
    // DictationSetupPollController, so no in-flight read can clear another's flag.
    setLoading(true)
    try {
      const next = await operations.load()
      if (epoch !== requestEpoch.current) {
        return undefined
      }
      setSetup(next)
      setError(null)
      return next.models.some(isModelInFlight)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voice settings')
      return undefined
    } finally {
      setLoading(false)
    }
  }, [operations])

  const polling = setup?.models.some(isModelInFlight) ?? false
  const refreshSetup = useDictationSetupPoller({
    visible: focused && operations !== null,
    polling,
    refresh,
    intervalMs: POLL_INTERVAL_MS
  })

  const configure = useCallback(
    async (params: Parameters<VoiceSettingsOperations['configure']>[0]) => {
      if (!operations) {
        return
      }
      requestEpoch.current += 1
      setError(null)
      // Optimistic flip so the control responds instantly; reconcile below.
      const { enabled, dictationMode } = params
      setSetup((prev) =>
        prev
          ? {
              ...prev,
              ...(enabled === undefined ? {} : { enabled }),
              ...(dictationMode === undefined ? {} : { dictationMode })
            }
          : prev
      )
      try {
        setSetup(await operations.configure(params))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update')
        void refreshSetup()
      }
    },
    [operations, refreshSetup]
  )

  const handleUseModel = useCallback(
    async (model: MobileSpeechModel) => {
      if (!operations) {
        return
      }
      requestEpoch.current += 1
      setBusyAction({ modelId: model.id, type: 'select' })
      setError(null)
      try {
        setSetup(await operations.configure({ enabled: true, modelId: model.id }))
        setModelDrawerOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not select model')
      } finally {
        setBusyAction(null)
      }
    },
    [operations]
  )

  const handleDownload = useCallback(
    async (model: MobileSpeechModel) => {
      if (!operations) {
        return
      }
      requestEpoch.current += 1
      setBusyAction({ modelId: model.id, type: 'download' })
      setError(null)
      try {
        await operations.download(model.id)
        await refreshSetup()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Download failed')
      } finally {
        setBusyAction(null)
      }
    },
    [operations, refreshSetup]
  )

  const handleDelete = useCallback(
    async (model: MobileSpeechModel) => {
      if (!operations) {
        return
      }
      const deletedSelectedModel = setup?.selectedModelId === model.id
      requestEpoch.current += 1
      setBusyAction({ modelId: model.id, type: 'delete' })
      setError(null)
      try {
        setSetup(await operations.delete(model.id))
        if (deletedSelectedModel) {
          setModelDrawerOpen(false)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Delete failed')
      } finally {
        setBusyAction(null)
      }
    },
    [operations, setup?.selectedModelId]
  )

  const enabled = setup?.enabled ?? false
  const selectedModel = setup?.models.find((m) => m.id === setup.selectedModelId)
  const selectedModelLabel =
    selectedModel?.label ?? translate('m.voice.settings.screen.0400b20444', 'None selected')

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backButton}
          onPress={onBack}
        >
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>
          {translate('m.voice.settings.screen.a1cbf7814a', 'Voice')}
        </Text>
      </View>

      {!operations ? (
        <View style={[styles.section, styles.sectionTopGap]}>
          <Text style={styles.emptyText}>
            {translate(
              'm.voice.settings.screen.94921afad1',
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
            {error ??
              translate('m.voice.settings.screen.4cee2463f9', 'Failed to load voice settings.')}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.groupHeading}>
            {translate('m.voice.settings.screen.680db0cdb2', 'DICTATION')}
          </Text>
          <View style={[styles.section, styles.sectionTopGap]}>
            <View style={styles.row}>
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>
                  {translate('m.voice.settings.screen.a261b74160', 'Enable Voice Dictation')}
                </Text>
                <Text style={styles.rowSublabel}>
                  {translate(
                    'm.voice.settings.screen.0d9e2ef97d',
                    'Dictate text into any focused pane on your desktop.'
                  )}
                </Text>
              </View>
              <Switch
                testID="voice-enabled"
                accessibilityLabel="Enable Voice Dictation"
                value={enabled}
                onValueChange={(enabled) => void configure({ enabled })}
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
                  {translate('m.voice.settings.screen.7bd89184c8', 'Dictation Mode')}
                </Text>
                <Text style={styles.rowSublabel}>
                  {translate(
                    'm.voice.settings.screen.63fc1b1ff8',
                    'Toggle: press once to start, again to stop. Hold: dictate while held.'
                  )}
                </Text>
              </View>
              <View style={styles.segmented}>
                {dictationModes().map((mode) => {
                  const active = setup.dictationMode === mode.value
                  return (
                    <Pressable
                      key={mode.value}
                      accessibilityRole="radio"
                      aria-checked={active}
                      testID={`voice-mode-${mode.value}`}
                      onPress={() => void configure({ dictationMode: mode.value })}
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
            {translate('m.voice.settings.screen.507f56779b', 'SPEECH MODEL')}
          </Text>
          <View style={[styles.section, styles.sectionTopGap]}>
            <Pressable
              style={({ pressed }) => [
                styles.row,
                !enabled && styles.disabled,
                pressed && styles.rowPressed
              ]}
              disabled={!enabled}
              testID="voice-model-picker"
              onPress={() => setModelDrawerOpen(true)}
            >
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>
                  {translate('m.voice.settings.screen.075ba22e20', 'Speech Model')}
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
          {translate('m.voice.settings.screen.075ba22e20', 'Speech Model')}
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
