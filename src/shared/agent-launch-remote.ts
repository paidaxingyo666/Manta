/**
 * Why: a repo reached over SSH runs the Manta CLI through the relay shim, which
 * is always deployed as plain `manta` (Unix) / `manta.cmd` (Windows). The
 * Linux-only `manta-ide` rename — which exists solely to avoid shadowing the
 * GNOME Orca screen reader on a local desktop — must not be applied to those
 * remotes, or `manta-ide claude-teams` lands on a PATH where it does not exist.
 * `connectionId` is the SSH signal; WSL and local stay false.
 */
export function repoIsRemote(repo: { connectionId?: string | null }): boolean {
  return Boolean(repo.connectionId)
}
