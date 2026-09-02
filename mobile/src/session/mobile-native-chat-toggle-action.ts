import { MessageSquare, SquareTerminal } from 'lucide-react-native'
import type { ActionSheetAction } from '../components/ActionSheetModal'
import { resolveMobileNativeChat, type MobileNativeChatTab } from './mobile-native-chat-eligibility'
import { translate } from '../i18n/i18n'

type ToggleTab = MobileNativeChatTab & {
  id: string
  terminal: string | null
}

/** Builds the optional terminal/chat switch shown in a terminal's long-press menu. */
export function getMobileNativeChatToggleActions(args: {
  terminalHandle: string | null
  tabs: readonly ToggleTab[]
  isTabChatView: (tabId: string) => boolean
  nativeChatTranscriptIsLocalReadable: boolean
  onClose: () => void
  onToggle: (tabId: string) => void
}): ActionSheetAction[] {
  const { terminalHandle, tabs, isTabChatView, onClose, onToggle } = args
  const tab = terminalHandle
    ? tabs.find((candidate) => candidate.terminal === terminalHandle)
    : null
  if (!tab || !resolveMobileNativeChat(tab, args.nativeChatTranscriptIsLocalReadable)) {
    return []
  }
  const isChat = isTabChatView(tab.id)
  return [
    {
      label: isChat
        ? translate('m.mobile.native.chat.toggle.action.76a2ac32a6', 'Switch to terminal view')
        : translate('m.mobile.native.chat.toggle.action.1a6063ae20', 'Switch to chat view'),
      icon: isChat ? SquareTerminal : MessageSquare,
      onPress: () => {
        onClose()
        onToggle(tab.id)
      }
    }
  ]
}
