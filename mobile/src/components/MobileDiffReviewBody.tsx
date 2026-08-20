import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native'
import { RefreshCw } from 'lucide-react-native'
import type { RefObject } from 'react'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import { colors } from '../theme/mobile-theme'
import { MobileDiffReviewLine } from './MobileDiffReviewLine'
import type {
  ReviewDiffLine,
  ReviewDiffState,
  ReviewScreenState
} from '../session/mobile-diff-review-screen-model'
import type { MobileDiffReviewQueueItem } from '../session/mobile-diff-review-queue'
import { mobileDiffReviewStyles as styles } from './mobile-diff-review-screen-styles'
import { translate } from '../i18n/i18n'

type Props = {
  activeHunkIndex: number | null
  commentsByLine: ReadonlyMap<number, DiffComment[]>
  currentItem: MobileDiffReviewQueueItem | null
  diffState: ReviewDiffState
  filteredCount: number
  listRef: RefObject<FlatList<ReviewDiffLine> | null>
  screenState: ReviewScreenState
  staleCommentIds: ReadonlySet<string>
  onAddNote: (lineNumber: number) => void
  onEditNote: (comment: DiffComment) => void
  onRetry: () => void
}

export function MobileDiffReviewBody({
  activeHunkIndex,
  commentsByLine,
  currentItem,
  diffState,
  filteredCount,
  listRef,
  screenState,
  staleCommentIds,
  onAddNote,
  onEditNote,
  onRetry
}: Props) {
  if (screenState.kind === 'loading') {
    return (
      <CenteredState
        text={translate('m.MobileDiffReviewBody.3a7d07fc96', 'Loading review...')}
        busy
      />
    )
  }
  if (screenState.kind === 'error' || screenState.kind === 'unavailable') {
    return (
      <CenteredState
        title={
          screenState.kind === 'unavailable'
            ? translate('m.MobileDiffReviewBody.afe74af652', 'Review Unavailable')
            : translate('m.MobileDiffReviewBody.7b9b086d5d', 'Unable to Load Review')
        }
        text={screenState.message}
        onRetry={onRetry}
      />
    )
  }
  if (filteredCount === 0) {
    return (
      <CenteredState
        title={translate('m.MobileDiffReviewBody.dfe44c788a', 'No Reviewable Changes')}
        text={translate('m.MobileDiffReviewBody.2aedb02be8', 'Try a different review filter.')}
      />
    )
  }
  if (diffState.kind === 'loading') {
    return (
      <CenteredState
        text={translate('m.MobileDiffReviewBody.7ba47f20f3', 'Loading diff...')}
        busy
        muted
      />
    )
  }
  if (diffState.kind !== 'ready') {
    return <DiffUnavailableState diffState={diffState} onRetry={onRetry} />
  }
  return (
    <FlatList
      ref={listRef}
      data={diffState.lines}
      keyExtractor={(_, index) => `${currentItem?.key ?? 'diff'}:${index}`}
      renderItem={({ item, index }) => {
        const lineNumber = item.newLineNumber ?? -1
        const active =
          activeHunkIndex !== null &&
          index >= (diffState.hunks[activeHunkIndex]?.startIndex ?? -1) &&
          index <= (diffState.hunks[activeHunkIndex]?.endIndex ?? -1)
        return (
          <MobileDiffReviewLine
            line={item}
            comments={commentsByLine.get(lineNumber) ?? []}
            staleCommentIds={staleCommentIds}
            active={active}
            onAddNote={onAddNote}
            onEditNote={onEditNote}
          />
        )
      }}
      contentContainerStyle={styles.diffList}
      onScrollToIndexFailed={(info) => {
        listRef.current?.scrollToOffset({
          offset: Math.max(0, info.averageItemLength * info.index),
          animated: true
        })
      }}
      ListFooterComponent={
        diffState.truncated ? (
          <Text style={styles.truncatedText}>
            {translate('m.MobileDiffReviewBody.5ba30b368d', 'Diff truncated for mobile preview.')}
          </Text>
        ) : null
      }
    />
  )
}

function DiffUnavailableState({
  diffState,
  onRetry
}: {
  diffState: ReviewDiffState
  onRetry: () => void
}) {
  const title =
    diffState.kind === 'binary'
      ? translate('m.MobileDiffReviewBody.0a4bbf6913', 'Binary Diff')
      : diffState.kind === 'too-large'
        ? translate('m.MobileDiffReviewBody.06b13f6828', 'Diff Too Large')
        : diffState.kind === 'deleted'
          ? translate('m.MobileDiffReviewBody.f52bfb25be', 'Deleted File')
          : translate('m.MobileDiffReviewBody.45a8e6d5ca', 'Diff Unavailable')
  const text =
    diffState.kind === 'binary'
      ? translate(
          'm.MobileDiffReviewBody.15d3872219',
          'This file cannot be rendered as text on mobile.'
        )
      : diffState.kind === 'too-large'
        ? translate(
            'm.MobileDiffReviewBody.61e41a6d8b',
            'This diff is too large for the mobile preview.'
          )
        : diffState.kind === 'deleted'
          ? translate(
              'm.MobileDiffReviewBody.126e672f04',
              'This file was deleted. Add a file note or mark it reviewed.'
            )
          : diffState.kind === 'error'
            ? diffState.message
            : translate('m.MobileDiffReviewBody.3e96692d6c', 'Select a file to review.')
  return <CenteredState title={title} text={text} onRetry={onRetry} />
}

function CenteredState({
  busy,
  muted,
  title,
  text,
  onRetry
}: {
  busy?: boolean
  muted?: boolean
  title?: string
  text: string
  onRetry?: () => void
}) {
  return (
    <View style={styles.state}>
      {busy ? (
        <ActivityIndicator color={muted ? colors.textSecondary : colors.textPrimary} />
      ) : null}
      {title ? <Text style={styles.stateTitle}>{title}</Text> : null}
      <Text style={styles.stateText}>{text}</Text>
      {onRetry ? (
        <Pressable
          style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry loading review"
        >
          <RefreshCw size={14} color={colors.textPrimary} strokeWidth={2.2} />
          <Text style={styles.retryText}>
            {translate('m.MobileDiffReviewBody.196c031931', 'Retry')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}
