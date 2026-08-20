import { Eraser, Monitor, Smartphone } from 'lucide-react-native'
import type { ActionSheetAction } from '../components/ActionSheetModal'
import type { MobileNativeChatTab } from './mobile-native-chat-eligibility'
import { getMobileNativeChatToggleActions } from './mobile-native-chat-toggle-action'
import { translate } from '../i18n/i18n'

type TerminalTab = MobileNativeChatTab & { id: string; terminal: string | null }

/** Builds the terminal long-press menu without adding another action block to the
 *  already dense session route. Native chat stays first as the view switch. */
export function getMobileTerminalActionSheetActions<
  Target extends { handle: string },
  Tab extends TerminalTab
>(args: {
  target: Target | null
  tabs: readonly Tab[]
  isTabChatView: (tabId: string) => boolean
  nativeChatTranscriptIsLocalReadable: boolean
  onDismiss: () => void
  onToggleChat: (tabId: string) => void
  isPhoneMode: (handle: string) => boolean
  onToggleDisplayMode: (handle: string) => void
  onRename: (target: Target) => void
  onClear: (target: Target) => void
  /** Fallback for a live handle with no matching session tab. */
  onClose: (target: Target) => void
  /** Preferred path runs host teardown and records the local tombstone. */
  onCloseSessionTab: (tab: Tab) => void
  /** Appended after Close; receives the pressed tab's id so the session route's
   *  bulk-close builder can resolve the anchor itself. */
  bulkCloseActions?: (anchorTabId: string | undefined, dismiss: () => void) => ActionSheetAction[]
}): ActionSheetAction[] {
  const { target } = args
  if (!target) {
    return []
  }
  const phoneMode = args.isPhoneMode(target.handle)
  const sessionTab = args.tabs.find((tab) => tab.terminal === target.handle)
  return [
    ...getMobileNativeChatToggleActions({
      terminalHandle: target.handle,
      tabs: args.tabs,
      isTabChatView: args.isTabChatView,
      nativeChatTranscriptIsLocalReadable: args.nativeChatTranscriptIsLocalReadable,
      onClose: args.onDismiss,
      onToggle: args.onToggleChat
    }),
    {
      label: phoneMode
        ? translate(
            'auto.mobile.src.session.mobile.terminal.action.sheet.actions.d176f3200b',
            'Switch to Desktop'
          )
        : translate(
            'auto.mobile.src.session.mobile.terminal.action.sheet.actions.e74d91fe61',
            'Switch to Phone'
          ),
      icon: phoneMode ? Monitor : Smartphone,
      onPress: () => {
        args.onDismiss()
        args.onToggleDisplayMode(target.handle)
      }
    },
    {
      label: translate(
        'auto.mobile.src.session.mobile.terminal.action.sheet.actions.db014329a6',
        'Rename'
      ),
      closeBeforePress: true,
      onPress: () => {
        args.onRename(target)
      }
    },
    {
      label: translate(
        'auto.mobile.src.session.mobile.terminal.action.sheet.actions.e6ce1536cc',
        'Clear Terminal'
      ),
      icon: Eraser,
      onPress: () => {
        args.onDismiss()
        args.onClear(target)
      }
    },
    {
      label: translate(
        'auto.mobile.src.session.mobile.terminal.action.sheet.actions.937d975bac',
        'Close'
      ),
      destructive: true,
      onPress: () => {
        args.onDismiss()
        if (sessionTab) {
          args.onCloseSessionTab(sessionTab)
          return
        }
        args.onClose(target)
      }
    },
    ...(args.bulkCloseActions?.(sessionTab?.id, args.onDismiss) ?? [])
  ]
}
