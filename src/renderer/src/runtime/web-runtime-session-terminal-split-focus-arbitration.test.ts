import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { splitWebRuntimeTerminal } from './web-runtime-session'
import { resetWebSessionCloseIntentForTests } from './web-session-close-intent'
import {
  peekWebSessionFocusIntent,
  resetWebSessionFocusIntentForTests
} from './web-session-focus-intent'
import { toWebTerminalSurfaceTabId } from '../../../shared/terminal-surface-id'
import { replaceRuntimeEnvironmentRevisions } from './runtime-environment-revision'
import {
  SPLIT_SOURCE,
  SPLIT_WORKTREE_ID,
  makeHostTabsListResponse,
  makeSplitResult,
  makeSplitSourceState,
  stubSplitSourceTab
} from './web-runtime-terminal-split-fixtures'

const mocks = vi.hoisted(() => ({
  activateTabAndFocusPane: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn(),
  subscribe: vi.fn(),
  setActiveWorktree: vi.fn(),
  createBrowserTab: vi.fn(),
  closeEmptyGroup: vi.fn(),
  moveUnifiedTabToGroup: vi.fn(),
  setRemoteBrowserPageHandle: vi.fn(),
  focusBrowserTabInWorktree: vi.fn(),
  applyWebSessionTabsSnapshot: vi.fn(),
  decideWebSessionTabsSnapshot: vi.fn(() => ({ apply: true, settlesHostMirror: true })),
  getWebSessionTabsTrackingGeneration: vi.fn(() => 0),
  acceptReplayedWebSessionTabsSnapshot: vi.fn(),
  resolveHostSessionTabIdForWebSessionTab: vi.fn(),
  trackTerminalPaneSplit: vi.fn(),
  deliverLaunchPromptToAgentTab: vi.fn(),
  seedNativeChatLaunchDraftForAgentTab: vi.fn(),
  getRuntimeEnvironmentIdForWorktree: vi.fn(),
  hasMaterializedWebRuntimeBrowserPage: vi.fn()
}))

vi.mock('../store', () => ({
  useAppStore: {
    getState: mocks.getState,
    setState: mocks.setState,
    subscribe: mocks.subscribe
  }
}))

vi.mock('../lib/activate-tab-and-focus-pane', () => ({
  activateTabAndFocusPane: mocks.activateTabAndFocusPane
}))

vi.mock('./web-session-tabs-sync', () => ({
  acceptReplayedWebSessionTabsSnapshot: mocks.acceptReplayedWebSessionTabsSnapshot,
  applyWebSessionTabsSnapshot: mocks.applyWebSessionTabsSnapshot,
  decideWebSessionTabsSnapshot: mocks.decideWebSessionTabsSnapshot,
  getWebSessionTabsTrackingGeneration: mocks.getWebSessionTabsTrackingGeneration,
  applyWebSessionTabsStorePatch: (buildPatch: (state: unknown) => unknown) => {
    mocks.setState(buildPatch)
    // The production caller invokes the returned settle receipt.
    return () => {}
  },
  resolveHostSessionTabIdForWebSessionTab: mocks.resolveHostSessionTabIdForWebSessionTab
}))

vi.mock('@/lib/feature-education-telemetry', () => ({
  trackTerminalPaneSplit: mocks.trackTerminalPaneSplit
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: mocks.getRuntimeEnvironmentIdForWorktree
}))

vi.mock('@/lib/agent-launch-prompt-delivery', () => ({
  deliverLaunchPromptToAgentTab: mocks.deliverLaunchPromptToAgentTab,
  seedNativeChatLaunchDraftForAgentTab: mocks.seedNativeChatLaunchDraftForAgentTab
}))

vi.mock('./web-runtime-browser-materialization', () => ({
  hasMaterializedWebRuntimeBrowserPage: mocks.hasMaterializedWebRuntimeBrowserPage
}))

afterEach(() => {
  resetWebSessionCloseIntentForTests()
  resetWebSessionFocusIntentForTests()
  replaceRuntimeEnvironmentRevisions([])
})

describe('splitWebRuntimeTerminal focus arbitration', () => {
  beforeEach(() => {
    vi.stubGlobal('__MANTA_WEB_CLIENT__', true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('keeps the latest split focus intent when responses complete out of order', async () => {
    stubSplitSourceTab(mocks.getState, 'tab-1')
    const splitResolvers: ((response: unknown) => void)[] = []
    let resolveList!: (response: unknown) => void
    const runtimeCall = vi.fn((request: { method: string }) => {
      if (request.method === 'terminal.split') {
        return new Promise((resolve) => splitResolvers.push(resolve))
      }
      return new Promise((resolve) => {
        resolveList = resolve
      })
    })
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })
    const source = {
      worktreeId: SPLIT_WORKTREE_ID,
      tabId: toWebTerminalSurfaceTabId('tab-1'),
      leafId: 'leaf-1'
    }

    expect(
      splitWebRuntimeTerminal('remote:web-env-1@@terminal-1', 'vertical', 'keyboard', source)
    ).toBe(true)
    expect(
      splitWebRuntimeTerminal('remote:web-env-1@@terminal-1', 'vertical', 'keyboard', source)
    ).toBe(true)
    await vi.waitFor(() => expect(splitResolvers).toHaveLength(2))

    splitResolvers[1]?.(makeSplitResult('leaf-b'))
    await vi.waitFor(() =>
      expect(
        peekWebSessionFocusIntent({ environmentId: 'web-env-1' }, SPLIT_WORKTREE_ID)
      ).toMatchObject({ hostTabId: 'tab-1', leafId: 'leaf-b' })
    )

    splitResolvers[0]?.(makeSplitResult('leaf-a'))
    await Promise.resolve()
    await Promise.resolve()
    const intentAfterOlderCompletion = peekWebSessionFocusIntent(
      { environmentId: 'web-env-1' },
      SPLIT_WORKTREE_ID
    )

    resolveList(makeHostTabsListResponse())
    expect(intentAfterOlderCompletion).toMatchObject({ hostTabId: 'tab-1', leafId: 'leaf-b' })
    await vi.waitFor(() =>
      expect(mocks.activateTabAndFocusPane).toHaveBeenCalledWith(
        toWebTerminalSurfaceTabId('tab-1'),
        'leaf-b'
      )
    )
    expect(mocks.activateTabAndFocusPane).not.toHaveBeenCalledWith(
      toWebTerminalSurfaceTabId('tab-1'),
      'leaf-a'
    )
  })

  it('lets a newer split with an unreconciled source supersede older focus', async () => {
    stubSplitSourceTab(mocks.getState, 'tab-1')
    const splitResolvers: ((response: unknown) => void)[] = []
    const runtimeCall = vi.fn(() => new Promise((resolve) => splitResolvers.push(resolve)))
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })
    const split = (): boolean =>
      splitWebRuntimeTerminal('remote:web-env-1@@terminal-1', 'vertical', 'keyboard', SPLIT_SOURCE)
    expect(split()).toBe(true)
    await vi.waitFor(() => expect(splitResolvers).toHaveLength(1))
    const staleSource = {
      worktreeId: SPLIT_WORKTREE_ID,
      tabId: toWebTerminalSurfaceTabId('tab-missing'),
      leafId: 'leaf-missing'
    }
    expect(
      splitWebRuntimeTerminal(
        'remote:web-env-1@@terminal-missing',
        'vertical',
        'keyboard',
        staleSource
      )
    ).toBe(true)
    await vi.waitFor(() => expect(splitResolvers).toHaveLength(2))
    splitResolvers[0]?.(makeSplitResult('leaf-a'))
    await vi.waitFor(() =>
      expect(
        peekWebSessionFocusIntent({ environmentId: 'web-env-1' }, SPLIT_WORKTREE_ID)
      ).toBeNull()
    )
    expect(mocks.activateTabAndFocusPane).not.toHaveBeenCalled()
    splitResolvers[1]?.(makeSplitResult('leaf-b'))
  })

  it('does not let an older snapshot completion clear or focus over a newer split', async () => {
    stubSplitSourceTab(mocks.getState, 'tab-1')
    const splitResolvers: ((response: unknown) => void)[] = []
    let resolveList!: (response: unknown) => void
    const runtimeCall = vi.fn((request: { method: string }) => {
      if (request.method === 'terminal.split') {
        return new Promise((resolve) => splitResolvers.push(resolve))
      }
      return new Promise((resolve) => {
        resolveList = resolve
      })
    })
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })

    expect(
      splitWebRuntimeTerminal('remote:web-env-1@@terminal-1', 'vertical', 'keyboard', SPLIT_SOURCE)
    ).toBe(true)
    await vi.waitFor(() => expect(splitResolvers).toHaveLength(1))
    splitResolvers[0]?.({
      id: 'split-a',
      ok: true,
      result: {
        split: { handle: 'terminal-a', tabId: 'tab-1', paneRuntimeId: -1, leafId: 'leaf-a' }
      }
    })
    await vi.waitFor(() =>
      expect(
        peekWebSessionFocusIntent({ environmentId: 'web-env-1' }, SPLIT_WORKTREE_ID)
      ).toMatchObject({ leafId: 'leaf-a' })
    )

    expect(
      splitWebRuntimeTerminal('remote:web-env-1@@terminal-1', 'vertical', 'keyboard', SPLIT_SOURCE)
    ).toBe(true)
    await vi.waitFor(() => expect(splitResolvers).toHaveLength(2))
    splitResolvers[1]?.({
      id: 'split-b',
      ok: true,
      result: {
        split: { handle: 'terminal-b', tabId: 'tab-1', paneRuntimeId: -1, leafId: 'leaf-b' }
      }
    })
    await vi.waitFor(() =>
      expect(
        peekWebSessionFocusIntent({ environmentId: 'web-env-1' }, SPLIT_WORKTREE_ID)
      ).toMatchObject({ leafId: 'leaf-b' })
    )

    resolveList(makeHostTabsListResponse())
    await vi.waitFor(() =>
      expect(mocks.activateTabAndFocusPane).toHaveBeenCalledWith(
        toWebTerminalSurfaceTabId('tab-1'),
        'leaf-b'
      )
    )
    expect(mocks.activateTabAndFocusPane).not.toHaveBeenCalledWith(
      toWebTerminalSurfaceTabId('tab-1'),
      'leaf-a'
    )
  })

  it('does not claim focus from an old host that omits the leaf identity', async () => {
    stubSplitSourceTab(mocks.getState, 'tab-1')
    const runtimeCall = vi.fn().mockResolvedValue({
      id: 'split',
      ok: true,
      result: {
        split: { handle: 'terminal-2', tabId: 'tab-1', paneRuntimeId: -1 }
      }
    })
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })

    expect(
      splitWebRuntimeTerminal('remote:web-env-1@@terminal-1', 'vertical', 'keyboard', SPLIT_SOURCE)
    ).toBe(true)

    await vi.waitFor(() => expect(runtimeCall).toHaveBeenCalledOnce())
    expect(peekWebSessionFocusIntent({ environmentId: 'web-env-1' }, SPLIT_WORKTREE_ID)).toBeNull()
    expect(mocks.acceptReplayedWebSessionTabsSnapshot).not.toHaveBeenCalled()
  })

  it('focuses a split invoked from a non-focused group tab when the viewer stays put', async () => {
    mocks.getState.mockReturnValue(makeSplitSourceState('tab-1', 'leaf-1', 'tab-2'))
    const runtimeCall = vi.fn((request: { method: string }) =>
      Promise.resolve(
        request.method === 'terminal.split'
          ? {
              id: 'split',
              ok: true,
              result: {
                split: {
                  handle: 'terminal-2',
                  tabId: 'tab-1',
                  paneRuntimeId: -1,
                  leafId: 'leaf-2'
                }
              }
            }
          : makeHostTabsListResponse()
      )
    )
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })

    expect(
      splitWebRuntimeTerminal(
        'remote:web-env-1@@terminal-1',
        'vertical',
        'context_menu',
        SPLIT_SOURCE
      )
    ).toBe(true)

    await vi.waitFor(() =>
      expect(mocks.activateTabAndFocusPane).toHaveBeenCalledWith(
        toWebTerminalSurfaceTabId('tab-1'),
        'leaf-2'
      )
    )
    expect(
      peekWebSessionFocusIntent({ environmentId: 'web-env-1' }, SPLIT_WORKTREE_ID)
    ).toMatchObject({
      hostTabId: 'tab-1',
      leafId: 'leaf-2',
      expectedCurrentLocalTabId: toWebTerminalSurfaceTabId('tab-2')
    })
  })

  it('does not steal focus after the viewer switches tabs while the host splits', async () => {
    stubSplitSourceTab(mocks.getState, 'tab-1')
    let resolveSplit!: (response: unknown) => void
    const runtimeCall = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSplit = resolve
        })
    )
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })

    expect(
      splitWebRuntimeTerminal('remote:web-env-1@@terminal-1', 'vertical', 'keyboard', SPLIT_SOURCE)
    ).toBe(true)
    await vi.waitFor(() => expect(runtimeCall).toHaveBeenCalledOnce())
    mocks.getState.mockReturnValue(makeSplitSourceState('tab-2'))
    resolveSplit({
      id: 'split',
      ok: true,
      result: {
        split: {
          handle: 'terminal-2',
          tabId: 'tab-1',
          paneRuntimeId: -1,
          leafId: 'leaf-2'
        }
      }
    })

    await vi.waitFor(() => expect(runtimeCall).toHaveBeenCalledOnce())
    expect(peekWebSessionFocusIntent({ environmentId: 'web-env-1' }, SPLIT_WORKTREE_ID)).toBeNull()
    expect(mocks.acceptReplayedWebSessionTabsSnapshot).not.toHaveBeenCalled()
    expect(mocks.activateTabAndFocusPane).not.toHaveBeenCalled()
  })

  it('drops a completed split intent after the environment re-pairs', async () => {
    stubSplitSourceTab(mocks.getState, 'tab-1')
    replaceRuntimeEnvironmentRevisions([{ id: 'web-env-1', createdAt: 7 }])
    let resolveSplit!: (response: unknown) => void
    const runtimeCall = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSplit = resolve
        })
    )
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })

    expect(
      splitWebRuntimeTerminal('remote:web-env-1@@terminal-1', 'vertical', 'keyboard', SPLIT_SOURCE)
    ).toBe(true)
    await vi.waitFor(() => expect(runtimeCall).toHaveBeenCalledOnce())
    replaceRuntimeEnvironmentRevisions([{ id: 'web-env-1', createdAt: 9 }])
    resolveSplit({
      id: 'split',
      ok: true,
      result: {
        split: {
          handle: 'terminal-2',
          tabId: 'tab-1',
          paneRuntimeId: -1,
          leafId: 'leaf-2'
        }
      }
    })

    await vi.waitFor(() => expect(runtimeCall).toHaveBeenCalledOnce())
    expect(
      peekWebSessionFocusIntent(
        { environmentId: 'web-env-1', pairingRevision: 9 },
        SPLIT_WORKTREE_ID
      )
    ).toBeNull()
    expect(mocks.acceptReplayedWebSessionTabsSnapshot).not.toHaveBeenCalled()
  })

  it('drops local focus when the environment re-pairs during snapshot replay', async () => {
    stubSplitSourceTab(mocks.getState, 'tab-1')
    replaceRuntimeEnvironmentRevisions([{ id: 'web-env-1', createdAt: 7 }])
    let resolveList!: (response: unknown) => void
    const runtimeCall = vi.fn((request: { method: string }) =>
      request.method === 'terminal.split'
        ? Promise.resolve({
            id: 'split',
            ok: true,
            result: {
              split: {
                handle: 'terminal-2',
                tabId: 'tab-1',
                paneRuntimeId: -1,
                leafId: 'leaf-2'
              }
            }
          })
        : new Promise((resolve) => {
            resolveList = resolve
          })
    )
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })

    expect(
      splitWebRuntimeTerminal('remote:web-env-1@@terminal-1', 'vertical', 'keyboard', SPLIT_SOURCE)
    ).toBe(true)
    await vi.waitFor(() => expect(runtimeCall).toHaveBeenCalledTimes(2))
    replaceRuntimeEnvironmentRevisions([{ id: 'web-env-1', createdAt: 9 }])
    resolveList(makeHostTabsListResponse())

    await vi.waitFor(() =>
      expect(
        peekWebSessionFocusIntent(
          { environmentId: 'web-env-1', pairingRevision: 7 },
          SPLIT_WORKTREE_ID
        )
      ).toBeNull()
    )
    expect(mocks.activateTabAndFocusPane).not.toHaveBeenCalled()
  })
})
