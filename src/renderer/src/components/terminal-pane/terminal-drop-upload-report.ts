import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'

export function formatTerminalDropUploadingMessage(
  count: number,
  destination: 'runtime' | 'remote'
): string {
  const vars = { value0: count }
  if (destination === 'runtime') {
    return count === 1
      ? translate(
          'auto.components.terminal.pane.terminal.drop.handler.29c031b49a.e09913_one',
          'Uploading {{value0}} file to runtime…',
          vars
        )
      : translate(
          'auto.components.terminal.pane.terminal.drop.handler.29c031b49a.e09913_other',
          'Uploading {{value0}} files to runtime…',
          vars
        )
  }
  return count === 1
    ? translate(
        'auto.components.terminal.pane.terminal.drop.handler.29c031b49a.ac0575_one',
        'Uploading {{value0}} file to remote…',
        vars
      )
    : translate(
        'auto.components.terminal.pane.terminal.drop.handler.29c031b49a.ac0575_other',
        'Uploading {{value0}} files to remote…',
        vars
      )
}

export function reportTerminalDropUploadSkipsAndFailures(
  skipped: { reason: string }[],
  failed: { reason: string }[]
): void {
  if (skipped.length > 0) {
    // Why: symlink rejection is policy, not error. Mixed skips collapse to one
    // count so the terminal drop UI stays readable for multi-file drops.
    const symlinkCount = skipped.filter((s) => s.reason === 'symlink').length
    const vars = { value0: skipped.length }
    const one = skipped.length === 1
    toast.message(
      symlinkCount === skipped.length
        ? one
          ? translate(
              'auto.components.terminal.pane.terminal.drop.handler.53f015fd85_one',
              'Skipped {{value0}} symlink.',
              vars
            )
          : translate(
              'auto.components.terminal.pane.terminal.drop.handler.53f015fd85_other',
              'Skipped {{value0}} symlinks.',
              vars
            )
        : one
          ? translate(
              'auto.components.terminal.pane.terminal.drop.handler.b4cf68e889_one',
              'Skipped {{value0}} item.',
              vars
            )
          : translate(
              'auto.components.terminal.pane.terminal.drop.handler.b4cf68e889_other',
              'Skipped {{value0}} items.',
              vars
            )
    )
  }
  if (failed.length > 0) {
    const vars = { value0: failed.length }
    toast.error(
      failed.length === 1
        ? translate(
            'auto.components.terminal.pane.terminal.drop.handler.1e072f611e_one',
            'Failed to upload {{value0}} file.',
            vars
          )
        : translate(
            'auto.components.terminal.pane.terminal.drop.handler.1e072f611e_other',
            'Failed to upload {{value0}} files.',
            vars
          )
    )
  }
}
