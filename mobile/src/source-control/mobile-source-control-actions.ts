import type { MobileGitUpstreamStatus } from './mobile-git-status'
import { translate } from '../i18n/i18n'

// Icon identifier resolved to a lucide component by the screen. Kept as a string
// here so this module stays free of the native lucide import and unit-testable.
export type MobileSourceControlActionIcon =
  | 'commit'
  | 'push'
  | 'pull'
  | 'sync'
  | 'fetch'
  | 'publish'
  | 'rebase'
  | 'pr'
  | 'branch'
  | 'history'

export type MobileSourceControlAction = {
  label: string
  iconKey: MobileSourceControlActionIcon
  disabled?: boolean
  hint?: string
  loading?: boolean
  skipAutoClose?: boolean
  onPress: () => void
}

export type MobileSourceControlActionArgs = {
  commitMessage: string
  stagedCount: number
  upstream: MobileGitUpstreamStatus | null
  upstreamKnown: boolean
  busyAction: string | null
  openingPath: string | null
  openingBranchPath: string | null
  prAvailable: boolean
  handlers: {
    commit: () => void
    commitPush: () => void
    commitSync: () => void
    push: () => void
    pull: () => void
    sync: () => void
    fetch: () => void
    publish: () => void
    fastForward: () => void
    rebase: () => void
    createPr: () => void
    pushAndCreatePr: () => void
    checkout: () => void
    history: () => void
  }
}

// Builds the source-control bottom-sheet action list. Pure (no hooks) so it can
// be unit-tested and keeps the screen file lean. Enable/disable rules mirror the
// desktop primary-action gating.
export function buildMobileSourceControlActions(
  args: MobileSourceControlActionArgs
): MobileSourceControlAction[] {
  const { commitMessage, stagedCount, upstream, upstreamKnown, handlers } = args
  const hasMessage = commitMessage.trim().length > 0
  const hasStaged = stagedCount > 0
  const hasUpstream = upstream?.hasUpstream === true
  const ahead = upstream?.ahead ?? 0
  const behind = upstream?.behind ?? 0
  const busy =
    args.busyAction !== null || args.openingPath !== null || args.openingBranchPath !== null
  const commitHint = !hasStaged
    ? 'Stage at least one file'
    : !hasMessage
      ? 'Enter a commit message'
      : undefined
  const remoteHint = !upstreamKnown
    ? 'Checking branch status...'
    : hasUpstream
      ? undefined
      : 'Publish Branch first'
  const prHint = !upstreamKnown
    ? 'Checking branch status...'
    : !args.prAvailable
      ? 'Pull requests are not available for this repo'
      : undefined

  return [
    {
      label: translate(
        'auto.mobile.src.source.control.mobile.source.control.actions.fd2ae6e099',
        'Commit'
      ),
      iconKey: 'commit',
      disabled: busy || !!commitHint,
      hint: commitHint,
      loading: args.busyAction === 'commit',
      skipAutoClose: true,
      onPress: handlers.commit
    },
    {
      label: translate(
        'auto.mobile.src.source.control.mobile.source.control.actions.e29538cd3a',
        'Commit & Push'
      ),
      iconKey: 'push',
      disabled: busy || !!commitHint || !upstreamKnown || !hasUpstream,
      hint: commitHint ?? remoteHint,
      loading: args.busyAction === 'commit-push',
      skipAutoClose: true,
      onPress: handlers.commitPush
    },
    {
      label: translate(
        'auto.mobile.src.source.control.mobile.source.control.actions.645c339d48',
        'Commit & Sync'
      ),
      iconKey: 'sync',
      disabled: busy || !!commitHint || !upstreamKnown || !hasUpstream || behind === 0,
      hint:
        commitHint ??
        (!upstreamKnown || !hasUpstream
          ? remoteHint
          : behind === 0
            ? 'Nothing to pull'
            : undefined),
      loading: args.busyAction === 'commit-sync',
      skipAutoClose: true,
      onPress: handlers.commitSync
    },
    {
      label:
        ahead > 0
          ? translate(
              'auto.mobile.src.source.control.mobile.source.control.actions.dc5665ae76',
              'Push ({{value0}})',
              { value0: ahead }
            )
          : translate(
              'auto.mobile.src.source.control.mobile.source.control.actions.7816735a4c',
              'Push'
            ),
      iconKey: 'push',
      disabled: busy || !upstreamKnown || !hasUpstream || ahead === 0,
      hint: !hasUpstream ? remoteHint : ahead === 0 ? 'Nothing to push' : undefined,
      loading: args.busyAction === 'push',
      skipAutoClose: true,
      onPress: handlers.push
    },
    {
      label: translate(
        'auto.mobile.src.source.control.mobile.source.control.actions.220b608641',
        'Create PR'
      ),
      iconKey: 'pr',
      disabled: busy || !args.prAvailable,
      hint: prHint,
      loading: args.busyAction === 'create-pr',
      skipAutoClose: true,
      onPress: handlers.createPr
    },
    {
      label: translate(
        'auto.mobile.src.source.control.mobile.source.control.actions.fcfab9104c',
        'Push & Create PR'
      ),
      iconKey: 'pr',
      disabled: busy || !upstreamKnown || !hasUpstream || ahead === 0 || !args.prAvailable,
      hint: prHint ?? (!hasUpstream ? remoteHint : undefined),
      loading: args.busyAction === 'push-create-pr',
      skipAutoClose: true,
      onPress: handlers.pushAndCreatePr
    },
    {
      label:
        behind > 0
          ? translate(
              'auto.mobile.src.source.control.mobile.source.control.actions.4a36a2e93d',
              'Pull ({{value0}})',
              { value0: behind }
            )
          : translate(
              'auto.mobile.src.source.control.mobile.source.control.actions.d29181a724',
              'Pull'
            ),
      iconKey: 'pull',
      disabled: busy || !upstreamKnown || !hasUpstream || behind === 0,
      hint: !hasUpstream ? remoteHint : behind === 0 ? 'Nothing to pull' : undefined,
      loading: args.busyAction === 'pull',
      skipAutoClose: true,
      onPress: handlers.pull
    },
    {
      label:
        ahead > 0 || behind > 0
          ? translate(
              'auto.mobile.src.source.control.mobile.source.control.actions.c2b72fb417',
              'Sync (↓{{value0}} ↑{{value1}})',
              { value0: behind, value1: ahead }
            )
          : translate(
              'auto.mobile.src.source.control.mobile.source.control.actions.3741e930c8',
              'Sync'
            ),
      iconKey: 'sync',
      disabled: busy || !upstreamKnown || !hasUpstream || (ahead === 0 && behind === 0),
      hint:
        !upstreamKnown || !hasUpstream
          ? remoteHint
          : ahead === 0 && behind === 0
            ? 'Branch is up to date'
            : undefined,
      loading: args.busyAction === 'sync',
      skipAutoClose: true,
      onPress: handlers.sync
    },
    {
      label: translate(
        'auto.mobile.src.source.control.mobile.source.control.actions.ddb96ca5ef',
        'Fetch'
      ),
      iconKey: 'fetch',
      disabled: busy,
      loading: args.busyAction === 'fetch',
      skipAutoClose: true,
      onPress: handlers.fetch
    },
    {
      label: translate(
        'auto.mobile.src.source.control.mobile.source.control.actions.aff30f4611',
        'Publish Branch'
      ),
      iconKey: 'publish',
      disabled: busy || !upstreamKnown || hasUpstream,
      hint: !upstreamKnown
        ? 'Checking branch status...'
        : hasUpstream
          ? 'Branch is already published'
          : undefined,
      loading: args.busyAction === 'publish',
      skipAutoClose: true,
      onPress: handlers.publish
    },
    {
      label:
        behind > 0
          ? translate(
              'auto.mobile.src.source.control.mobile.source.control.actions.6b59363e25',
              'Fast-forward ({{value0}})',
              { value0: behind }
            )
          : translate(
              'auto.mobile.src.source.control.mobile.source.control.actions.7e9ff9a63a',
              'Fast-forward'
            ),
      iconKey: 'pull',
      disabled: busy || !upstreamKnown || !hasUpstream || behind === 0 || ahead > 0,
      hint: !hasUpstream
        ? remoteHint
        : behind === 0
          ? 'Nothing to fast-forward'
          : ahead > 0
            ? 'Local commits would be lost; pull instead'
            : undefined,
      loading: args.busyAction === 'fast-forward',
      skipAutoClose: true,
      onPress: handlers.fastForward
    },
    {
      label: translate(
        'auto.mobile.src.source.control.mobile.source.control.actions.9ed8a4d7d4',
        'Rebase onto base'
      ),
      iconKey: 'branch',
      disabled: busy,
      loading: args.busyAction === 'rebase',
      skipAutoClose: true,
      onPress: handlers.rebase
    },
    {
      label: translate(
        'auto.mobile.src.source.control.mobile.source.control.actions.6ce7379d43',
        'Switch branch'
      ),
      iconKey: 'branch',
      disabled: busy,
      skipAutoClose: true,
      onPress: handlers.checkout
    },
    {
      label: translate(
        'auto.mobile.src.source.control.mobile.source.control.actions.863b36001e',
        'Commits'
      ),
      iconKey: 'history',
      disabled: busy,
      onPress: handlers.history
    }
  ]
}
