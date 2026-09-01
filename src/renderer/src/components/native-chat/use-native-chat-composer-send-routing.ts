import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { NativeChatLaunchDraft } from '@/lib/native-chat-launch-prompt'
import { sendRuntimePtyInput } from '@/runtime/runtime-terminal-inspection'
import { emitNativeChatMessageSent } from '@/lib/native-chat-telemetry'
import { isStructuredAgentSessionComposerCommand } from '../../../../shared/structured-agent-session-composer'
import {
  pushHistory,
  type HistoryState,
  type NativeChatPickerItem
} from './native-chat-composer-state'
import type { NativeChatResolvedTarget } from './native-chat-composer-target'
import type { NativeChatComposerImageAttachment } from './NativeChatComposerField'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'
import type { NativeChatPtySessionOptionsSurface } from './native-chat-pty-session-options'
import { dispatchNativeChatStructuredComposerText } from './native-chat-structured-composer-dispatch'
import { useNativeChatPtyComposerSend } from './use-native-chat-pty-composer-send'
import { useNativeChatPickerCommandDispatch } from './use-native-chat-picker-command-dispatch'
import type { NativeChatPickerState } from './use-native-chat-picker-state'
import type { NativeChatSendLifecycle } from './use-native-chat-send-lifecycle'

// Why: a plain ESC byte is what the agent TUIs read as the interrupt key over a
// PTY (matching how xterm forwards Escape). The richer interrupt-intent
// inference (agent-interrupt-intent.ts) is driven by the existing PTY input
// observers, so writing ESC through the same send path feeds that machinery.
const ESC = '\x1b'

export type NativeChatComposerSendRouting = {
  send: () => void
  interrupt: () => void
  dispatchPickerCommand: (command: Extract<NativeChatPickerItem, { kind: 'command' }>) => void
}

/**
 * Picks the transport for every outbound composer action. A structured session
 * journals text through its transport; otherwise the same action is written into
 * the hosted TUI's PTY. Both branches must leave identical composer state
 * behind, so history, draft, skill origin and attachments are cleared here.
 */
export function useNativeChatComposerSendRouting(args: {
  agent: AgentType
  draft: string
  imageAttachments: readonly NativeChatComposerImageAttachment[]
  disabled: boolean
  isWorking: boolean
  isDispatchingSessionOption: boolean
  launchDraft?: NativeChatLaunchDraft | null
  launchDraftResolved: boolean
  readTerminalScreen?: () => string | null
  resolveTarget: () => NativeChatResolvedTarget | null
  classifySend: NativeChatPickerState['classifySend']
  onOptimisticSend?: (text: string, imagePaths?: string[]) => string | undefined
  onSlashCommand?: (command: string) => void
  onStop?: () => void
  ptySessionOptionsSurface: NativeChatPtySessionOptionsSurface | null
  structuredTransport?: NativeChatStructuredComposerTransport
  terminalTabId: string
  cancelPendingSends: NativeChatSendLifecycle['cancelPendingSends']
  trackPendingSend: NativeChatSendLifecycle['trackPendingSend']
  setHistory: Dispatch<SetStateAction<HistoryState>>
  setDraft: (value: string) => void
  setCaret: Dispatch<SetStateAction<number>>
  setActiveSuggestion: Dispatch<SetStateAction<number>>
  clearSkillOrigin: () => void
  clearImageAttachments: () => void
  setNotice: Dispatch<SetStateAction<string | null>>
}): NativeChatComposerSendRouting {
  const {
    agent,
    draft,
    imageAttachments,
    disabled,
    isWorking,
    isDispatchingSessionOption,
    onStop,
    ptySessionOptionsSurface,
    resolveTarget,
    structuredTransport,
    cancelPendingSends,
    setCaret,
    setDraft,
    setHistory,
    clearSkillOrigin,
    clearImageAttachments
  } = args

  const sendStructured = useCallback(
    (text: string, attachments = imageAttachments): void => {
      if (!structuredTransport) {
        return
      }
      if (attachments.length > 0 && isStructuredAgentSessionComposerCommand(text, agent)) {
        structuredTransport.onError('Remove attachments before using a chat-session command.')
        return
      }
      void dispatchNativeChatStructuredComposerText(structuredTransport, text, attachments)
        .then(({ accepted, error }) => {
          structuredTransport.onError(error)
          if (!accepted) {
            return
          }
          emitNativeChatMessageSent({ agent, runtime: structuredTransport.runtime })
          setHistory((previous) => pushHistory(previous, text))
          setDraft('')
          setCaret(0)
          clearSkillOrigin()
          clearImageAttachments()
        })
        .catch((error) =>
          structuredTransport.onError(error instanceof Error ? error.message : String(error))
        )
    },
    [
      agent,
      clearImageAttachments,
      clearSkillOrigin,
      imageAttachments,
      setCaret,
      setDraft,
      setHistory,
      structuredTransport
    ]
  )

  const sendPty = useNativeChatPtyComposerSend({
    agent,
    draft,
    imageAttachments,
    disabled,
    isDispatchingSessionOption,
    launchDraft: args.launchDraft,
    launchDraftResolved: args.launchDraftResolved,
    readTerminalScreen: args.readTerminalScreen,
    resolveTarget,
    classifySend: args.classifySend,
    onOptimisticSend: args.onOptimisticSend,
    onSlashCommand: args.onSlashCommand,
    sessionOptionsSurface: ptySessionOptionsSurface,
    terminalTabId: args.terminalTabId,
    trackPendingSend: args.trackPendingSend,
    setHistory,
    setDraft,
    setCaret,
    clearSkillOrigin,
    clearImageAttachments,
    setNotice: args.setNotice
  })
  const send = useCallback(() => {
    if (!structuredTransport) {
      sendPty()
    } else if ((draft.trim() !== '' || imageAttachments.length > 0) && !disabled) {
      sendStructured(draft, imageAttachments)
    }
  }, [disabled, draft, imageAttachments, sendPty, sendStructured, structuredTransport])

  const interrupt = useCallback(() => {
    cancelPendingSends()
    if (isWorking && onStop) {
      onStop()
      return
    }
    const target = resolveTarget()
    if (!target) {
      return
    }
    sendRuntimePtyInput(target.settings, target.ptyId, ESC)
  }, [cancelPendingSends, isWorking, onStop, resolveTarget])

  const dispatchPtyPickerCommand = useNativeChatPickerCommandDispatch({
    agent,
    disabled,
    isDispatchingSessionOption,
    resolveTarget,
    onSlashCommand: args.onSlashCommand,
    sessionOptionsSurface: ptySessionOptionsSurface,
    trackPendingSend: args.trackPendingSend,
    setHistory,
    setDraft,
    setCaret,
    setActiveSuggestion: args.setActiveSuggestion,
    clearSkillOrigin,
    clearImageAttachments,
    setNotice: args.setNotice
  })
  const dispatchPickerCommand = useCallback(
    (command: Extract<NativeChatPickerItem, { kind: 'command' }>) => {
      if (structuredTransport) {
        sendStructured(`/${command.name}`)
        return
      }
      dispatchPtyPickerCommand(command)
    },
    [dispatchPtyPickerCommand, sendStructured, structuredTransport]
  )

  return { send, interrupt, dispatchPickerCommand }
}
