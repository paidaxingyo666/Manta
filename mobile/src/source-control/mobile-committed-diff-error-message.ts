import { translate } from '../i18n/i18n'

// Kept out of use-mobile-source-control-openers.ts, which is upstream's and sits at its line budget.
export function committedDiffErrorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : translate('m.use.mobile.source.control.openers.ce788bc1c9', 'Unable to load committed diff')
}
