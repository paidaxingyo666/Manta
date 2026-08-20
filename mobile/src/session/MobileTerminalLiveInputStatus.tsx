import { StyleSheet, Text, View } from 'react-native'
import { colors, typography } from '../theme/mobile-theme'
import { translate } from '../i18n/i18n'

type DictationStatus = {
  readonly isStarting: boolean
  readonly isRecording: boolean
  readonly isProcessing: boolean
}

type MobileTerminalLiveInputStatusProps = {
  readonly dictation: DictationStatus
  readonly isAttaching: boolean
  readonly liveInputText: string
}

export function MobileTerminalLiveInputStatus({
  dictation,
  isAttaching,
  liveInputText
}: MobileTerminalLiveInputStatusProps) {
  const title = dictation.isRecording
    ? translate('auto.mobile.src.session.MobileTerminalLiveInputStatus.cba1909d50', 'Listening')
    : dictation.isProcessing
      ? translate('auto.mobile.src.session.MobileTerminalLiveInputStatus.43b48ff5fa', 'Processing')
      : dictation.isStarting
        ? translate(
            'auto.mobile.src.session.MobileTerminalLiveInputStatus.fcc1860f91',
            'Starting mic'
          )
        : translate(
            'auto.mobile.src.session.MobileTerminalLiveInputStatus.91ba33a4aa',
            'Live input'
          )
  const detail = dictation.isRecording
    ? translate(
        'auto.mobile.src.session.MobileTerminalLiveInputStatus.1865e8a27a',
        'Tap mic to stop'
      )
    : dictation.isProcessing
      ? translate(
          'auto.mobile.src.session.MobileTerminalLiveInputStatus.ffe7662360',
          'Transcribing on desktop'
        )
      : dictation.isStarting
        ? translate(
            'auto.mobile.src.session.MobileTerminalLiveInputStatus.85aee3eea3',
            'Preparing microphone'
          )
        : isAttaching
          ? translate(
              'auto.mobile.src.session.MobileTerminalLiveInputStatus.aae3384704',
              'Uploading image to host'
            )
          : liveInputText ||
            translate(
              'auto.mobile.src.session.MobileTerminalLiveInputStatus.ec87f139b7',
              'Tap to show keyboard'
            )

  return (
    <View style={styles.status}>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.detail} numberOfLines={1} ellipsizeMode="head">
        {detail}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  status: {
    flex: 1,
    gap: 1
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  detail: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily
  }
})
