import { useMemo } from 'react'
import { KeyboardAvoidingView, Pressable, Text, TextInput, View } from 'react-native'
import { Check, Copy, FileText, Plus, Send, Trash2, X } from 'lucide-react-native'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import { colors } from '../theme/mobile-theme'
import type { ActionSheetAction } from './ActionSheetModal'
import { ActionSheetContent } from './ActionSheetModal'
import { ConfirmContent } from './ConfirmModal'
import { KeyedBottomDrawer } from './keyed-bottom-drawer'
import { AGENT_LAUNCH_STATUS_UNREADABLE_MESSAGE } from '../session/mobile-existing-agent-launch'
import {
  mobileReviewCountLabel,
  type ComposerState,
  type SendSheetState
} from '../session/mobile-diff-review-screen-model'
import { reviewSheetKey, type ReviewSheet } from '../session/mobile-diff-review-sheets'
import type { useMobileDiffReviewController } from '../session/use-mobile-diff-review-controller'
import { mobileDiffReviewStyles as styles } from './mobile-diff-review-screen-styles'
import { hostOs } from '../platform/host-os'
import { translate } from '../i18n/i18n'

type Props = {
  controller: ReturnType<typeof useMobileDiffReviewController>
}

export function MobileDiffReviewDrawers({ controller }: Props) {
  // One drawer for every review sheet: iOS cannot present a sheet while another is still closing.
  return (
    <KeyedBottomDrawer
      sheet={controller.sheet}
      sheetKey={reviewSheetKey}
      onClose={(presented) => controller.closeSheet(presented.kind)}
    >
      {(presented) => <ReviewSheetContent controller={controller} sheet={presented} />}
    </KeyedBottomDrawer>
  )
}

function ReviewSheetContent({ controller, sheet }: Props & { sheet: ReviewSheet }) {
  switch (sheet.kind) {
    case 'actions':
      return <ReviewActionsContent controller={controller} />
    case 'send':
      return <SendNotesContent controller={controller} load={sheet.load} />
    case 'discard':
      return (
        <ConfirmContent
          title={translate('m.MobileDiffReviewDrawers.d55f01e697', 'Discard File')}
          message={translate(
            'm.MobileDiffReviewDrawers.6a3716a622',
            'Discard changes to "{{value0}}"? This cannot be undone.',
            { value0: sheet.target.filePath }
          )}
          confirmLabel="Discard"
          destructive
          onConfirm={() => {
            controller.closeSheet('discard')
            void controller.runGitMutation('git.discard', sheet.target)
          }}
          onCancel={() => controller.closeSheet('discard')}
        />
      )
    case 'composer':
      return <NoteComposerContent controller={controller} composer={sheet.composer} />
    case 'completion':
      return <CompletionContent controller={controller} />
  }
}

function ReviewActionsContent({ controller }: Props) {
  const overflowActions = useOverflowActions(controller)
  return (
    <ActionSheetContent
      title={translate('m.MobileDiffReviewDrawers.a0254e034c', 'Review Actions')}
      message={
        controller.reviewedUnstagedCount > 0
          ? translate(
              'm.MobileDiffReviewDrawers.fd30ae34a4',
              '{{value0}} reviewed unstaged files can be staged',
              { value0: controller.reviewedUnstagedCount }
            )
          : undefined
      }
      actions={overflowActions}
      onClose={() => controller.closeSheet('actions')}
    />
  )
}

function SendNotesContent({ controller, load }: Props & { load: SendSheetState }) {
  const sendActions = useSendActions(controller, load)
  return (
    <ActionSheetContent
      title={translate('m.MobileDiffReviewDrawers.be82c13305', 'Send Notes')}
      message={sendSheetMessage(controller, load)}
      actions={sendActions}
      onClose={() => controller.closeSheet('send')}
    />
  )
}

function useSendActions(
  controller: ReturnType<typeof useMobileDiffReviewController>,
  load: SendSheetState
) {
  return useMemo<ActionSheetAction[]>(() => {
    const comments = controller.unsentComments
    const terminalActions =
      load.kind === 'ready' || load.kind === 'error'
        ? load.terminals.map((terminal) => ({
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
        label: translate('m.MobileDiffReviewDrawers.aa58d9c0d7', 'New Agent Session'),
        icon: Plus,
        disabled: comments.length === 0 || controller.agentLaunchAvailability !== 'available',
        ...(controller.agentLaunchAvailability === 'update-required'
          ? { hint: 'Update Manta on your computer' }
          : controller.agentLaunchAvailability === 'unverified'
            ? { hint: AGENT_LAUNCH_STATUS_UNREADABLE_MESSAGE }
            : {}),
        skipAutoClose: true,
        onPress: () => void controller.createTerminalAndSend(comments)
      },
      {
        label: translate('m.MobileDiffReviewDrawers.48682ededf', 'Copy Notes'),
        icon: Copy,
        disabled:
          controller.screenState.kind !== 'ready' || controller.screenState.comments.length === 0,
        onPress: () => void controller.copyNotes()
      }
    ]
  }, [controller, load])
}

function useOverflowActions(controller: ReturnType<typeof useMobileDiffReviewController>) {
  return useMemo<ActionSheetAction[]>(
    () => [
      {
        label: translate('m.MobileDiffReviewDrawers.48682ededf', 'Copy Notes'),
        icon: Copy,
        disabled:
          controller.screenState.kind !== 'ready' || controller.screenState.comments.length === 0,
        onPress: () => void controller.copyNotes()
      },
      {
        label: translate('m.MobileDiffReviewDrawers.6dba03733e', 'Send Unsent Notes'),
        icon: Send,
        disabled: controller.unsentComments.length === 0,
        onPress: () => void controller.openSendSheet()
      },
      {
        label: translate('m.MobileDiffReviewDrawers.00c9fda7a7', 'Clear Sent Notes'),
        icon: Trash2,
        disabled:
          controller.screenState.kind !== 'ready' ||
          controller.screenState.comments.every((comment) => comment.sentAt === undefined),
        skipAutoClose: true,
        onPress: () => void controller.clearSentNotes()
      },
      {
        label: translate('m.MobileDiffReviewDrawers.f5848bd976', 'Stage Reviewed Files'),
        icon: Check,
        disabled: controller.reviewedUnstagedCount === 0 || controller.busyAction !== null,
        skipAutoClose: true,
        onPress: () => void controller.stageReviewedFiles()
      },
      {
        label: translate('m.MobileDiffReviewDrawers.9433a2e312', 'Mark Unreviewed'),
        icon: X,
        disabled:
          controller.screenState.kind !== 'ready' ||
          !controller.currentItem ||
          !controller.currentItem.isReviewed,
        skipAutoClose: true,
        onPress: () => void controller.markUnreviewed()
      },
      {
        label: translate('m.MobileDiffReviewDrawers.4323ecdb70', 'Open in Session'),
        icon: FileText,
        disabled: !controller.currentItem || controller.currentItem.scope === 'branch',
        onPress: () => void controller.openInSession()
      }
    ],
    [controller]
  )
}

function sendSheetMessage(
  controller: ReturnType<typeof useMobileDiffReviewController>,
  load: SendSheetState
): string | undefined {
  return load.kind === 'loading'
    ? 'Loading agent sessions...'
    : load.kind === 'error'
      ? load.message
      : `${controller.unsentComments.length} unsent notes`
}

function NoteComposerContent({ controller, composer }: Props & { composer: ComposerState }) {
  return (
    <KeyboardAvoidingView behavior={hostOs() === 'ios' ? 'padding' : undefined}>
      <View style={styles.composerHeader}>
        <View>
          <Text style={styles.drawerTitle}>
            {composer.mode === 'edit'
              ? translate('m.MobileDiffReviewDrawers.bd7f2108fc', 'Edit Note')
              : translate('m.MobileDiffReviewDrawers.4aa499fc3e', 'Add Note')}
          </Text>
          <Text style={styles.drawerSubtitle}>
            {composer.mode === 'create' && composer.lineNumber > 0
              ? translate('m.MobileDiffReviewDrawers.62531e9326', 'Line {{value0}}', {
                  value0: composer.lineNumber
                })
              : translate('m.MobileDiffReviewDrawers.2b81315e3d', 'File note')}
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
        placeholder={translate('m.MobileDiffReviewDrawers.da5c2e1037', 'Review note')}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={composerLabel(composer)}
      />
      <View style={styles.drawerButtonRow}>
        {composer.mode === 'edit' ? <DeleteNoteButton onPress={controller.deleteComment} /> : null}
        <SaveNoteButton controller={controller} composer={composer} />
      </View>
    </KeyboardAvoidingView>
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
        {translate('m.MobileDiffReviewDrawers.f9b4e81fd2', 'Delete')}
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
        {translate('m.MobileDiffReviewDrawers.96cfded20f', 'Save')}
      </Text>
    </Pressable>
  )
}

function CompletionContent({ controller }: Props) {
  const noteCount =
    controller.screenState.kind === 'ready' ? controller.screenState.comments.length : 0
  return (
    <>
      <Text style={styles.drawerTitle}>
        {translate('m.MobileDiffReviewDrawers.76eee4075f', 'Review Complete')}
      </Text>
      <Text style={styles.drawerSubtitle}>
        {mobileReviewCountLabel(controller.queue.length, 'file', 'files')}{' '}
        {translate('m.MobileDiffReviewDrawers.5a7dd35bb7', 'reviewed,')}{' '}
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
            {translate('m.MobileDiffReviewDrawers.6b58620851', 'Stage Reviewed')}
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
            {translate('m.MobileDiffReviewDrawers.be82c13305', 'Send Notes')}
          </Text>
        </Pressable>
      </View>
    </>
  )
}
