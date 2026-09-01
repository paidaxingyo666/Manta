import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeWebRuntimeTerminal,
  consumePendingWebRuntimeSplitMirrorTelemetry,
  isWebRuntimeSessionActive,
  splitWebRuntimeTerminal
} from './web-runtime-session'
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

describe('splitWebRuntimeTerminal', () => {
  beforeEach(() => {
    vi.stubGlobal('__MANTA_WEB_CLIENT__', true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('passes telemetry source to the host split while allowing the mirrored split event to be suppressed', async () => {
    const runtimeCall = vi.fn().mockResolvedValue({
      id: 'split',
      ok: true,
      result: {
        split: {
          handle: 'terminal-2',
          tabId: 'tab-1',
          paneRuntimeId: -1
        }
      }
    })
    vi.stubGlobal('window', {
      api: {
        runtimeEnvironments: {
          call: runtimeCall
        }
      }
    })

    expect(
      splitWebRuntimeTerminal(
        'remote:web-env-1@@terminal-1',
        'horizontal',
        'keyboard',
        SPLIT_SOURCE
      )
    ).toBe(true)
    expect(
      consumePendingWebRuntimeSplitMirrorTelemetry('remote:web-env-1@@terminal-other', 'horizontal')
    ).toBe(false)
    expect(
      consumePendingWebRuntimeSplitMirrorTelemetry('remote:web-env-1@@terminal-1', 'horizontal')
    ).toBe(true)

    await vi.waitFor(() => expect(runtimeCall).toHaveBeenCalledTimes(1))
    expect(runtimeCall).toHaveBeenCalledWith({
      selector: 'web-env-1',
      expectedEnvironmentPairingRevision: undefined,
      method: 'terminal.split',
      params: {
        terminal: 'terminal-1',
        direction: 'horizontal',
        telemetrySource: 'keyboard'
      },
      timeoutMs: 15_000
    })
  })

  it('does not track rejected host split RPCs', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runtimeCall = vi.fn().mockResolvedValue({
      id: 'split',
      ok: false,
      error: { code: 'terminal_exited', message: 'Terminal exited' }
    })
    vi.stubGlobal('window', {
      api: {
        runtimeEnvironments: {
          call: runtimeCall
        }
      }
    })

    expect(
      splitWebRuntimeTerminal(
        'remote:web-env-1@@terminal-1',
        'vertical',
        'context_menu',
        SPLIT_SOURCE
      )
    ).toBe(true)

    await vi.waitFor(() => expect(runtimeCall).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1))
    expect(mocks.trackTerminalPaneSplit).not.toHaveBeenCalled()
  })

  it('ignores local panes but delegates remote runtime panes from desktop or web clients', async () => {
    const runtimeCall = vi.fn().mockResolvedValue({
      id: 'split',
      ok: true,
      result: {
        split: {
          handle: 'terminal-2',
          tabId: 'tab-1',
          ptyId: 'pty-2'
        }
      }
    })
    vi.stubGlobal('window', {
      api: {
        runtimeEnvironments: {
          call: runtimeCall
        }
      }
    })

    expect(splitWebRuntimeTerminal('pty-local-1', 'horizontal', 'keyboard', SPLIT_SOURCE)).toBe(
      false
    )
    vi.stubGlobal('__MANTA_WEB_CLIENT__', false)
    expect(
      splitWebRuntimeTerminal(
        'remote:web-env-1@@terminal-1',
        'horizontal',
        'keyboard',
        SPLIT_SOURCE
      )
    ).toBe(true)

    await vi.waitFor(() => expect(runtimeCall).toHaveBeenCalledTimes(1))
  })

  it('records the exact host-created leaf before replaying the mirrored layout', async () => {
    stubSplitSourceTab(mocks.getState, 'tab-1')
    replaceRuntimeEnvironmentRevisions([{ id: 'web-env-1', createdAt: 7 }])
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
      splitWebRuntimeTerminal('remote:web-env-1@@terminal-1', 'vertical', 'keyboard', SPLIT_SOURCE)
    ).toBe(true)

    await vi.waitFor(() =>
      expect(
        peekWebSessionFocusIntent(
          { environmentId: 'web-env-1', pairingRevision: 7 },
          SPLIT_WORKTREE_ID
        )
      ).toEqual({
        hostTabId: 'tab-1',
        leafId: 'leaf-2',
        expectedCurrentLocalTabId: toWebTerminalSurfaceTabId('tab-1')
      })
    )
    expect(mocks.acceptReplayedWebSessionTabsSnapshot).toHaveBeenCalledWith(
      'web-env-1',
      SPLIT_WORKTREE_ID
    )
    expect(mocks.activateTabAndFocusPane).toHaveBeenCalledWith(
      toWebTerminalSurfaceTabId('tab-1'),
      'leaf-2'
    )
    expect(runtimeCall).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'terminal.split',
        expectedEnvironmentPairingRevision: 7
      })
    )
  })

  it('uses the gesture pane when a stale layout also records the source PTY', async () => {
    const staleTabId = toWebTerminalSurfaceTabId('tab-stale')
    const sourceTabId = toWebTerminalSurfaceTabId('tab-source')
    const tabs = [
      {
        id: staleTabId,
        worktreeId: SPLIT_WORKTREE_ID,
        contentType: 'terminal',
        ptyId: 'remote:web-env-1@@terminal-1'
      },
      {
        id: sourceTabId,
        worktreeId: SPLIT_WORKTREE_ID,
        contentType: 'terminal',
        ptyId: 'remote:web-env-1@@terminal-1'
      }
    ]
    mocks.getState.mockReturnValue({
      ...makeSplitSourceState('tab-source', 'leaf-source'),
      tabsByWorktree: { [SPLIT_WORKTREE_ID]: tabs },
      unifiedTabsByWorktree: { [SPLIT_WORKTREE_ID]: tabs },
      ptyIdsByTabId: { [sourceTabId]: ['remote:web-env-1@@terminal-1'] },
      terminalLayoutsByTabId: {
        [staleTabId]: {
          activeLeafId: 'leaf-stale',
          ptyIdsByLeafId: { 'leaf-stale': 'remote:web-env-1@@terminal-1' }
        },
        [sourceTabId]: {
          activeLeafId: 'leaf-source',
          ptyIdsByLeafId: { 'leaf-source': 'remote:web-env-1@@terminal-1' }
        }
      }
    })
    const runtimeCall = vi.fn((request: { method: string }) =>
      Promise.resolve(
        request.method === 'terminal.split'
          ? {
              id: 'split',
              ok: true,
              result: {
                split: {
                  handle: 'terminal-2',
                  tabId: 'tab-source',
                  paneRuntimeId: -1,
                  leafId: 'leaf-created'
                }
              }
            }
          : makeHostTabsListResponse()
      )
    )
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })

    expect(
      splitWebRuntimeTerminal('remote:web-env-1@@terminal-1', 'vertical', 'keyboard', {
        worktreeId: SPLIT_WORKTREE_ID,
        tabId: sourceTabId,
        leafId: 'leaf-source'
      })
    ).toBe(true)

    await vi.waitFor(() =>
      expect(mocks.activateTabAndFocusPane).toHaveBeenCalledWith(sourceTabId, 'leaf-created')
    )
  })
})

describe('closeWebRuntimeTerminal', () => {
  beforeEach(() => {
    vi.stubGlobal('__MANTA_WEB_CLIENT__', true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('delegates remote pane close to the host runtime', async () => {
    const runtimeCall = vi.fn().mockResolvedValue({
      id: 'close',
      ok: true,
      result: {
        close: {
          handle: 'terminal-1',
          tabId: 'tab-1',
          ptyKilled: true
        }
      }
    })
    vi.stubGlobal('window', {
      api: {
        runtimeEnvironments: {
          call: runtimeCall
        }
      }
    })

    expect(closeWebRuntimeTerminal('remote:web-env-1@@terminal-1')).toBe(true)

    await vi.waitFor(() => expect(runtimeCall).toHaveBeenCalledTimes(1))
    expect(runtimeCall).toHaveBeenCalledWith({
      selector: 'web-env-1',
      method: 'terminal.close',
      params: {
        terminal: 'terminal-1'
      },
      timeoutMs: 15_000
    })
  })

  it('ignores local panes but delegates remote runtime panes from desktop or web clients', async () => {
    const runtimeCall = vi.fn().mockResolvedValue({
      id: 'close',
      ok: true,
      result: {
        close: {
          handle: 'terminal-1',
          tabId: 'tab-1',
          ptyKilled: true
        }
      }
    })
    vi.stubGlobal('window', {
      api: {
        runtimeEnvironments: {
          call: runtimeCall
        }
      }
    })

    expect(closeWebRuntimeTerminal('pty-local-1')).toBe(false)
    vi.stubGlobal('__MANTA_WEB_CLIENT__', false)
    expect(closeWebRuntimeTerminal('remote:web-env-1@@terminal-1')).toBe(true)

    await vi.waitFor(() => expect(runtimeCall).toHaveBeenCalledTimes(1))
  })
  it('treats any configured remote runtime environment as a shared session', () => {
    vi.stubGlobal('__MANTA_WEB_CLIENT__', false)

    expect(isWebRuntimeSessionActive('env-1')).toBe(true)
    expect(isWebRuntimeSessionActive('   ')).toBe(false)
    expect(isWebRuntimeSessionActive(null)).toBe(false)
  })
})
