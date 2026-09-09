---
name: manta-per-workspace-env
description: >-
  Set up, review, debug, or validate a Manta per-workspace environment recipe: the
  on-demand, disposable runtime (cloud sandbox, VM, SSH host, or local container)
  Manta creates fresh for each workspace. Use to stand up a new recipe end to end,
  fix an `environmentRecipes` entry in `manta.yaml`, scaffold provider lifecycle
  scripts, or resolve an `manta vm recipe doctor` failure. Use `manta-cli` for
  ordinary worktree and workspace creation with no recipe involved.
---

# Per-Workspace Environments

This discovery stub loads the version-matched guide from the Manta executable used for this session.

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

## Load the version-matched guide before running Manta commands

```text
MANTA skills get manta-per-workspace-env
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Manta is not running, start it with `MANTA open --json`
and retry. If `skills get` is unknown, explain that updating Manta restores the guide; use
`--help` for read-only discovery and do not guess unsupported commands.
