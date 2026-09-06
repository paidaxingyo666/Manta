<!-- Single-authored blocks shared by every skill-stubs/<topic>.md projection.
     Insert one with a line reading `<!-- shared: <id> -->`; every block below must be
     inserted exactly once by every stub. `reflow` re-wraps the block after {{topic}}
     substitution, because the substituted name changes where the lines break. -->

<!-- block: resolver -->

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `MANTA_CLI_COMMAND` environment variable is set, use its value. Manta exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `MANTA_DEV_REPO_ROOT`, use `manta-dev`.
- Otherwise, on Linux outside a Manta-managed terminal, use `manta-ide`. Never run bare
  `manta` there — outside Manta's terminals it normally resolves to the
  GNOME Orca screen reader (`/usr/bin/orca`) and starts speech on the user's machine.
- Otherwise, use `manta`.

Below, `MANTA` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `MANTA` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Manta build.

<!-- block: no-guessing -->

Don't guess subcommands or flags from memory or from a cached copy of this stub. They
change between Manta releases, and this file deliberately no longer lists them. Confirm the
app is up with `MANTA status --json` (start it with `MANTA open --json` if needed), and
prefer `--json` for agent-driven calls.

<!-- block: older-binary-intro -->

## If an older Manta does not recognize `skills get`

Use this fallback only when the selected binary explicitly reports that `skills get` is an
unknown command. Another failure is not proof of an older binary; report it rather than
guessing or changing executables. For a confirmed pre-guide binary, use only this bounded,
read-only bootstrap to orient. Do not dead-end and do not invent commands:

<!-- block: older-binary-outro reflow -->

Then tell the user that updating Manta restores the full, version-matched guide via
`MANTA skills get {{topic}}`. Beyond these commands, ask the user rather than guessing a
command surface this older binary may not support.
