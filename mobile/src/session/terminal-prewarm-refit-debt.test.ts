import { createElement, useRef, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { TerminalWebViewHandle } from '../terminal/terminal-webview-contract'

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  Platform: { OS: 'android' },
  StyleSheet: {
    create: <T>(styles: T) => styles,
    absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    hairlineWidth: 1
  },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  View: 'View'
}))

import { useTerminalViewportRefit } from '../terminal/terminal-viewport-refit'
import { MOBILE_SESSION_TAB_BAR_HEIGHT } from './mobile-session-frame-styles'

const CONTENT_ROW_HEIGHT = 700
const CELL_HEIGHT = 17
const HANDLE = 'term-1'
const REFIT_DEBOUNCE_MS = 150

// Stands in for the WebView's fit: the taller the box it is handed, the more rows it reports.
// This is what turns a frame that is one tab bar too tall into a row count the host never had.
function fitDimensions(containerHeight: number): { cols: number; rows: number } {
  return { cols: 100, rows: Math.floor(containerHeight / CELL_HEIGHT) }
}

type ColdOpenResult = {
  updateViewportCalls: number
  resubscribes: number
  latchedRows: number
}

// Replays a single-terminal cold open: the pre-warm measured `prewarmFrameHeight` and latched it,
// the first pane subscribed with those dims, and only then does the real frame report its layout.
async function runSingleTerminalColdOpen(prewarmFrameHeight: number): Promise<ColdOpenResult> {
  const firstPaneFrameHeight = CONTENT_ROW_HEIGHT - MOBILE_SESSION_TAB_BAR_HEIGHT
  const sendRequest = vi.fn(async () => ({ ok: true, result: { updated: true, applied: true } }))
  const client = {
    sendRequest,
    updateTerminalSubscriptionViewport: vi.fn()
  } as unknown as RpcClient
  const engine = {
    measureFitDimensions: vi.fn(async (containerHeight?: number) =>
      fitDimensions(containerHeight ?? 0)
    ),
    reflow: vi.fn()
  } as unknown as TerminalWebViewHandle
  const subscribeToTerminal = vi.fn()
  const unsubscribeTerminal = vi.fn()
  const viewport = { current: fitDimensions(prewarmFrameHeight) as { cols: number; rows: number } }
  const viewportMeasured = { current: true }
  // The real pane's frame, reported by its onLayout once the tab bar has mounted.
  const frameHeight = { current: firstPaneFrameHeight }

  let notify: ((height: number) => void) | null = null
  function RefitHarness(): ReactElement | null {
    const terminalRefs = useRef(new Map([[HANDLE, engine]]))
    const { notifyTerminalFrameHeight } = useTerminalViewportRefit({
      activeHandleRef: useRef<string | null>(HANDLE),
      terminalRefs,
      terminalFrameHeightRef: frameHeight,
      viewportRef: viewport,
      viewportMeasuredRef: viewportMeasured,
      nativeChatCoveredRef: useRef(false),
      clientRef: useRef<RpcClient | null>(client),
      deviceTokenRef: useRef<string | null>('device-1'),
      initializedHandlesRef: useRef(new Set([HANDLE])),
      connState: 'connected',
      // One terminal, so the tab-strip corrector is not armed — this is the case that used to
      // fall through to the frame-height reducer and pay for the mis-measurement.
      tabStripVisible: false,
      textScale: 1,
      terminalFrameWidth: 390,
      unsubscribeTerminal,
      subscribeToTerminal
    })
    notify = notifyTerminalFrameHeight
    return null
  }

  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(createElement(RefitHarness))
  })
  await act(async () => {
    notify?.(firstPaneFrameHeight)
  })
  // Why drain microtasks between ticks and before unmount: the refit measures and sends inside an
  // async block that bails once disposedRef flips, so tearing down early would fake a clean run.
  await act(async () => {
    vi.advanceTimersByTime(REFIT_DEBOUNCE_MS + 1)
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve()
    }
  })
  await act(async () => {
    vi.advanceTimersByTime(REFIT_DEBOUNCE_MS + 1)
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve()
    }
  })
  act(() => (renderer as unknown as ReactTestRenderer).unmount())

  return {
    updateViewportCalls: sendRequest.mock.calls.filter(
      ([method]) => method === 'terminal.updateViewport'
    ).length,
    resubscribes: subscribeToTerminal.mock.calls.length,
    latchedRows: viewport.current.rows
  }
}

describe('terminal pre-warm refit debt', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('owes the host nothing after the first subscribe when the pre-warm reserved the tab bar', async () => {
    const reserved = CONTENT_ROW_HEIGHT - MOBILE_SESSION_TAB_BAR_HEIGHT
    const result = await runSingleTerminalColdOpen(reserved)

    expect(result.updateViewportCalls).toBe(0)
    expect(result.resubscribes).toBe(0)
    expect(result.latchedRows).toBe(fitDimensions(reserved).rows)
  })

  it('pays a terminal.updateViewport round trip if the pre-warm measured the pre-tab-bar box', async () => {
    // Guards the fix, not the code: this is the frame the pre-warm saw before it reserved the bar.
    const result = await runSingleTerminalColdOpen(CONTENT_ROW_HEIGHT)

    expect(result.updateViewportCalls).toBe(1)
    // And the rows it had to correct are rows the host was told about and never had.
    expect(fitDimensions(CONTENT_ROW_HEIGHT).rows).toBeGreaterThan(
      fitDimensions(CONTENT_ROW_HEIGHT - MOBILE_SESSION_TAB_BAR_HEIGHT).rows
    )
  })
})
