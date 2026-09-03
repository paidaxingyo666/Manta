/**
 * A few lines saying what upstream changed, not a changelog.
 *
 * Release notes become the GitHub Release body and the in-app update card, so
 * they are read by someone deciding whether to install — a title, a sentence and
 * a handful of bullets. Rationale, tradeoffs and implementation stay in the
 * commits, which is where someone looking for them will go.
 */

// A conventional-commit scope names a subsystem; these are the ones worth
// naming in a release note, in the words a user would recognise.
const SCOPE_LABELS = new Map([
  ['ssh', 'SSH and remote hosts'],
  ['relay', 'Relay'],
  ['terminal', 'Terminal'],
  ['pty', 'Terminal'],
  ['native-chat', 'Native chat'],
  ['chat', 'Chat'],
  ['browser', 'Built-in browser'],
  ['git', 'Git'],
  ['worktree', 'Worktrees'],
  ['worktrees', 'Worktrees'],
  ['mobile', 'Mobile app'],
  ['updater', 'Updates'],
  ['win', 'Windows'],
  ['windows', 'Windows'],
  ['linux', 'Linux'],
  ['macos', 'macOS'],
  ['i18n', 'Localization'],
  ['editor', 'Editor'],
  ['skills', 'Skills'],
  ['runtime', 'Runtime'],
  ['startup', 'Startup'],
  ['codex', 'Codex'],
  ['claude', 'Claude']
])

const CONVENTIONAL = /^([a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/i
// The fork's own sync bookkeeping is not news to anyone installing this.
const FORK_BOOKKEEPING = /^(sync|chore\(release\)|chore\(sync\))[:(]/i

/**
 * @param entries [{ subject, upstream }] — commits since the previous release.
 *   `upstream` comes from the `Mirror-Of:` trailer the mirror stamps on every
 *   commit it replays, which is the only reliable way to tell upstream's work
 *   from the fork's: both use conventional commits, and the fork's own sync
 *   plumbing lands as `feat(sync)` and would otherwise be announced as news.
 * @param version the version being cut, e.g. 1.4.196-rc.0
 * @param upstreamBase upstream's stable release this picks up, e.g. 1.4.196
 */
export function draftReleaseNotes(entries, version, upstreamBase) {
  const usable = entries.filter((entry) => entry?.subject && !FORK_BOOKKEEPING.test(entry.subject))
  const fromUpstream = usable.filter((entry) => entry.upstream)
  // A release with no upstream commits is a fork-only fix; it still needs notes.
  const commits = fromUpstream.length > 0 ? fromUpstream : usable
  const lede =
    fromUpstream.length > 0
      ? `Picks up upstream's work through v${upstreamBase}.`
      : 'Fork-only changes; upstream is unchanged since the last release.'

  const fixesByLabel = new Map()
  const features = []
  for (const { subject } of commits) {
    const parsed = CONVENTIONAL.exec(subject)
    if (!parsed) {
      continue
    }
    const [, rawType, scope, rest] = parsed
    const type = rawType.toLowerCase()
    if (type === 'feat') {
      features.push(rest.replace(/\s*\(#\d+\)\s*$/, ''))
      continue
    }
    if (!['fix', 'perf', 'refactor'].includes(type)) {
      continue
    }
    // A scope can be a path like `ssh/relay`; the first segment names the subsystem.
    const label = SCOPE_LABELS.get((scope ?? '').split('/')[0].toLowerCase())
    if (label) {
      fixesByLabel.set(label, (fixesByLabel.get(label) ?? 0) + 1)
    }
  }

  const bullets = [...fixesByLabel.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([label, count]) => `- ${label} \u2014 ${count} ${count === 1 ? 'fix' : 'fixes'}`)
  for (const feature of features.slice(0, 3)) {
    bullets.push(`- New: ${feature}`)
  }
  if (bullets.length === 0) {
    bullets.push(`- ${commits.length} ${commits.length === 1 ? 'change' : 'changes'}`)
  }

  return [`# ${version}`, '', lede, '', ...bullets, ''].join('\n')
}
