import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalWebViewHandle } from '../terminal/terminal-webview-contract'

const engine = vi.hoisted(() => ({
  init: vi.fn((_cols: number, _rows: number) => {}),
  awaitReady: vi.fn(async () => {}),
  measureFitDimensions: vi.fn(async (_containerHeight?: number) => ({ cols: 120, rows: 40 })),
  onWebReady: null as (() => void) | null,
  textScale: undefined as number | undefined
}))

vi.mock('react-native', () => ({
  StyleSheet: {
    create: <T>(styles: T) => styles,
    absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }
  },
  View: 'View'
}))

// Stands in for the real engine: records the ref the pre-warm pane holds and the ready callback
// it arms, so a test can drive web-ready and layout in either order.
vi.mock('../terminal/TerminalWebView', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    TerminalWebView: forwardRef<
      TerminalWebViewHandle,
      { onWebReady?: () => void; textScale?: number }
    >(function MockTerminalWebView(props, ref) {
      engine.onWebReady = props.onWebReady ?? null
      engine.textScale = props.textScale
      useImperativeHandle(ref, () => engine as unknown as TerminalWebViewHandle, [])
      return createElement('MockTerminalWebView')
    })
  }
})

import { TerminalEnginePrewarm } from './TerminalEnginePrewarm'

const FRAME = { x: 0, y: 0, width: 390, height: 700 }

const TEXT_SCALE = 1.25

function renderPrewarm(onEngineMeasured: (ref: TerminalWebViewHandle, height: number) => void): {
  renderer: ReactTestRenderer
  layout: (frame: { x: number; y: number; width: number; height: number }) => void
  webReady: () => void
} {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(
      createElement(TerminalEnginePrewarm, {
        reservedTabBarHeight: 0,
        textScale: TEXT_SCALE,
        onEngineMeasured
      })
    )
  })
  const created = renderer as unknown as ReactTestRenderer
  return {
    renderer: created,
    layout: (frame) =>
      act(() => {
        created.root.findAllByType('View')[0]?.props.onLayout({ nativeEvent: { layout: frame } })
      }),
    webReady: () =>
      act(() => {
        engine.onWebReady?.()
      })
  }
}

// The handoff now waits on the engine's ready promise, so tests have to let microtasks run.
async function flushReady(): Promise<void> {
  await act(async () => {})
}

afterEach(() => {
  engine.measureFitDimensions.mockClear()
  engine.init.mockClear()
  engine.awaitReady.mockReset()
  engine.awaitReady.mockResolvedValue(undefined)
  engine.onWebReady = null
  engine.textScale = undefined
})

describe('TerminalEnginePrewarm', () => {
  it('boots the engine without waiting for a terminal to attach', () => {
    const measured = vi.fn()
    const { renderer } = renderPrewarm(measured)
    // The engine mounts on the first render, so its bundle loads while the startup RPCs fly.
    expect(renderer.root.findAllByType('MockTerminalWebView')).toHaveLength(1)
    expect(measured).not.toHaveBeenCalled()
  })

  it('withholds the measurement until the pane has a real layout', async () => {
    const measured = vi.fn()
    const { webReady, layout } = renderPrewarm(measured)

    webReady()
    // Why: this is the 80x24 trap — an unsized engine answers with xterm's default, and that
    // number would ride the first subscribe to the host as the PTY size.
    expect(measured).not.toHaveBeenCalled()

    layout({ ...FRAME, width: 0, height: 0 })
    expect(measured).not.toHaveBeenCalled()

    layout(FRAME)
    await flushReady()
    expect(measured).toHaveBeenCalledOnce()
    expect(measured.mock.calls[0]?.[1]).toBe(FRAME.height)
  })

  it('withholds the measurement until the engine reports ready', async () => {
    const measured = vi.fn()
    const { layout, webReady } = renderPrewarm(measured)

    layout(FRAME)
    expect(measured).not.toHaveBeenCalled()

    webReady()
    await flushReady()
    expect(measured).toHaveBeenCalledOnce()
  })

  it('measures once however many times layout and web-ready repeat', async () => {
    const measured = vi.fn()
    const { layout, webReady } = renderPrewarm(measured)

    layout(FRAME)
    webReady()
    webReady()
    layout({ ...FRAME, height: 640 })
    layout(FRAME)
    await flushReady()

    expect(measured).toHaveBeenCalledOnce()
  })

  it('opens the engine before handing it over, because web-ready alone builds no terminal', async () => {
    const measured = vi.fn()
    let releaseReady: (() => void) | null = null
    engine.awaitReady.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseReady = resolve
        })
    )
    const { layout, webReady } = renderPrewarm(measured)

    layout(FRAME)
    webReady()
    // Why: the WebView answers `measure` with null while it has no terminal, and the pane latches
    // once, so handing the engine over before init would spend the one measurement on nothing.
    expect(engine.init).toHaveBeenCalledOnce()
    expect(measured).not.toHaveBeenCalled()

    releaseReady?.()
    await flushReady()
    expect(measured).toHaveBeenCalledOnce()
    expect(measured.mock.calls[0]?.[0]).toBe(engine)
  })

  it('pre-warms at the text size the first pane will open with', () => {
    renderPrewarm(vi.fn())
    // Cell size is what the frame gets divided by, so a default-sized engine would measure a
    // different phone than the one the user is looking at.
    expect(engine.textScale).toBe(TEXT_SCALE)
  })

  it('reports the frame the pane ended up with when a resize lands during engine start-up', async () => {
    const measured = vi.fn()
    let releaseReady: (() => void) | null = null
    engine.awaitReady.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseReady = resolve
        })
    )
    const { layout, webReady } = renderPrewarm(measured)

    layout(FRAME)
    webReady()
    expect(measured).not.toHaveBeenCalled()

    // A rotation or split-screen resize while the engine is still coming up. The latch has already
    // fired, so this is the last chance to correct the height the one measurement is taken against.
    const resized = { ...FRAME, width: 700, height: 360 }
    layout(resized)

    releaseReady?.()
    await flushReady()

    expect(measured).toHaveBeenCalledOnce()
    expect(measured.mock.calls[0]?.[1]).toBe(resized.height)
  })

  it('drops the handoff when the pane unmounts before the engine is ready', async () => {
    const measured = vi.fn()
    let releaseReady: (() => void) | null = null
    engine.awaitReady.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseReady = resolve
        })
    )
    const { renderer, layout, webReady } = renderPrewarm(measured)
    layout(FRAME)
    webReady()

    act(() => {
      renderer.unmount()
    })
    releaseReady?.()
    await flushReady()

    // The frame this measurement was taken against is gone, so it describes nothing.
    expect(measured).not.toHaveBeenCalled()
  })

  it('is inert: no touches, no accessibility, and nothing sent to a terminal', async () => {
    const measured = vi.fn()
    const { renderer, layout, webReady } = renderPrewarm(measured)
    layout(FRAME)
    webReady()
    await flushReady()

    const pane = renderer.root.findAllByType('View')[0]
    expect(pane?.props.pointerEvents).toBe('none')
    expect(pane?.props.accessibilityElementsHidden).toBe(true)
    expect(pane?.props.importantForAccessibility).toBe('no-hide-descendants')
    // The pane owns no handle, so it has no way to subscribe, send input, or resize a PTY.
    // Opening the engine is WebView-local; the measurement itself is the caller's to take.
    expect(engine.measureFitDimensions).not.toHaveBeenCalled()
    expect(measured.mock.calls[0]?.[0]).toBe(engine)
  })
})
