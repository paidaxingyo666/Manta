import type { ReactNode } from 'react'
import { View, Text, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, Copy, Check, Send } from 'lucide-react-native'
import { colors, spacing } from '../theme/mobile-theme'
import { ConnectionLog } from '../components/ConnectionLog'
import { connectionDiagnosticsScreenStyles as styles } from './connection-diagnostics-screen-styles'
import type { ConnectionLogEntry, ConnectionState } from '../transport/types'
import type { ConnectionDiagnosis } from './connection-diagnostics-analysis'
import type { DiagnosticsSubmissionState } from './connection-diagnostics-screen-data'
import { translate } from '../i18n/i18n'

export function ConnectionDiagnosticsView({
  hostPicker,
  hasHost,
  hostName,
  state,
  reconnectAttempts,
  copied,
  copyDiagnostics,
  diagnosis,
  submissionState,
  sendDiagnostics,
  entries,
  onBack
}: {
  hostPicker?: ReactNode
  hasHost: boolean
  hostName: string
  state: ConnectionState
  reconnectAttempts: number
  copied: boolean
  copyDiagnostics: () => Promise<void>
  diagnosis: ConnectionDiagnosis | null
  submissionState: DiagnosticsSubmissionState | 'idle'
  sendDiagnostics: () => Promise<void>
  entries: readonly ConnectionLogEntry[]
  onBack: () => void
}) {
  const insets = useSafeAreaInsets()
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
          {translate('m.connection.diagnostics.view.6a757b5242', 'Network diagnostics')}
        </Text>
      </View>

      {hostPicker}
      {hasHost ? (
        <>
          <View style={styles.statusRow}>
            <Text style={styles.statusText}>
              {state}
              {reconnectAttempts > 0
                ? translate('m.connection.diagnostics.view.8ee8017127', ' · attempt {{value0}}', {
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
                  ? translate('m.connection.diagnostics.view.8ade5b948b', 'Copied')
                  : translate('m.connection.diagnostics.view.ef7a8c4b20', 'Copy report')}
              </Text>
            </Pressable>
          </View>
          {diagnosis && (
            <View style={styles.diagnosisCard}>
              <Text style={styles.diagnosisHeading}>
                {translate('m.connection.diagnostics.view.316cb8c8c8', 'What this suggests')}
              </Text>
              <Text style={styles.diagnosisText}>{diagnosis.likelyCause}</Text>
              <Text style={styles.diagnosisNext}>{diagnosis.nextStep}</Text>
              {diagnosis.reportability === 'manta-relay' && (
                <>
                  <Text style={styles.privacyHint}>
                    {translate(
                      'm.connection.diagnostics.view.1941af1d5f',
                      'Sends a size-limited redacted report including host name, endpoint, versions, connection state, and events—never terminal contents or credentials.'
                    )}
                  </Text>
                  <Pressable
                    style={styles.sendButton}
                    onPress={() => void sendDiagnostics()}
                    disabled={submissionState === 'sending'}
                  >
                    {submissionState === 'sent' ? (
                      <Check size={14} color={colors.statusGreen} />
                    ) : (
                      <Send size={14} color={colors.textPrimary} />
                    )}
                    <Text style={styles.sendButtonText}>
                      {submissionState === 'sending'
                        ? translate('m.connection.diagnostics.view.05c9c29a8d', 'Sending…')
                        : submissionState === 'sent'
                          ? translate(
                              'm.connection.diagnostics.view.79d02552ab',
                              'Diagnostics sent'
                            )
                          : submissionState === 'failed'
                            ? translate('m.connection.diagnostics.view.c5d80cbf5b', 'Retry sending')
                            : translate(
                                'm.connection.diagnostics.view.c093e73602',
                                'Send diagnostics to Manta'
                              )}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          )}
          {entries.length > 0 ? (
            <ConnectionLog entries={[...entries]} title={hostName} fillAvailableHeight />
          ) : (
            <Text style={styles.emptyText}>
              {translate(
                'm.connection.diagnostics.view.d37c974971',
                'No connection events yet. Events appear as the app dials this host.'
              )}
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.emptyText}>
          {translate('m.connection.diagnostics.view.e8d2358112', 'No paired hosts.')}
        </Text>
      )}
    </View>
  )
}
