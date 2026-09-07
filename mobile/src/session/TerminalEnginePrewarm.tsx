import { useCallback, useRef } from 'react'
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { TerminalWebView } from '../terminal/TerminalWebView'
import type { TerminalWebViewHandle } from '../terminal/terminal-webview-contract'

// Diagnostics label for the measurement this pane contributes; it is not a PTY handle.
export const TERMINAL_ENGINE_PREWARM_HANDLE = '(engine-prewarm)'

// Why: the WebView builds no xterm until it is told to, and `measure` answers null while `term`
// is null, so the engine has to be opened before it can be asked anything. These are placeholder
// dimensions for an empty buffer nobody reads; the measurement derives its own cols and rows from
// the frame and the font's cell size, so nothing downstream inherits them.
const PREWARM_INIT_COLS = 80
const PREWARM_INIT_ROWS = 24

type Props = {
  // Height the tab bar will claim from the top of this frame once the session has a tab. The
  // loading state has no visible tab, so the bar is not mounted yet and the box the pane will
  // finally occupy is this much shorter. Reserving it keeps the measurement honest; measuring
  // the taller box would latch too many rows and send them to the host as the PTY size.
  reservedTabBarHeight: number
  // Why: the first pane opens at the user's saved text size, and cell size is what the
  // measurement divides the frame by. Pre-warming at a different size measures a different phone.
  textScale: number
  onEngineMeasured: (ref: TerminalWebViewHandle, frameHeight: number) => void
}

// Why: a session still resolving its tabs already knows it is heading for a terminal, so load
// the xterm engine alongside the startup RPCs instead of after terminal.list returns. This pane
// owns no handle: it never subscribes, never sends input, and can never resize a PTY. Its only
// output is the viewport measurement the first real pane would otherwise pay a round trip for.
export function TerminalEnginePrewarm({
  reservedTabBarHeight,
  textScale,
  onEngineMeasured
}: Props) {
  const engineRef = useRef<TerminalWebViewHandle | null>(null)
  const frameHeightRef = useRef(0)
  const webReadyRef = useRef(false)
  const measuredRef = useRef(false)

  // Idempotent by construction: both triggers funnel here and the latch fires once per mount.
  const measureWhenSized = useCallback(() => {
    const engine = engineRef.current
    // Why: an unsized or unmounted WebView measures xterm's 80x24 default, and that number
    // rides the first subscribe to the host. Only a laid-out engine is allowed to answer.
    if (measuredRef.current || !webReadyRef.current || !engine || frameHeightRef.current <= 0) {
      return
    }
    measuredRef.current = true
    // `web-ready` only says the xterm bundle loaded. Opening the engine is what creates `term`,
    // and `awaitReady` is what lets its cell dimensions exist before anything reads them.
    engine.init(PREWARM_INIT_COLS, PREWARM_INIT_ROWS)
    void engine.awaitReady().then(() => {
      // React nulls the ref on unmount, so this proves the pane the frame belongs to is still up.
      if (engineRef.current !== engine) {
        return
      }
      // Why read the height here and not before the wait: a rotation or split-screen resize during
      // engine start-up re-lays out this pane, and the latch above already refused the second
      // handoff, so a height captured earlier would be the only one this pane ever reports.
      onEngineMeasured(engine, frameHeightRef.current)
    })
  }, [onEngineMeasured])

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { height, width } = event.nativeEvent.layout
      if (width <= 0 || height <= 0) {
        return
      }
      frameHeightRef.current = height
      measureWhenSized()
    },
    [measureWhenSized]
  )

  const handleWebReady = useCallback(() => {
    webReadyRef.current = true
    measureWhenSized()
  }, [measureWhenSized])

  return (
    <View
      // Why: sized like the real pane so the measurement matches, but invisible and inert so it
      // cannot paint over the loading state or steal a touch from the retry affordance above it.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.prewarmPane, { top: reservedTabBarHeight }]}
      onLayout={handleLayout}
    >
      <TerminalWebView
        ref={engineRef}
        style={styles.prewarmWebView}
        textScale={textScale}
        onWebReady={handleWebReady}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  prewarmPane: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0
  },
  prewarmWebView: {
    flex: 1
  }
})
