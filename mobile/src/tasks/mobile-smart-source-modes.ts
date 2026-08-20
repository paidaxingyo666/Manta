import type { MrStateFilter, SmartNameMode } from './mobile-composer-source-types'
import { localizedConstant } from '../i18n/localized-constant'
import { translate } from '../i18n/i18n'

// Icon each tab renders: lucide glyphs for the neutral modes, the inline brand
// SVGs (TaskProviderLogo) for the provider modes since lucide dropped its brand
// icons.
export type SmartModeIcon =
  | { type: 'lucide'; name: 'sparkles' | 'git-branch' | 'case-sensitive' }
  | { type: 'provider'; provider: 'github' | 'gitlab' | 'linear' }

export type SmartModeOption = {
  id: SmartNameMode
  label: string
  icon: SmartModeIcon
}

// Order + labels + icons mirror desktop getSmartWorkspaceNameModes():
// Smart · GitHub · Linear · GitLab · Branch · Name.
export const smartModeOptions = localizedConstant((): readonly SmartModeOption[] => [
  {
    id: 'smart',
    label: translate('m.mobile.smart.source.modes.d0641cca38', 'Smart'),
    icon: { type: 'lucide', name: 'sparkles' }
  },
  {
    id: 'github',
    label: translate('m.mobile.smart.source.modes.7cb8a31492', 'GitHub'),
    icon: { type: 'provider', provider: 'github' }
  },
  {
    id: 'linear',
    label: translate('m.mobile.smart.source.modes.8fa1fe641f', 'Linear'),
    icon: { type: 'provider', provider: 'linear' }
  },
  {
    id: 'gitlab',
    label: translate('m.mobile.smart.source.modes.24441a2f23', 'GitLab'),
    icon: { type: 'provider', provider: 'gitlab' }
  },
  {
    id: 'branches',
    label: translate('m.mobile.smart.source.modes.79f98b1f11', 'Branch'),
    icon: { type: 'lucide', name: 'git-branch' }
  },
  {
    id: 'text',
    label: translate('m.mobile.smart.source.modes.fcd871a51c', 'Name'),
    icon: { type: 'lucide', name: 'case-sensitive' }
  }
])

export type SmartModeAvailabilityInput = {
  textOnly: boolean
  tasksSupported: boolean
  hasRepo: boolean
  githubAvailable: boolean
  gitlabAvailable: boolean
  linearAvailable: boolean
}

// Faithful port of the desktop availableModes filter. Non-git repos collapse to
// the Name tab; provider tabs gate on availability + a selected repo + the tasks
// RPC surface; branches only need a git repo (new-branch-by-name works without
// the search capability).
export function resolveAvailableSmartModes(input: SmartModeAvailabilityInput): SmartNameMode[] {
  if (input.textOnly) {
    return ['text']
  }
  return smartModeOptions()
    .filter((option) => {
      switch (option.id) {
        case 'smart':
          return input.tasksSupported
        case 'github':
          return input.tasksSupported && input.hasRepo && input.githubAvailable
        case 'gitlab':
          return input.tasksSupported && input.hasRepo && input.gitlabAvailable
        case 'linear':
          return input.tasksSupported && input.linearAvailable
        case 'branches':
          return input.hasRepo
        case 'text':
          return true
      }
    })
    .map((option) => option.id)
}

// Default mode when the picker opens: 'smart' for a git repo when search is
// available, else the first available mode (branches for git without tasks,
// 'text' for non-git).
export function resolveDefaultSmartMode(input: SmartModeAvailabilityInput): SmartNameMode {
  const available = resolveAvailableSmartModes(input)
  if (available.includes('smart')) {
    return 'smart'
  }
  return available[0] ?? 'text'
}

// Keeps a chosen mode valid as availability changes (e.g. the repo switches to a
// non-git folder), mirroring desktop's snap-to-available effect.
export function normalizeSmartMode(
  mode: SmartNameMode,
  input: SmartModeAvailabilityInput
): SmartNameMode {
  const available = resolveAvailableSmartModes(input)
  return available.includes(mode) ? mode : resolveDefaultSmartMode(input)
}

export type MrStateFilterOption = { id: MrStateFilter; label: string }

// Desktop getMrStateFilters(): Open · Merged · Closed · All, default 'opened'.
export const mrStateFilterOptions = localizedConstant((): readonly MrStateFilterOption[] => [
  {
    id: 'opened',
    label: translate('m.mobile.smart.source.modes.74645d977f', 'Open')
  },
  {
    id: 'merged',
    label: translate('m.mobile.smart.source.modes.b0a1529ab3', 'Merged')
  },
  {
    id: 'closed',
    label: translate('m.mobile.smart.source.modes.279e22747c', 'Closed')
  },
  {
    id: 'all',
    label: translate('m.mobile.smart.source.modes.2303084a84', 'All')
  }
])

export const DEFAULT_MR_STATE_FILTER: MrStateFilter = 'opened'
