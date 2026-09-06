import { Pressable, Text, View } from 'react-native'
import { ChevronsDownUp, ChevronsUpDown, Square } from 'lucide-react-native'
import { MobileAgentWorkingIndicator } from './MobileAgentWorkingIndicator'
import { colors } from '../theme/mobile-theme'
import { translate } from '../i18n/i18n'
import { styles } from './mobile-native-chat-view-styles'

/**
 * The strip between the transcript and the composer: the tool-disclosure toggle
 * and, while an agent is running, the stop button.
 *
 * Split out of MobileNativeChatView because localizing its three labels pushed
 * that file past max-lines, and this row is the piece with the fewest ties to
 * the rest of the view — it reads two booleans and calls back.
 */
export function MobileNativeChatChromeRow({
  agentWorking,
  structuredActivityUi,
  toolsExpanded,
  onToggleTools,
  onStop
}: {
  agentWorking: boolean | undefined
  structuredActivityUi: boolean | undefined
  toolsExpanded: boolean
  onToggleTools: () => void
  onStop: (() => void) | undefined
}): React.JSX.Element {
  return (
    <View style={styles.chromeRow}>
      <View style={styles.chromeLeft}>
        {agentWorking && !structuredActivityUi ? <MobileAgentWorkingIndicator /> : null}
        <Pressable
          style={({ pressed }) => [styles.chromeToggle, pressed && styles.pressed]}
          onPress={onToggleTools}
          hitSlop={8}
        >
          {toolsExpanded ? (
            <ChevronsDownUp size={14} color={colors.textMuted} strokeWidth={2} />
          ) : (
            <ChevronsUpDown size={14} color={colors.textMuted} strokeWidth={2} />
          )}
          <Text style={styles.chromeToggleLabel}>
            {toolsExpanded
              ? translate('m.MobileNativeChatView.1e0304cc51', 'Collapse')
              : translate('m.MobileNativeChatView.2779d38b74', 'Tools')}
          </Text>
        </Pressable>
      </View>
      {agentWorking ? (
        <Pressable
          style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
          onPress={onStop}
          hitSlop={8}
          accessibilityLabel="Stop the agent"
        >
          <Square size={13} color={colors.statusRed} strokeWidth={2.4} fill={colors.statusRed} />
          <Text style={styles.stopLabel}>
            {translate('m.MobileNativeChatView.5fcfefb9aa', 'Stop')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}
