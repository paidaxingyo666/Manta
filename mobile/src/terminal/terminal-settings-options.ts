/**
 * The terminal settings screen's option tables and the summaries derived from
 * them, split from the screen so its rendering reads as one flow. The tables
 * are lazily localized: building them at import would freeze English.
 */
import { localizedConstant } from '../i18n/localized-constant'
import { translate } from '../i18n/i18n'
import type { PickerOption } from '../components/PickerModal'

export type RestoreValue = 'indefinite' | '60s' | '5m' | '30m'
export type TextSizeValue = 'smallest' | 'smaller' | 'default' | 'large' | 'larger' | 'largest'

export const textSizeOptions = localizedConstant(
  (): (PickerOption<TextSizeValue> & { scale: number })[] => [
    {
      value: 'smallest',
      label: translate('m.terminal.settings.862a2e3353', 'Smallest (50%)'),
      scale: 0.5
    },
    {
      value: 'smaller',
      label: translate('m.terminal.settings.080b3ca143', 'Smaller (75%)'),
      scale: 0.75
    },
    {
      value: 'default',
      label: translate('m.terminal.settings.d0e28eb0a6', 'Default (100%)'),
      scale: 1
    },
    {
      value: 'large',
      label: translate('m.terminal.settings.1ea3fa201c', 'Large (125%)'),
      scale: 1.25
    },
    {
      value: 'larger',
      label: translate('m.terminal.settings.b409fcd6d6', 'Larger (150%)'),
      scale: 1.5
    },
    {
      value: 'largest',
      label: translate('m.terminal.settings.ef92abff6e', 'Largest (200%)'),
      scale: 2
    }
  ]
)

export function textSizeValueFromScale(scale: number): TextSizeValue {
  return textSizeOptions().find((o) => o.scale === scale)?.value ?? 'default'
}

export function textSizeSummary(scale: number): string {
  return (textSizeOptions().find((o) => o.scale === scale) ?? textSizeOptions()[0]!).label
}

export const autoRestoreFitOptions = localizedConstant(
  (): (PickerOption<RestoreValue> & { ms: number | null })[] => [
    {
      value: 'indefinite',
      label: translate('m.terminal.settings.aba5507191', 'Keep at phone size (default)'),
      ms: null
    },
    {
      value: '60s',
      label: translate('m.terminal.settings.80118eb022', 'After 1 minute'),
      ms: 60_000
    },
    {
      value: '5m',
      label: translate('m.terminal.settings.a761169918', 'After 5 minutes'),
      ms: 5 * 60_000
    },
    {
      value: '30m',
      label: translate('m.terminal.settings.ad4f6a76dd', 'After 30 minutes'),
      ms: 30 * 60_000
    }
  ]
)

export function valueFromMs(ms: number | null | undefined): RestoreValue {
  if (ms == null) {
    return 'indefinite'
  }
  const exact = autoRestoreFitOptions().find((o) => o.ms === ms)
  if (exact) {
    return exact.value
  }
  // Why: server may return a non-preset ms (custom value, future preset,
  // or server-side clamp). Snap to the closest finite preset so the
  // picker's selected radio agrees with the row sublabel rendered by
  // autoRestoreSummary ("After Xs").
  let closest: ReturnType<typeof autoRestoreFitOptions>[number] | null = null
  let bestDelta = Infinity
  for (const opt of autoRestoreFitOptions()) {
    if (opt.ms == null) {
      continue
    }
    const delta = Math.abs(opt.ms - ms)
    if (delta < bestDelta) {
      bestDelta = delta
      closest = opt
    }
  }
  return closest ? closest.value : 'indefinite'
}

export function autoRestoreSummary(ms: number | null | undefined): string {
  if (ms === undefined) {
    return '…'
  }
  if (ms === null) {
    return autoRestoreFitOptions()[0]!.label
  }
  const exact = autoRestoreFitOptions().find((o) => o.ms === ms)
  return exact ? exact.label : `After ${Math.round(ms / 1000)}s`
}
