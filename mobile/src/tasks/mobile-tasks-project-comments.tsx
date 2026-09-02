import type { ConnectionPresentationModel } from './use-mobile-tasks-connection-presentation'
import {
  View,
  Text,
  Pressable,
  type ReactNode,
  TextInput,
  colors,
  MobileMarkdown
} from './mobile-tasks-dependencies'
import { styles } from './mobile-tasks-legacy-styles'
import {
  discussionSummary,
  detailCommentGroupId,
  detailCommentGroupRoot,
  detailCommentGroupCount,
  isResolvedDetailCommentGroup,
  commentAuthor,
  type DetailComment,
  SHOW_MOBILE_COMMENT_THREAD_TOOLS,
  commentSourceLabel,
  commentDate,
  renderCommentReactions,
  projectRowType
} from './mobile-tasks-legacy-foundation'
import { translate } from '../i18n/i18n'

export function renderMobileTasksProjectComments(model: ConnectionPresentationModel) {
  const {
    addProjectRowComment,
    deleteProjectRowComment,
    expandedResolvedCommentGroups,
    itemReplyDrafts,
    projectCommentDraft,
    projectDetailCommentGroups,
    projectEditingCommentDraft,
    projectEditingCommentId,
    projectMutating,
    projectRowDetail,
    projectRowItem,
    renderCommentComposer,
    replyToProjectGitHubComment,
    setExpandedResolvedCommentGroups,
    setItemReplyDrafts,
    setProjectCommentDraft,
    setProjectEditingCommentDraft,
    setProjectEditingCommentId,
    toggleProjectGitHubReviewThread,
    updateProjectRowComment
  } = model
  if (!projectRowItem) {
    return null
  }
  return projectRowDetail?.provider === 'github' ? (
    <View style={styles.detailSection}>
      <View style={styles.detailSectionHeader}>
        <Text style={styles.detailSectionTitle}>
          {translate('m.tasks.01798c4ff8', 'Discussion')}
        </Text>
        <Text style={styles.detailSectionMeta}>
          {discussionSummary(projectRowDetail.comments.length)}
        </Text>
      </View>
      {projectRowDetail.comments.length === 0 ? (
        <Text style={styles.detailMuted}>{translate('m.tasks.0fb53b901e', 'No comments.')}</Text>
      ) : (
        projectDetailCommentGroups.map((group) => {
          const groupId = detailCommentGroupId(group)
          const root = detailCommentGroupRoot(group)
          const count = detailCommentGroupCount(group)
          const isCollapsedResolved =
            isResolvedDetailCommentGroup(group) && !expandedResolvedCommentGroups.has(groupId)
          if (isCollapsedResolved) {
            return (
              <Pressable
                key={groupId}
                style={styles.resolvedCommentSummary}
                onPress={() =>
                  setExpandedResolvedCommentGroups((current) => {
                    const next = new Set(current)
                    next.add(groupId)
                    return next
                  })
                }
              >
                <Text style={styles.resolvedCommentTitle} numberOfLines={1}>
                  {translate('m.tasks.6267438140', 'Resolved')}{' '}
                  {group.kind === 'thread'
                    ? translate('m.tasks.4f9ae79c6d', 'thread')
                    : translate('m.tasks.a71fb209e4', 'comment')}{' '}
                  {translate('m.tasks.364aac3cc7', 'by')} {commentAuthor(root)}
                </Text>
                <Text style={styles.detailSectionMeta}>
                  {count > 1
                    ? translate('m.tasks.52fd613db0', '{{value0}} comments', { value0: count })
                    : translate('m.tasks.cf57cc3c02', 'Show')}
                </Text>
              </Pressable>
            )
          }

          const renderProjectComment = (
            comment: DetailComment,
            options: { nested?: boolean } = {}
          ): ReactNode => {
            const commentId = String(comment.id)
            const isEditingComment =
              SHOW_MOBILE_COMMENT_THREAD_TOOLS && projectEditingCommentId === commentId
            return (
              <View
                key={commentId}
                style={[
                  styles.commentBlock,
                  options.nested && styles.commentReplyBlock,
                  comment.isResolved && styles.commentResolvedBlock
                ]}
              >
                <Text style={styles.commentSource} numberOfLines={1}>
                  {commentSourceLabel(comment)}
                </Text>
                <Text style={styles.commentMeta}>
                  {commentAuthor(comment)}
                  {commentDate(comment.createdAt) ? ` · ${commentDate(comment.createdAt)}` : ''}
                </Text>
                {isEditingComment ? (
                  <>
                    <TextInput
                      style={[styles.input, styles.commentInput]}
                      value={projectEditingCommentDraft}
                      onChangeText={setProjectEditingCommentDraft}
                      placeholder={translate('m.tasks.9683022203', 'Edit comment')}
                      placeholderTextColor={colors.textMuted}
                      multiline
                      textAlignVertical="top"
                    />
                    <View style={styles.inlineActionRow}>
                      <Pressable
                        style={styles.inlineSaveButtonCompact}
                        disabled={projectMutating || projectEditingCommentDraft.trim().length === 0}
                        onPress={() => void updateProjectRowComment(projectRowItem, comment)}
                      >
                        <Text style={styles.inlineSaveText}>
                          {translate('m.tasks.c7158b292f', 'Save')}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={styles.inlineSaveButtonCompact}
                        disabled={projectMutating}
                        onPress={() => {
                          setProjectEditingCommentId(null)
                          setProjectEditingCommentDraft('')
                        }}
                      >
                        <Text style={styles.inlineSaveText}>
                          {translate('m.tasks.16fee5cb7d', 'Cancel')}
                        </Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <>
                    <MobileMarkdown content={comment.body} />
                    {renderCommentReactions(comment)}
                    {SHOW_MOBILE_COMMENT_THREAD_TOOLS ? (
                      <View style={styles.inlineActionRow}>
                        {projectRowType(projectRowItem) === 'pr' && comment.threadId ? (
                          <Pressable
                            style={styles.inlineSaveButtonCompact}
                            disabled={projectMutating}
                            onPress={() =>
                              void toggleProjectGitHubReviewThread(projectRowItem, comment)
                            }
                          >
                            <Text style={styles.inlineSaveText}>
                              {comment.isResolved
                                ? translate('m.tasks.a84735398a', 'Reopen thread')
                                : translate('m.tasks.4638e5d620', 'Resolve thread')}
                            </Text>
                          </Pressable>
                        ) : null}
                        <TextInput
                          style={[styles.input, styles.replyInput]}
                          value={itemReplyDrafts[commentId] ?? ''}
                          onChangeText={(next) =>
                            setItemReplyDrafts((current) => ({
                              ...current,
                              [commentId]: next
                            }))
                          }
                          placeholder={translate('m.tasks.d8cc91fe24', 'Reply')}
                          placeholderTextColor={colors.textMuted}
                          multiline
                          textAlignVertical="top"
                        />
                        <Pressable
                          style={styles.inlineSaveButtonCompact}
                          disabled={projectMutating || !(itemReplyDrafts[commentId] ?? '').trim()}
                          onPress={() => void replyToProjectGitHubComment(projectRowItem, comment)}
                        >
                          <Text style={styles.inlineSaveText}>
                            {translate('m.tasks.d8cc91fe24', 'Reply')}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={styles.inlineSaveButtonCompact}
                          disabled={projectMutating}
                          onPress={() => {
                            setProjectEditingCommentId(commentId)
                            setProjectEditingCommentDraft(comment.body)
                          }}
                        >
                          <Text style={styles.inlineSaveText}>
                            {translate('m.tasks.0614a095ba', 'Edit')}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={styles.inlineSaveButtonCompact}
                          disabled={projectMutating}
                          onPress={() => void deleteProjectRowComment(projectRowItem, comment)}
                        >
                          <Text style={styles.inlineDeleteText}>
                            {translate('m.tasks.3151cad2a8', 'Delete')}
                          </Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            )
          }

          return (
            <View key={groupId} style={styles.commentThreadGroup}>
              {group.kind === 'thread'
                ? [
                    renderProjectComment(group.root),
                    ...group.replies.map((reply) => renderProjectComment(reply, { nested: true }))
                  ]
                : renderProjectComment(group.comment)}
            </View>
          )
        })
      )}
      {renderCommentComposer({
        value: projectCommentDraft,
        onChangeText: setProjectCommentDraft,
        disabled: projectMutating,
        onSubmit: () => void addProjectRowComment(projectRowItem)
      })}
    </View>
  ) : null
}
