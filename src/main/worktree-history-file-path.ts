/**
 * Recognises a `HISTFILE` value Manta itself minted for a worktree.
 *
 * Why: HISTFILE is EXPORTED into the pane, so an Manta launched from an Manta
 * pane inherits the launching worktree's history path in `process.env`. Every
 * pane of the nested app then hits the check-before-set early return in
 * `injectHistoryEnv`, gets no injection of its own, and appends into that ONE
 * worktree's history file — per-worktree isolation silently off. Same bug class
 * as the inherited `fish_history` fixed in #15195, and the same shape of fix:
 * only a value Manta can prove it minted is dropped, so a HISTFILE the user set
 * deliberately still wins.
 *
 * Matching is on the path shape rather than a resolved root because the same
 * predicate has to work in three processes that cannot all compute the roots:
 * the desktop (Electron userData), the daemon subprocess (no Electron), and the
 * relay on a remote host. Desktop and relay drop each other's shapes on purpose
 * — neither owns the other's worktree ids.
 *
 * Why the shape is enough without an Manta-specific token: two of the three
 * shapes carry one already (`.manta-remote`, `terminal-history-wsl`), and the
 * third needs an absolute path whose LAST TWO segments are a 16-char lowercase
 * hex directory directly under `terminal-history`, holding a file named exactly
 * `zsh_history`/`bash_history`. That is a machine-minted layout, not one a
 * person types. The blast radius if it were ever hit is also bounded: the value
 * is dropped from ONE spawn's env, so the pane gets Manta's own worktree history
 * (isolation on) or the shell's default (isolation off). Nothing on disk is
 * read, written, moved, or deleted.
 */

/** 16 hex chars: `hashWorktreeId`. */
const WORKTREE_HASH = '[0-9a-f]{16}'
const HISTORY_FILE = '(?:zsh|bash)_history'

// Why a leading `/` rather than `(?:^|/)`: every minted value is absolute (or a
// Windows path normalized to forward slashes), so a relative path of the same
// shape is the user's, not Manta's.
const MANTA_MINTED_HISTFILE = new RegExp(
  '/(?:' +
    // Desktop: <userData>/terminal-history/<hash>/<file>
    `terminal-history/${WORKTREE_HASH}/${HISTORY_FILE}` +
    '|' +
    // Desktop WSL: <userData>/terminal-history-wsl/<distro>/<hash>/<file>,
    // which reaches the guest as the /mnt/<drive>/... form of the same tail.
    `terminal-history-wsl/[^/]+/${WORKTREE_HASH}/${HISTORY_FILE}` +
    '|' +
    // Relay: ~/.manta-remote/terminal-history/<hash>-<file>
    `\\.manta-remote/terminal-history/${WORKTREE_HASH}-${HISTORY_FILE}` +
    ')$'
)

export function isMantaMintedHistFile(value: string | undefined): boolean {
  return typeof value === 'string' && MANTA_MINTED_HISTFILE.test(value.replace(/\\/g, '/'))
}

/** Drop a `HISTFILE` this process inherited from an outer Manta pane. */
export function dropInheritedMantaHistFile(env: Record<string, string | undefined>): void {
  if (isMantaMintedHistFile(env.HISTFILE)) {
    delete env.HISTFILE
  }
}
