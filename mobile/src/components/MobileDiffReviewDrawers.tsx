import { useMemo } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native'
import { Check, Copy, FileText, Plus, Send, Trash2, X } from 'lucide-react-native'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import { colors } from '../theme/mobile-theme'
import type { ActionSheetAction } from './ActionSheetModal'
import { ActionSheetModal } from './ActionSheetModal'
import { BottomDrawer } from './BottomDrawer'
import { ConfirmModal } from './ConfirmModal'
import { mobileReviewCountLabel } from '../session/mobile-diff-review-screen-model'
import type { useMobileDiffReviewController } from '../session/use-mobile-diff-review-controller'
import { mobileDiffReviewStyles as styles } from './mobile-diff-review-screen-styles'
import { translate } from '../i18n/i18n'

type Props = {
  controller: ReturnType<typeof useMobileDiffReviewController>
}

export function MobileDiffReviewDrawers({ controller }: Props) {
  const sendActions = useSendActions(controller)
  const overflowActions = useOverflowActions(controller)
  return (
    <>
      <ActionSheetModal
        visible={controller.showOverflow}
        title={translate(
          'auto.mobile.src.components.MobileDiffReviewDrawers.a0254e034c',
          'Review Actions'
        )}
        message={
          controller.reviewedUnstagedCount > 0
            ? translate(
                'auto.mobile.src.components.MobileDiffReviewDrawers.fd30ae34a4',
                '{{value0}} reviewed unstaged files can be staged',
                { value0: controller.reviewedUnstagedCount }
              )
            : undefined
        }
        actions={overflowActions}
        onClose={() => controller.setShowOverflow(false)}
      />
      <ActionSheetModal
        visible={controller.sendSheet !== null}
        title={translate(
          'auto.mobile.src.components.MobileDiffReviewDrawers.be82c13305',
          'Send Notes'
        )}
        message={sendSheetMessage(controller)}
        actions={sendActions}
        onClose={() => controller.setSendSheet(null)}
      />
      <ConfirmModal
        visible={controller.discardTarget !== null}
        title={translate(
          'auto.mobile.src.components.MobileDiffReviewDrawers.d55f01e697',
          'Discard File'
        )}
        message={
          controller.discardTarget
            ? translate(
                'auto.mobile.src.components.MobileDiffReviewDrawers.6a3716a622',
                'Discard changes to "{{value0}}"? This cannot be undone.',
                { value0: controller.discardTarget.filePath }
              )
            : undefined
        }
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          const target = controller.discardTarget
          controller.setDiscardTarget(null)
          if (target) {
            void controller.runGitMutation('git.discard', target)
          }
        }}
        onCancel={() => controller.setDiscardTarget(null)}
      />
      <NoteComposerDrawer controller={controller} />
      <CompletionDrawer controller={controller} />
    </>
  )
}

function useSendActions(controller: ReturnType<typeof useMobileDiffReviewController>) {
  return useMemo<ActionSheetAction[]>(() => {
    const comments = controller.unsentComments
    const terminalActions =
      controller.sendSheet?.kind === 'ready' || controller.sendSheet?.kind === 'error'
        ? controller.sendSheet.terminals.map((terminal) => ({
            label: `${terminal.title || 'Terminal'} (${terminal.terminal.slice(0, 6)})`,
            icon: Send,
            disabled: comments.length === 0,
            skipAutoClose: true,
            onPress: () => void controller.sendPromptToTerminal(terminal.terminal, comments)
          }))
        : []
    return [
      ...terminalActions,
      {
        label: translate(
          'auto.mobile.src.components.MobileDiffReviewDrawers.aa58d9c0d7',
          'New Agent Session'
        ),
        icon: Plus,
        disabled: comments.length === 0,
        skipAutoClose: true,
        onPress: () => void controller.createTerminalAndSend(comments)
      },
      {
        label: translate(
          'auto.mobile.src.components.MobileDiffReviewDrawers.48682ededf',
          'Copy Notes'
        ),
        icon: Copy,
        disabled:
          controller.screenState.kind !== 'ready' || controller.screenState.comments.length === 0,
        onPress: () => void controller.copyNotes()
      }
    ]
  }, [controller])
}

function useOverflowActions(controller: ReturnType<typeof useMobileDiffReviewController>) {
  return useMemo<ActionSheetAction[]>(
    () => [
      {
        label: translate(
          'auto.mobile.src.components.MobileDiffReviewDrawers.48682ededf',
          'Copy Notes'
        ),
        icon: Copy,
        disabled:
          controller.screenState.kind !== 'ready' || controller.screenState.comments.length === 0,
        onPress: () => void controller.copyNotes()
      },
      {
        label: translate(
          'auto.mobile.src.components.MobileDiffReviewDrawers.6dba03733e',
          'Send Unsent Notes'
        ),
        icon: Send,
        disabled: controller.unsentComments.length === 0,
        skipAutoClose: true,
        onPress: () => void controller.openSendSheet()
      },
      {
        label: translate(
          'auto.mobile.src.components.MobileDiffReviewDrawers.00c9fda7a7',
          'Clear Sent Notes'
        ),
        icon: Trash2,
        disabled:
          controller.screenState.kind !== 'ready' ||
          controller.screenState.comments.every((comment) => comment.sentAt === undefined),
        skipAutoClose: true,
        onPress: () => void controller.clearSentNotes()
      },
      {
        label: translate(
          'auto.mobile.src.components.MobileDiffReviewDrawers.f5848bd976',
          'Stage Reviewed Files'
        ),
        icon: Check,
        disabled: controller.reviewedUnstagedCount === 0 || controller.busyAction !== null,
        skipAutoClose: true,
        onPress: () => void controller.stageReviewedFiles()
      },
      {
        label: translate(
          'auto.mobile.src.components.MobileDiffReviewDrawers.9433a2e312',
          'Mark Unreviewed'
        ),
        icon: X,
        disabled:
          controller.screenState.kind !== 'ready' ||
          !controller.currentItem ||
          !controller.currentItem.isReviewed,
        skipAutoClose: true,
        onPress: () => void controller.markUnreviewed()
      },
      {
        label: translate(
          'auto.mobile.src.components.MobileDiffReviewDrawers.4323ecdb70',
          'Open in Session'
        ),
        icon: FileText,
        disabled: !controller.currentItem || controller.currentItem.scope === 'branch',
        onPress: () => void controller.openInSession()
      }
    ],
    [controller]
  )
}

function sendSheetMessage(
  controller: ReturnType<typeof useMobileDiffReviewController>
): string | undefined {
  return controller.sendSheet?.kind === 'loading'
    ? 'Loading agent sessions...'
    : controller.sendSheet?.kind === 'error'
      ? controller.sendSheet.message
      : `${controller.unsentComments.length} unsent notes`
}

function NoteComposerDrawer({ controller }: Props) {
  const composer = controller.composer
  return (
    <BottomDrawer visible={composer !== null} onClose={controller.closeComposer}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.composerHeader}>
          <View>
            <Text style={styles.drawerTitle}>
              {composer?.mode === 'edit'
                ? translate(
                    'auto.mobile.src.components.MobileDiffReviewDrawers.bd7f2108fc',
                    'Edit Note'
                  )
                : translate(
                    'auto.mobile.src.components.MobileDiffReviewDrawers.4aa499fc3e',
                    'Add Note'
                  )}
            </Text>
            <Text style={styles.drawerSubtitle}>
              {composer?.mode === 'create' && composer.lineNumber > 0
                ? translate(
                    'auto.mobile.src.components.MobileDiffReviewDrawers.62531e9326',
                    'Line {{value0}}',
                    { value0: composer.lineNumber }
                  )
                : translate(
                    'auto.mobile.src.components.MobileDiffReviewDrawers.2b81315e3d',
                    'File note'
                  )}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
            onPress={controller.closeComposer}
            accessibilityRole="button"
            accessibilityLabel="Cancel note"
          >
            <X size={18} color={colors.textPrimary} strokeWidth={2.2} />
          </Pressable>
        </View>
        <TextInput
          style={styles.composerInput}
          value={controller.composerBody}
          onChangeText={controller.setComposerBody}
          multiline
          autoFocus
          placeholder={translate(
            'auto.mobile.src.components.MobileDiffReviewDrawers.da5c2e1037',
            'Review note'
          )}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={composerLabel(composer)}
        />
        <View style={styles.drawerButtonRow}>
          {composer?.mode === 'edit' ? (
            <DeleteNoteButton onPress={controller.deleteComment} />
          ) : null}
          <SaveNoteButton controller={controller} composer={composer} />
        </View>
      </KeyboardAvoidingView>
    </BottomDrawer>
  )
}

function composerLabel(
  composer: { mode: 'create'; lineNumber: number } | { mode: 'edit'; comment: DiffComment } | null
): string {
  return composer?.mode === 'create' && composer.lineNumber > 0
    ? `Save note on line ${composer.lineNumber}`
    : 'Review note'
}

function DeleteNoteButton({ onPress }: { onPress: () => Promise<void> }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
      onPress={() => void onPress()}
      accessibilityRole="button"
      accessibilityLabel="Delete note"
    >
      <Trash2 size={14} color={colors.statusRed} strokeWidth={2.2} />
      <Text style={styles.destructiveText}>
        {translate('auto.mobile.src.components.MobileDiffReviewDrawers.f9b4e81fd2', 'Delete')}
      </Text>
    </Pressable>
  )
}

function SaveNoteButton({
  controller,
  composer
}: {
  controller: ReturnType<typeof useMobileDiffReviewController>
  composer: ReturnType<typeof useMobileDiffReviewController>['composer']
}) {
  const disabled = controller.composerBody.trim().length === 0
  return (
    <Pressable
      style={({ pressed }) => [
        styles.primaryButton,
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed
      ]}
      disabled={disabled}
      onPress={() => void controller.saveComposer()}
      accessibilityRole="button"
      accessibilityLabel={composerLabel(composer)}
    >
      <Check size={14} color={colors.bgBase} strokeWidth={2.2} />
      <Text style={styles.primaryButtonText}>
        {translate('auto.mobile.src.components.MobileDiffReviewDrawers.96cfded20f', 'Save')}
      </Text>
    </Pressable>
  )
}

function CompletionDrawer({ controller }: Props) {
  const noteCount =
    controller.screenState.kind === 'ready' ? controller.screenState.comments.length : 0
  return (
    <BottomDrawer
      visible={controller.showCompletion}
      onClose={() => controller.setShowCompletion(false)}
    >
      <Text style={styles.drawerTitle}>
        {translate(
          'auto.mobile.src.components.MobileDiffReviewDrawers.76eee4075f',
          'Review Complete'
        )}
      </Text>
      <Text style={styles.drawerSubtitle}>
        {mobileReviewCountLabel(controller.queue.length, 'file', 'files')}{' '}
        {translate('auto.mobile.src.components.MobileDiffReviewDrawers.5a7dd35bb7', 'reviewed,')}{' '}
        {mobileReviewCountLabel(noteCount, 'note', 'notes')}
      </Text>
      <View style={styles.drawerButtonRow}>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
          disabled={controller.reviewedUnstagedCount === 0}
          onPress={() => void controller.stageReviewedFiles()}
          accessibilityRole="button"
          accessibilityLabel="Stage reviewed files"
        >
          <Check size={14} color={colors.textSecondary} strokeWidth={2.2} />
          <Text style={styles.secondaryButtonText}>
            {translate(
              'auto.mobile.src.components.MobileDiffReviewDrawers.6b58620851',
              'Stage Reviewed'
            )}
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          disabled={controller.unsentComments.length === 0}
          onPress={() => void controller.openSendSheet()}
          accessibilityRole="button"
          accessibilityLabel="Send notes to agent"
        >
          <Send size={14} color={colors.bgBase} strokeWidth={2.2} />
          <Text style={styles.primaryButtonText}>
            {translate(
              'auto.mobile.src.components.MobileDiffReviewDrawers.be82c13305',
              'Send Notes'
            )}
          </Text>
        </Pressable>
      </View>
    </BottomDrawer>
  )
}
