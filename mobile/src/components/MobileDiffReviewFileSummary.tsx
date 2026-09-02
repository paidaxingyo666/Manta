import { Pressable, Text, View } from 'react-native'
import { ArrowDown, ArrowUp } from 'lucide-react-native'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import { colors } from '../theme/mobile-theme'
import type { MobileDiffReviewQueueItem } from '../session/mobile-diff-review-queue'
import { MOBILE_GIT_STATUS_LABELS } from '../source-control/mobile-git-status'
import {
  mobileReviewCountLabel,
  mobileReviewScopeLabel,
  type ReviewDiffState
} from '../session/mobile-diff-review-screen-model'
import { mobileDiffReviewStyles as styles } from './mobile-diff-review-screen-styles'
import { translate } from '../i18n/i18n'

type Props = {
  currentIndex: number
  diffState: ReviewDiffState
  fileNotes: DiffComment[]
  filteredCount: number
  item: MobileDiffReviewQueueItem
  staleCommentIds: ReadonlySet<string>
  onEditNote: (comment: DiffComment) => void
  onJumpHunk: (direction: 'next' | 'previous') => void
}

function statusColor(status: MobileDiffReviewQueueItem['status']): string {
  switch (status) {
    case 'added':
    case 'copied':
      return colors.statusGreen
    case 'deleted':
      return colors.statusRed
    case 'renamed':
      return colors.accentBlue
    case 'untracked':
      return colors.statusAmber
    case 'modified':
    default:
      return colors.textSecondary
  }
}

export function MobileDiffReviewFileSummary({
  currentIndex,
  diffState,
  fileNotes,
  filteredCount,
  item,
  staleCommentIds,
  onEditNote,
  onJumpHunk
}: Props) {
  const hunkDisabled = diffState.kind !== 'ready' || diffState.hunks.length === 0
  const badgeColor = statusColor(item.status)
  return (
    <View style={styles.fileHeader}>
      <View style={styles.fileTitleRow}>
        <View style={[styles.statusBadge, { borderColor: badgeColor }]}>
          <Text style={[styles.statusBadgeText, { color: badgeColor }]}>
            {MOBILE_GIT_STATUS_LABELS[item.status]}
          </Text>
        </View>
        <View style={styles.fileTitleBlock}>
          <Text style={styles.filePath} numberOfLines={1}>
            {item.filePath}
          </Text>
          <Text style={styles.fileMeta} numberOfLines={1}>
            {mobileReviewScopeLabel(item)}
            {item.oldPath
              ? translate('m.MobileDiffReviewFileSummary.4ea7bacdf4', ' from {{value0}}', {
                  value0: item.oldPath
                })
              : ''}
          </Text>
        </View>
      </View>
      <View style={styles.fileMetaRow}>
        <Text style={styles.fileMeta}>
          {currentIndex + 1}/{filteredCount}
        </Text>
        {item.isReviewed ? (
          <Text style={styles.reviewedPill}>
            {translate('m.MobileDiffReviewFileSummary.4c6781140f', 'Reviewed')}
          </Text>
        ) : null}
        {item.changedSinceReview ? (
          <Text style={styles.stalePill}>
            {translate('m.MobileDiffReviewFileSummary.715ff9cedd', 'Changed')}
          </Text>
        ) : null}
        {item.noteCount > 0 ? (
          <Text style={styles.fileMeta}>
            {mobileReviewCountLabel(item.noteCount, 'note', 'notes')}
          </Text>
        ) : null}
        {item.staleNoteCount > 0 ? (
          <Text style={styles.staleText}>
            {item.staleNoteCount} {translate('m.MobileDiffReviewFileSummary.db301c5173', 'stale')}
          </Text>
        ) : null}
      </View>
      {fileNotes.length > 0 ? (
        <View style={styles.fileNotes}>
          {fileNotes.map((note) => (
            <Pressable
              key={note.id}
              style={({ pressed }) => [styles.fileNote, pressed && styles.fileNotePressed]}
              onPress={() => onEditNote(note)}
              accessibilityRole="button"
              accessibilityLabel="Edit file note"
            >
              <Text style={styles.fileNoteText} numberOfLines={2}>
                {note.body}
              </Text>
              {staleCommentIds.has(note.id) ? (
                <Text style={styles.staleText}>
                  {translate('m.MobileDiffReviewFileSummary.3e9a9b32ee', 'Stale')}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.hunkRow}>
        <Pressable
          style={({ pressed }) => [styles.hunkButton, pressed && styles.hunkButtonPressed]}
          disabled={hunkDisabled}
          onPress={() => onJumpHunk('previous')}
          accessibilityRole="button"
          accessibilityLabel="Previous hunk"
        >
          <ArrowUp size={14} color={colors.textSecondary} strokeWidth={2.2} />
          <Text style={styles.hunkButtonText}>
            {translate('m.MobileDiffReviewFileSummary.3745bb8fe6', 'Hunk')}
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.hunkButton, pressed && styles.hunkButtonPressed]}
          disabled={hunkDisabled}
          onPress={() => onJumpHunk('next')}
          accessibilityRole="button"
          accessibilityLabel="Next hunk"
        >
          <ArrowDown size={14} color={colors.textSecondary} strokeWidth={2.2} />
          <Text style={styles.hunkButtonText}>
            {translate('m.MobileDiffReviewFileSummary.3745bb8fe6', 'Hunk')}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}
