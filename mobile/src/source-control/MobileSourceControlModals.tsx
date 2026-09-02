import { ActionSheetModal, type ActionSheetAction } from '../components/ActionSheetModal'
import { ConfirmModal } from '../components/ConfirmModal'
import { PickerModal } from '../components/PickerModal'
import { openMobilePrUrl } from '../components/mobile-pr-url'
import { MobileBranchDiffPreviewDrawer } from './MobileBranchDiffPreviewDrawer'
import type { MobileSourceControlState } from './use-mobile-source-control-state'
import { translate } from '../i18n/i18n'

type Props = {
  state: MobileSourceControlState
  actionSheetActions: ActionSheetAction[]
}

export function MobileSourceControlModals({ state, actionSheetActions }: Props) {
  const {
    branchDiffPreview,
    setBranchDiffPreview,
    showActionSheet,
    setShowActionSheet,
    discardTarget,
    setDiscardTarget,
    showBranchPicker,
    setShowBranchPicker,
    localBranches,
    createdPrUrl,
    setCreatedPrUrl,
    createdPrWarning,
    setCreatedPrWarning,
    branchLabel,
    checkoutBranch,
    runGitAction
  } = state

  return (
    <>
      <MobileBranchDiffPreviewDrawer
        branchDiffPreview={branchDiffPreview}
        onClose={() => setBranchDiffPreview(null)}
      />

      <ActionSheetModal
        visible={showActionSheet}
        title={translate('m.MobileSourceControlModals.ee9e97d02d', 'Source Control')}
        message={branchLabel}
        actions={actionSheetActions}
        onClose={() => setShowActionSheet(false)}
      />

      <ConfirmModal
        visible={discardTarget !== null}
        title={translate('m.MobileSourceControlModals.ec8328b4c0', 'Discard Change')}
        message={
          discardTarget
            ? translate(
                'm.MobileSourceControlModals.3a1edc1216',
                'Discard changes to "{{value0}}"? This cannot be undone.',
                { value0: discardTarget.path }
              )
            : undefined
        }
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          if (discardTarget) {
            void runGitAction(`discard:${discardTarget.path}`, 'git.discard', {
              filePath: discardTarget.path
            })
          }
          // Modal visibility is derived from discardTarget — clear it so it dismisses.
          setDiscardTarget(null)
        }}
        onCancel={() => setDiscardTarget(null)}
      />

      <PickerModal
        visible={showBranchPicker}
        title={translate('m.MobileSourceControlModals.9fd503168a', 'Switch Branch')}
        options={(localBranches?.branches ?? []).map((b) => ({
          value: b,
          label: b,
          subtitle:
            b === localBranches?.current
              ? translate('m.MobileSourceControlModals.daddec884e', 'current')
              : undefined
        }))}
        selected={localBranches?.current ?? ''}
        onSelect={(branch) => {
          if (branch !== localBranches?.current) {
            void checkoutBranch(branch)
          } else {
            setShowBranchPicker(false)
          }
        }}
        onClose={() => setShowBranchPicker(false)}
      />

      <ConfirmModal
        visible={createdPrUrl !== null}
        title={translate('m.MobileSourceControlModals.e04f3405ee', 'Pull Request Created')}
        message={
          createdPrWarning
            ? translate(
                'm.MobileSourceControlModals.f38a7042c6.25031a',
                'Open it in your browser?\n\n{{value0}}',
                { value0: createdPrWarning }
              )
            : translate('m.MobileSourceControlModals.f38a7042c6.b451aa', 'Open it in your browser?')
        }
        confirmLabel="Open"
        onConfirm={() => {
          if (createdPrUrl) {
            openMobilePrUrl(createdPrUrl)
          }
          setCreatedPrUrl(null)
          setCreatedPrWarning(null)
        }}
        onCancel={() => {
          setCreatedPrUrl(null)
          setCreatedPrWarning(null)
        }}
      />
    </>
  )
}
