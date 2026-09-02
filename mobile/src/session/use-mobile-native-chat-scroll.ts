import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent
} from 'react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

/** Distance from the bottom, in px, still counted as "following the tail". */
const AT_BOTTOM_SLACK = 80
/** Offset under which a user-driven scroll asks for older history. */
const LOAD_EARLIER_OFFSET = 60
/** Let a growing list lay out before chasing its new bottom. */
const TAIL_FOLLOW_DELAY_MS = 60

type Args = {
  messageCount: number
  keyboardInset: number
  hasMore?: boolean
  loadingEarlier?: boolean
  onLoadEarlier?: () => void
}

export type ChatScroll = {
  listRef: React.RefObject<FlatList<NativeChatMessage> | null>
  atBottom: boolean
  /** Jump to the newest message and resume following the tail. */
  jumpToLatest: () => void
  /** Align one message's top with the top of the viewport. */
  scrollToMessage: (index: number) => void
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
  onScrollBeginDrag: () => void
  onScrollEndDrag: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
  onMomentumScrollEnd: () => void
  onContentSizeChange: (width: number, height: number) => void
  onLayout: (event: LayoutChangeEvent) => void
  onScrollToIndexFailed: (info: { index: number; averageItemLength: number }) => void
}

export function useMobileNativeChatScroll({
  messageCount,
  keyboardInset,
  hasMore,
  loadingEarlier,
  onLoadEarlier
}: Args): ChatScroll {
  const listRef = useRef<FlatList<NativeChatMessage> | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  // Why: onScroll cannot tell a programmatic scrollToEnd from a drag, and the
  // one this view fires on open starts at offset 0 — its first throttled sample
  // reads as "near the top" and pages in history nobody asked for.
  const userDraggingRef = useRef(false)
  const viewportHeightRef = useRef(0)
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (jumpTimerRef.current) {
        clearTimeout(jumpTimerRef.current)
      }
    },
    []
  )

  // Follow the tail as the conversation grows and keep the newest message above
  // the keyboard when it opens — but only while following, so we don't yank the
  // user away while they read history. (Also fires on keyboard close, which is
  // harmless while following.)
  useEffect(() => {
    if (messageCount === 0 || !atBottom) {
      return
    }
    const t = setTimeout(
      () => listRef.current?.scrollToEnd({ animated: true }),
      TAIL_FOLLOW_DELAY_MS
    )
    return () => clearTimeout(t)
  }, [messageCount, atBottom, keyboardInset])

  const jumpToLatest = useCallback(() => {
    setAtBottom(true)
    if (jumpTimerRef.current) {
      clearTimeout(jumpTimerRef.current)
    }
    jumpTimerRef.current = setTimeout(() => {
      jumpTimerRef.current = null
      listRef.current?.scrollToEnd({ animated: true })
    }, TAIL_FOLLOW_DELAY_MS)
  }, [])

  const scrollToMessage = useCallback((index: number) => {
    // Jumping to a specific message is the user leaving the tail on purpose.
    setAtBottom(false)
    listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true })
  }, [])

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      // Why only while the user drives: following the tail is a mode, not a
      // measurement. The scrollToEnd this hook fires itself emits samples on its
      // way down, and reading those flips following off mid-flight — which is
      // how every incoming reply started bouncing the reader up the transcript
      // and revealing the jump-to-latest button.
      if (!userDraggingRef.current) {
        return
      }
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
      const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height)
      setAtBottom(distanceFromBottom < AT_BOTTOM_SLACK)
      // Near the top — page in older history, but only if the user put us here.
      if (contentOffset.y < LOAD_EARLIER_OFFSET && hasMore && !loadingEarlier) {
        onLoadEarlier?.()
      }
    },
    [hasMore, loadingEarlier, onLoadEarlier]
  )

  const onScrollBeginDrag = useCallback(() => {
    userDraggingRef.current = true
  }, [])

  // Momentum outlives the finger, and a fling from mid-list is still the user
  // asking for history — so the flag clears only once the list is at rest.
  const onScrollEndDrag = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (e.nativeEvent.velocity == null || e.nativeEvent.velocity.y === 0) {
      userDraggingRef.current = false
    }
  }, [])

  const onMomentumScrollEnd = useCallback(() => {
    userDraggingRef.current = false
  }, [])

  /**
   * Re-pins the bottom as content grows, using the height the callback reports.
   *
   * Not scrollToEnd: that reads the list's own cached scroll metrics, which lag
   * a growing row. A streaming reply changes height far faster than those
   * refresh, so the pin repeatedly landed at a bottom that had already moved —
   * the reader drifted up mid-answer and only caught up when the finished
   * message changed the row count and woke the effect above. The height handed
   * in here is measured, not remembered.
   */
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (messageCount === 0 || !atBottom) {
        return
      }
      listRef.current?.scrollToOffset({
        offset: Math.max(0, height - viewportHeightRef.current),
        animated: false
      })
    },
    [messageCount, atBottom]
  )

  /** The viewport height the offset above subtracts; 0 until the first layout. */
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    viewportHeightRef.current = event.nativeEvent.layout.height
  }, [])

  // scrollToIndex can fail before an off-screen row is measured — fall back to
  // an estimated offset, then retry once it's laid out.
  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      listRef.current?.scrollToOffset({
        offset: info.averageItemLength * info.index,
        animated: true
      })
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0, animated: true })
      }, 120)
    },
    []
  )

  return {
    listRef,
    atBottom,
    jumpToLatest,
    scrollToMessage,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollEnd,
    onContentSizeChange,
    onLayout,
    onScrollToIndexFailed
  }
}
