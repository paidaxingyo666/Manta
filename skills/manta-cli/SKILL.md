---
name: manta-cli
description: >-
  Operate Manta-managed worktrees, folder contexts, terminals, repos, automations, artifacts,
  skill sharing, worktree comments, and Manta's embedded browser through the `manta` CLI. Use
  when the user says "$manta-cli", "Manta worktree", "child worktree", "spawn codex/claude in a
  worktree", "read/wait/send Manta terminal", "handoff" / "handover" / "give this to another
  agent", "Manta browser", "manta artifacts", or "share skills". Prefer it over raw git
  worktree, ad hoc PTYs, or Computer Use when Manta state is involved. Use Computer Use only
  for external windows or desktop UI that needs OS-level control, and Playwright or CDP for
  external pages.
---

# Manta CLI

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
MANTA skills get manta-cli
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Manta is not running, start it with `MANTA open --json`
and retry. If `skills get` is unknown, explain that updating Manta restores the guide; use
`--help` for read-only discovery and do not guess unsupported commands.
