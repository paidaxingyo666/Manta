// @vitest-environment happy-dom

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../shared/native-chat-session-options'
import { clearNativeChatSessionOptionCacheForTests } from './native-chat-session-option-cache'
import { clearNativeChatModelEnrichmentForTests } from './native-chat-session-option-enrichment'

const mocks = vi.hoisted(() => ({
  cancelPendingSends: vi.fn(),
  composerIsComposing: null as (() => boolean) | null,
  attachmentIsComposing: null as (() => boolean) | null,
  flushPendingAttachments: vi.fn(),
  fieldProps: null as {
    onSend?: () => void
    onStop?: () => void
    imeEnterGesture?: {
      isComposing: () => boolean
      setComposing: (active: boolean) => void
    }
    onImeSettled?: (element: HTMLTextAreaElement) => void
    sessionOptionsSurface?: SessionOptionsSurface | null
    sessionOptionsSnapshot?: SessionOptionDescriptor[]
    attachDisabled?: boolean
    sendButtonDisabled?: boolean
    autocomplete?: { mode: string; items?: { kind: string; name: string }[] }
  } | null,
  modelSwitchOutcome: 'applied' as 'applied' | 'rejected' | 'unknown',
  confirmationObserver: null as {
    ready: Promise<void>
    result: Promise<'applied' | 'rejected' | 'unknown'>
    arm: ReturnType<typeof vi.fn>
    startDetection: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  } | null,
  createClaudeModelSwitchConfirmationObserver: vi.fn(),
  discoverCommitMessageModels: vi.fn(),
  draft: 'hello',
  imageAttachments: [] as { id: string; path: string; pending?: boolean }[],
  getMainBufferSnapshot: vi.fn(),
  sendHandle: { cancel: vi.fn(), settleAfterMs: 500 },
  sendNativeChatMessage: vi.fn(),
  sendNativeChatMessageWithImageAttachments: vi.fn(),
  sendNativeChatTypedCommand: vi.fn(),
  sendNativeChatMessageVerified: vi.fn(),
  typeNativeChatCommand: vi.fn(),
  trackPendingSend: vi.fn(),
  setDraft: vi.fn(),
  draftScopeKeys: [] as string[],
  clearNativeChatLaunchDraft: vi.fn(),
  markNativeChatLaunchDraftAdopted: vi.fn()
}))

vi.mock('../../store', () => {
  const state = {
    dictationState: 'idle',
    settings: { voice: { enabled: false }, nativeChatSessionOptions: {} },
    agentStatusByPaneKey: {},
    updateSettings: vi.fn(),
    clearNativeChatLaunchDraft: mocks.clearNativeChatLaunchDraft,
    markNativeChatLaunchDraftAdopted: mocks.markNativeChatLaunchDraftAdopted
  }
  const useAppStore = (selector: (value: typeof state) => unknown) => selector(state)
  useAppStore.getState = () => state
  return { useAppStore }
})

vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  isRemoteRuntimePtyId: () => false,
  sendRuntimePtyInput: vi.fn()
}))
vi.mock('@/lib/agent-paste-draft', () => ({
  getSettingsForAgentTabRuntimeOwner: () => ({})
}))
vi.mock('./native-chat-attachment-upload', () => ({
  getNativeChatAttachmentOwnerIdentity: () => 'local',
  nativeChatLocalAttachmentUnsupportedNotice: () => 'Attachments unavailable',
  nativeChatWorktreeNotReadyNotice: () => 'Worktree not ready',
  resolveNativeChatAttachmentOwner: () => ({ kind: 'local' }),
  resolveNativeChatAttachmentOwnerForWorktree: () => ({ kind: 'local' }),
  uploadNativeChatAttachmentPaths: async (paths: string[]) => paths
}))
vi.mock('./native-chat-runtime-send', () => ({
  sendNativeChatMessage: (...args: unknown[]) => mocks.sendNativeChatMessage(...args),
  sendNativeChatTypedCommand: (...args: unknown[]) => mocks.sendNativeChatTypedCommand(...args),
  sendNativeChatMessageVerified: (...args: unknown[]) =>
    mocks.sendNativeChatMessageVerified(...args),
  typeNativeChatCommand: (...args: unknown[]) => mocks.typeNativeChatCommand(...args),
  submitNativeChatPrompt: vi.fn()
}))
vi.mock('./native-chat-runtime-image-send', () => ({
  sendNativeChatMessageWithImageAttachments: (...args: unknown[]) =>
    mocks.sendNativeChatMessageWithImageAttachments(...args)
}))
vi.mock('./claude-model-switch-confirmation', () => ({
  createClaudeModelSwitchConfirmationObserver: (...args: unknown[]) =>
    mocks.createClaudeModelSwitchConfirmationObserver(...args)
}))
vi.mock('@/lib/native-chat-telemetry', () => ({
  emitNativeChatMessageSent: vi.fn(),
  emitNativeChatPickerItemAccepted: vi.fn(),
  emitNativeChatPickerOpened: vi.fn(),
  emitNativeChatSendClassified: vi.fn()
}))
vi.mock('./use-native-chat-draft', () => ({
  useNativeChatDraft: (scopeKey: string) => {
    mocks.draftScopeKeys.push(scopeKey)
    return { draft: mocks.draft, setDraft: mocks.setDraft, flushDraftAppends: () => {} }
  }
}))
vi.mock('./native-chat-draft-cache', () => ({
  readNativeChatDraftCache: () => ''
}))
vi.mock('./NativeChatComposerField', () => ({
  NativeChatComposerField: (props: { onSend?: () => void; onStop?: () => void }) => {
    mocks.fieldProps = props
    return <div data-testid="native-chat-composer-field" />
  }
}))
vi.mock('./use-native-chat-skills', () => ({
  useNativeChatSkills: () => ({ status: 'ready', skills: [], error: null, retry: () => {} })
}))
vi.mock('./use-native-chat-composer-attachments', () => ({
  useNativeChatComposerAttachments: (args: { isComposing: () => boolean }) => {
    mocks.attachmentIsComposing = args.isComposing
    return {
      imageAttachments: mocks.imageAttachments,
      attachResolvedPaths: vi.fn(),
      clearImageAttachments: vi.fn(),
      flushPendingAttachments: mocks.flushPendingAttachments,
      removeImageAttachment: vi.fn(),
      pendingChips: { begin: vi.fn(), resolve: vi.fn(), drop: vi.fn(), attachReferences: vi.fn() }
    }
  }
}))
vi.mock('./use-native-chat-composer-paste', () => ({
  useNativeChatComposerPaste: () => ({
    handlePaste: vi.fn(),
    pasteFromClipboard: vi.fn()
  })
}))
vi.mock('./use-native-chat-external-attachments', () => ({
  useNativeChatExternalAttachments: () => ({
    attachExternalPaths: vi.fn(),
    resolveAttachmentOwner: vi.fn()
  })
}))
vi.mock('../dictation/dictation-control-events', () => ({
  dispatchDictationControl: vi.fn()
}))
vi.mock('./use-native-chat-composer-keydown', () => ({
  useNativeChatComposerKeyDown: (args: { isComposing: () => boolean }) => {
    mocks.composerIsComposing = args.isComposing
    return vi.fn()
  }
}))
vi.mock('./use-native-chat-send-lifecycle', () => ({
  useNativeChatSendLifecycle: () => ({
    cancelPendingSends: mocks.cancelPendingSends,
    trackPendingSend: mocks.trackPendingSend
  })
}))

import { NativeChatComposer } from './NativeChatComposer'

describe('NativeChatComposer session options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearNativeChatSessionOptionCacheForTests()
    clearNativeChatModelEnrichmentForTests()
    mocks.fieldProps = null
    mocks.modelSwitchOutcome = 'applied'
    mocks.draft = 'hello'
    mocks.imageAttachments = []
    mocks.draftScopeKeys.length = 0
    mocks.confirmationObserver = null
    mocks.composerIsComposing = null
    mocks.attachmentIsComposing = null
    mocks.createClaudeModelSwitchConfirmationObserver.mockImplementation(() => {
      const observer = {
        ready: Promise.resolve(),
        result: Promise.resolve(mocks.modelSwitchOutcome),
        arm: vi.fn(),
        startDetection: vi.fn(),
        dispose: vi.fn()
      }
      mocks.confirmationObserver = observer
      return observer
    })
    mocks.getMainBufferSnapshot.mockResolvedValue(null)
    mocks.discoverCommitMessageModels.mockResolvedValue({
      success: true,
      catalogOrigin: 'probe',
      models: [
        {
          id: 'opus',
          label: 'Opus',
          thinkingLevels: [
            { id: 'medium', label: 'Medium' },
            { id: 'high', label: 'High' }
          ]
        },
        {
          id: 'sonnet',
          label: 'Sonnet',
          thinkingLevels: [
            { id: 'medium', label: 'Medium' },
            { id: 'high', label: 'High' }
          ]
        },
        { id: 'fable', label: 'Fable' }
      ]
    })
    mocks.sendNativeChatMessage.mockReturnValue(mocks.sendHandle)
    mocks.sendNativeChatMessageWithImageAttachments.mockReturnValue(mocks.sendHandle)
    mocks.sendNativeChatTypedCommand.mockReturnValue(mocks.sendHandle)
    mocks.sendNativeChatMessageVerified.mockResolvedValue(true)
    mocks.typeNativeChatCommand.mockResolvedValue(true)
    mocks.sendHandle.settleAfterMs = 500
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        git: { discoverCommitMessageModels: mocks.discoverCommitMessageModels },
        pty: { getMainBufferSnapshot: mocks.getMainBufferSnapshot },
        ui: { onFileDrop: () => vi.fn() }
      }
    })
  })

  afterEach(() => cleanup())

  it('renders the Claude model picker while host discovery is still pending', () => {
    mocks.discoverCommitMessageModels.mockReturnValue(new Promise(() => {}))
    render(
      <NativeChatComposer
        terminalTabId="tab-1"
        paneKey="tab-1:leaf-1"
        targetPtyId="pty-1"
        agent="claude"
        readTerminalScreen={() => null}
      />
    )

    expect(mocks.fieldProps?.sessionOptionsSnapshot?.[0]).toMatchObject({
      id: 'model',
      kind: {
        choices: expect.arrayContaining([
          expect.objectContaining({ value: 'opus', label: 'Opus' }),
          expect.objectContaining({ value: 'sonnet', label: 'Sonnet' })
        ])
      }
    })
  })

  it('keeps the Claude model picker when an older remote runtime omits the catalog origin', async () => {
    mocks.discoverCommitMessageModels.mockResolvedValue({
      success: true,
      defaultModelId: 'sonnet',
      models: [{ id: 'sonnet', label: 'Sonnet' }]
    })
    render(
      <NativeChatComposer
        terminalTabId="tab-1"
        paneKey="tab-1:leaf-1"
        targetPtyId="pty-1"
        agent="claude"
        readTerminalScreen={() => null}
      />
    )

    await waitFor(() => expect(mocks.discoverCommitMessageModels).toHaveBeenCalled())
    await act(async () => undefined)

    expect(mocks.fieldProps?.sessionOptionsSnapshot?.[0]).toMatchObject({
      id: 'model',
      kind: {
        choices: expect.arrayContaining([
          expect.objectContaining({ value: 'fable', label: 'Fable' }),
          expect.objectContaining({ value: 'haiku', label: 'Haiku' })
        ])
      }
    })
  })

  it('shows the model already selected in the Claude TUI when chat opens', async () => {
    mocks.getMainBufferSnapshot.mockResolvedValue({
      data: 'Claude Code v2.1.211\r\nOpus 4.8 with medium effort · API Usage Billing',
      cols: 120,
      rows: 40
    })
    render(
      <NativeChatComposer
        terminalTabId="tab-1"
        paneKey="tab-1:leaf-1"
        targetPtyId="pty-1"
        agent="claude"
        readTerminalScreen={() => null}
      />
    )

    await waitFor(() =>
      expect(mocks.fieldProps?.sessionOptionsSnapshot).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'model',
            valueSource: 'reported',
            kind: expect.objectContaining({ currentValue: 'opus' })
          }),
          expect.objectContaining({
            id: 'effort',
            valueSource: 'reported',
            kind: expect.objectContaining({ currentValue: 'medium' })
          })
        ])
      )
    )
    expect(mocks.getMainBufferSnapshot).toHaveBeenCalledWith('pty-1', { scrollbackRows: 0 })
  })

  it('reads Claude state from mounted xterm while its alternate screen is active', async () => {
    mocks.getMainBufferSnapshot.mockResolvedValue({
      data: 'Claude Code v2.1.211\r\nOpus 4.8 with high effort · stale main buffer',
      cols: 120,
      rows: 40,
      alternateScreen: true
    })
    render(
      <NativeChatComposer
        terminalTabId="tab-1"
        paneKey="tab-1:leaf-1"
        targetPtyId="pty-1"
        agent="claude"
        readTerminalScreen={() =>
          '\u001b[?1049h\u001b[HClaude Codev2.1.211\r\n' +
          'Sonnet 5 with medium effort · API Usage Billing'
        }
      />
    )

    await waitFor(() =>
      expect(mocks.fieldProps?.sessionOptionsSnapshot).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'model',
            valueSource: 'reported',
            kind: expect.objectContaining({ currentValue: 'sonnet' })
          }),
          expect.objectContaining({
            id: 'effort',
            valueSource: 'reported',
            kind: expect.objectContaining({ currentValue: 'medium' })
          })
        ])
      )
    )
  })

  it('observes a fresh Claude model choice and stays native on success', async () => {
    mocks.sendHandle.settleAfterMs = 0
    const onSlashCommand = vi.fn()
    const onOptimisticSend = vi.fn()
    const onSwitchToTerminal = vi.fn()
    render(
      <NativeChatComposer
        terminalTabId="tab-1"
        paneKey="tab-1:leaf-1"
        targetPtyId="pty-1"
        agent="claude"
        onSlashCommand={onSlashCommand}
        onOptimisticSend={onOptimisticSend}
        onSwitchToTerminal={onSwitchToTerminal}
      />
    )

    await act(async () => {
      await mocks.fieldProps?.sessionOptionsSurface?.setOption('model', 'opus')
    })

    expect(mocks.sendNativeChatMessageVerified).toHaveBeenCalledWith(
      {},
      'pty-1',
      '/model opus',
      expect.any(AbortSignal)
    )
    expect(onSlashCommand).toHaveBeenCalledWith('/model opus')
    expect(onOptimisticSend).not.toHaveBeenCalled()
    expect(mocks.createClaudeModelSwitchConfirmationObserver).toHaveBeenCalledWith({
      ptyId: 'pty-1',
      settings: {},
      expectedModelLabel: 'Opus'
    })
    expect(onSwitchToTerminal).not.toHaveBeenCalled()
  })

  it('keeps a successful Claude model change after a conversation in native chat', async () => {
    mocks.sendHandle.settleAfterMs = 0
    const onSwitchToTerminal = vi.fn()
    render(
      <NativeChatComposer
        terminalTabId="tab-1"
        paneKey="tab-1:leaf-1"
        targetPtyId="pty-1"
        agent="claude"
        onSwitchToTerminal={onSwitchToTerminal}
      />
    )

    await act(async () => {
      await mocks.fieldProps?.sessionOptionsSurface?.setOption('model', 'fable')
    })

    expect(mocks.sendNativeChatMessageVerified).toHaveBeenCalledWith(
      {},
      'pty-1',
      '/model fable',
      expect.any(AbortSignal)
    )
    expect(mocks.createClaudeModelSwitchConfirmationObserver).toHaveBeenCalledWith({
      ptyId: 'pty-1',
      settings: {},
      expectedModelLabel: 'Fable'
    })
    expect(mocks.confirmationObserver?.arm).toHaveBeenCalledOnce()
    expect(mocks.confirmationObserver?.arm.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendNativeChatMessageVerified.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    )
    expect(mocks.confirmationObserver?.startDetection).toHaveBeenCalledOnce()
    expect(mocks.confirmationObserver?.startDetection.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.sendNativeChatMessageVerified.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY
    )
    expect(mocks.confirmationObserver?.dispose).toHaveBeenCalledOnce()
    expect(onSwitchToTerminal).not.toHaveBeenCalled()
  })

  it('types the Codex picker command and switches to the terminal', async () => {
    mocks.sendHandle.settleAfterMs = 0
    const onSwitchToTerminal = vi.fn()
    render(
      <NativeChatComposer
        terminalTabId="tab-1"
        paneKey="tab-1:leaf-1"
        targetPtyId="pty-1"
        agent="codex"
        onSwitchToTerminal={onSwitchToTerminal}
      />
    )

    await act(async () => {
      await mocks.fieldProps?.sessionOptionsSurface?.invokeAction('model')
    })

    expect(mocks.typeNativeChatCommand).toHaveBeenCalledWith(
      {},
      'pty-1',
      '/model',
      expect.any(AbortSignal)
    )
    expect(mocks.sendNativeChatMessageVerified).not.toHaveBeenCalled()
    expect(onSwitchToTerminal).toHaveBeenCalledOnce()
  })
})
