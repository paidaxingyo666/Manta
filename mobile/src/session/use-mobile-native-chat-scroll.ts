import { useCallback, useEffect, useRef, useState } from 'react'
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
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
  onContentSizeChange: () => void
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
  // the keyboard when it opens — but only when already pinned to the bottom, so
  // we don't yank the user away while they read history. (Also fires on keyboard
  // close, which is harmless while atBottom.)
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
    listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true })
  }, [])

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
      const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height)
      setAtBottom(distanceFromBottom < AT_BOTTOM_SLACK)
      // Near the top — page in older history, but only if the user put us here.
      if (
        userDraggingRef.current &&
        contentOffset.y < LOAD_EARLIER_OFFSET &&
        hasMore &&
        !loadingEarlier
      ) {
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

  const onContentSizeChange = useCallback(() => {
    if (messageCount > 0 && atBottom) {
      listRef.current?.scrollToEnd({ animated: false })
    }
  }, [messageCount, atBottom])

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
    onScrollToIndexFailed
  }
}
