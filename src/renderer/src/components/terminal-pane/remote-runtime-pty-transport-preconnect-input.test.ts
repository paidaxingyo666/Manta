import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as TerminalInput from '../../../../shared/terminal-input'
import {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
  decodeTerminalStreamText
} from '../../../../shared/terminal-stream-protocol'
import type { IpcPtyTransportOptions, PtyTransport } from './pty-transport-types'
import {
  createRemoteRuntimeTransportMocks,
  readyHostSessionInventoryResponse,
  type MultiplexSubscriptionCallbacks
} from './remote-runtime-pty-transport-test-harness'

let subscriptionCallbacks: MultiplexSubscriptionCallbacks = null
let resolvedPaneHandle = 'terminal-1'
let transport: PtyTransport | undefined
const {
  runtimeCall,
  subscriptionSendBinary,
  latestSubscribePayload,
  emitSnapshot,
  resetRemoteRuntimeTransport
} = createRemoteRuntimeTransportMocks({
  getCallbacks: () => subscriptionCallbacks,
  setCallbacks: (callbacks) => {
    subscriptionCallbacks = callbacks
  },
  getResolvedPaneHandle: () => resolvedPaneHandle,
  setResolvedPaneHandle: (handle) => {
    resolvedPaneHandle = handle
  }
})

function sentInput(): string {
  return subscriptionSendBinary.mock.calls
    .map(([bytes]) => decodeTerminalStreamFrame(bytes))
    .filter((frame) => frame?.opcode === TerminalStreamOpcode.Input)
    .map((frame) => (frame ? decodeTerminalStreamText(frame.payload) : ''))
    .join('')
}

async function createTransport(options: IpcPtyTransportOptions = {}): Promise<PtyTransport> {
  const { createRemoteRuntimePtyTransport } = await import('./remote-runtime-pty-transport')
  transport = createRemoteRuntimePtyTransport('env-1', {
    worktreeId: 'wt-1',
    tabId: 'tab-1',
    leafId: 'pane:1',
    bufferInputUntilConnect: true,
    preconnectPtyId: 'remote:env-1@@terminal-1',
    ...options
  })
  return transport
}

function subscribeCount(): number {
  return subscriptionSendBinary.mock.calls.filter(
    ([bytes]) => decodeTerminalStreamFrame(bytes)?.opcode === TerminalStreamOpcode.Subscribe
  ).length
}

async function finishSubscribe(previousSubscribeCount = 0): Promise<void> {
  await vi.waitFor(() => {
    expect(latestSubscribePayload().terminal).toBe(resolvedPaneHandle)
    expect(subscribeCount()).toBeGreaterThan(previousSubscribeCount)
  })
  emitSnapshot(latestSubscribePayload().streamId, 'READY:80x24')
  await vi.waitFor(() => expect(transport?.getRecoveryState?.().phase).toBe('connected'))
}

describe('remote terminal preconnect input', () => {
  beforeEach(resetRemoteRuntimeTransport)
  afterEach(() => {
    transport?.destroy?.()
    transport = undefined
    vi.doUnmock('../../../../shared/terminal-input')
  })

  it('keeps the complete line typed before a parked terminal attaches', async () => {
    const terminal = await createTransport()
    expect(terminal.sendInput('before-')).toBe(true)
    terminal.attach({ existingPtyId: 'remote:env-1@@terminal-1', callbacks: {} })
    expect(terminal.sendInput('attach\r')).toBe(true)
    await vi.waitFor(() => expect(subscriptionSendBinary).toHaveBeenCalled())
    expect(sentInput()).toBe('')
    expect(runtimeCall).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'terminal.send' })
    )
    await finishSubscribe()
    await vi.waitFor(() => expect(sentInput()).toBe('before-attach\r'))
  })

  it('retains immediate input while a paired web pane resolves its host session', async () => {
    const originalCall = runtimeCall.getMockImplementation()
    runtimeCall.mockImplementation(async (request: { method: string }) => {
      if (request.method === 'session.tabs.list' || request.method === 'session.tabs.activate') {
        return readyHostSessionInventoryResponse('terminal-1')
      }
      return originalCall?.(request)
    })
    const terminal = await createTransport({ tabId: 'web-terminal-host-tab-1' })
    const connecting = terminal.connect({
      url: '',
      sessionId: 'remote:env-1@@terminal-1',
      callbacks: {}
    })
    expect(terminal.sendInput('restored-web-pane\r')).toBe(true)
    await finishSubscribe()
    await connecting
    await vi.waitFor(() => expect(sentInput()).toBe('restored-web-pane\r'))
  })

  it.each(['detach', 'disconnect', 'destroy', 'abandonPreconnectInput'] as const)(
    'discards retained input when the pane calls %s before attach completes',
    async (action) => {
      const terminal = await createTransport()
      expect(terminal.sendInput('stale\r')).toBe(true)
      const accepted = terminal.sendInputAccepted?.('\x03')
      terminal.attach({ existingPtyId: 'remote:env-1@@terminal-1', callbacks: {} })
      await vi.waitFor(() => expect(subscriptionSendBinary).toHaveBeenCalled())
      terminal[action]?.()
      await expect(accepted).resolves.toBe(false)
      emitSnapshot(latestSubscribePayload().streamId, 'READY:80x24')
      expect(sentInput()).toBe('')
      expect(runtimeCall).not.toHaveBeenCalledWith(
        expect.objectContaining({ method: 'terminal.send' })
      )
    }
  )

  it('never replays a cached command into a replacement handle', async () => {
    const terminal = await createTransport()
    expect(terminal.sendInput('old-command\r')).toBe(true)
    resolvedPaneHandle = 'terminal-replacement'
    terminal.attach({ existingPtyId: 'remote:env-1@@terminal-1', callbacks: {} })
    await finishSubscribe()
    expect(sentInput()).toBe('')
    expect(terminal.sendInput('new-command\r')).toBe(true)
    await vi.waitFor(() => expect(sentInput()).toBe('new-command\r'))
  })

  it('discards input when the persisted target belongs to another environment', async () => {
    const terminal = await createTransport()
    expect(terminal.sendInput('foreign-host\r')).toBe(true)
    terminal.attach({ existingPtyId: 'remote:other-env@@terminal-1', callbacks: {} })
    await finishSubscribe()
    expect(sentInput()).toBe('')
  })

  it('does not replay input after the environment is paired again under the same id', async () => {
    const { replaceRuntimeEnvironmentRevisions } =
      await import('@/runtime/runtime-environment-revision')
    replaceRuntimeEnvironmentRevisions([{ id: 'env-1', createdAt: 1 }])
    const terminal = await createTransport()
    expect(terminal.sendInput('old-pairing\r')).toBe(true)
    terminal.attach({ existingPtyId: 'remote:env-1@@terminal-1', callbacks: {} })
    await vi.waitFor(() => expect(subscriptionSendBinary).toHaveBeenCalled())
    replaceRuntimeEnvironmentRevisions([{ id: 'env-1', createdAt: 2 }])
    emitSnapshot(latestSubscribePayload().streamId, 'READY:80x24')
    await vi.waitFor(() => expect(terminal.getRecoveryState?.().phase).toBe('recovering'))
    expect(sentInput()).toBe('')
  })

  it('preserves normal input and acknowledged interrupts in their original order', async () => {
    const originalCall = runtimeCall.getMockImplementation()
    runtimeCall.mockImplementation(async (request: { method: string }) => {
      if (request.method === 'terminal.send') {
        expect(sentInput()).toBe('before-interrupt')
        return { ok: true, result: { send: { accepted: true } } }
      }
      return originalCall?.(request)
    })
    const terminal = await createTransport()
    expect(terminal.sendInput('before-interrupt')).toBe(true)
    const accepted = terminal.sendInputAccepted?.('\x03')
    expect(terminal.sendInput('after-interrupt\r')).toBe(true)
    terminal.attach({ existingPtyId: 'remote:env-1@@terminal-1', callbacks: {} })
    await finishSubscribe()
    await expect(accepted).resolves.toBe(true)
    await vi.waitFor(() => expect(sentInput()).toBe('before-interruptafter-interrupt\r'))
    expect(runtimeCall).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: 'env-1',
        method: 'terminal.send',
        params: expect.objectContaining({ terminal: 'terminal-1', text: '\x03' })
      })
    )
  })

  it('discards the first attach queue when a second attach supersedes it', async () => {
    const terminal = await createTransport()
    expect(terminal.sendInput('first-attach\r')).toBe(true)
    terminal.attach({ existingPtyId: 'remote:env-1@@terminal-1', callbacks: {} })
    await vi.waitFor(() => expect(subscriptionSendBinary).toHaveBeenCalled())
    resolvedPaneHandle = 'terminal-2'
    terminal.attach({ existingPtyId: 'remote:env-1@@terminal-2', callbacks: {} })
    await finishSubscribe()
    expect(sentInput()).toBe('')
  })

  it.each(['abandon', 'reattach', 'destroy'] as const)(
    'cancels an acknowledged flush that is measuring its input before %s',
    async (action) => {
      let finishMeasurement: ((tooLarge: boolean) => void) | undefined
      const measuring = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finishMeasurement = resolve
          })
      )
      vi.doMock('../../../../shared/terminal-input', async (importOriginal) => {
        const original = await importOriginal<typeof TerminalInput>()
        return { ...original, isTerminalInputTooLargeWithDeferredMeasurement: measuring }
      })
      const terminal = await createTransport()
      const accepted = terminal.sendInputAccepted?.('\x03')
      terminal.attach({ existingPtyId: 'remote:env-1@@terminal-1', callbacks: {} })
      await finishSubscribe()
      await vi.waitFor(() => expect(measuring).toHaveBeenCalledOnce())
      if (action === 'abandon') {
        terminal.abandonPreconnectInput?.()
      } else if (action === 'reattach') {
        const previousSubscribeCount = subscribeCount()
        terminal.attach({ existingPtyId: 'remote:env-1@@terminal-1', callbacks: {} })
        await finishSubscribe(previousSubscribeCount)
      } else {
        terminal.destroy?.()
      }
      await expect(accepted).resolves.toBe(false)
      finishMeasurement?.(false)
      await vi.waitFor(() => expect(measuring.mock.results[0]?.value).resolves.toBe(false))
      expect(runtimeCall).not.toHaveBeenCalledWith(
        expect.objectContaining({ method: 'terminal.send' })
      )
      expect(sentInput()).toBe('')
    }
  )
})
