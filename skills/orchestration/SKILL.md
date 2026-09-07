---
name: orchestration
description: >-
  Coordinate supervised Manta workers: threaded messages, blocking ask/reply,
  task dispatch, worker_done/escalation waits, task DAGs, decision gates,
  coordinator loops, and decomposing work across agents. Use `orca-cli` for full
  ownership handoffs — "hand off", "handoff", "handover", "give this to another
  agent", "another worktree" — unless asked to supervise, monitor, or coordinate
  a DAG, and for terminal control, lightweight terminal prompts, shell commands,
  Manta worktree management, and reading or waiting on terminals. Use Computer
  Use for external browser windows, webviews, Manta app UI, or desktop UI outside
  Manta's embedded browser only when the task requires OS/window-level control
  such as focus, menus, dialogs, coordinates, or screenshots. Use `orca-cli` for
  Manta's embedded pages and a page-automation tool such as Playwright or CDP for
  external pages.
---

# Manta Orchestration

This file is a discovery stub, not the usage guide. The full, version-matched Manta
orchestration reference is served by the `manta` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage Manta orchestration whenever you need structured multi-agent coordination: threaded
messages, blocking ask/reply flows, task dispatch, worker_done/escalation waits, task DAGs,
decision gates, coordinator loops, or decomposing work across agents. Use the orca-cli skill
instead for full ownership handoffs ("hand off", "handoff", "handover", "give this to
another agent", "another worktree") when the user did not ask to supervise, monitor, wait
for results, or coordinate a DAG — and for ordinary terminal control, shell commands,
worktree management, and the built-in browser. Coordination requires real Manta runtime
state; never substitute a non-Manta subagent tool.

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
MANTA skills get orchestration
```

That prints the compact, version-matched guide for the exact binary that will handle your
next commands. It covers the normal local coordinator loop. For a conditional action gate
such as remote placement, uncertain release recovery, or expanded DAG work, load only the
reference that gate names with
`MANTA skills get orchestration --reference references/<file>.md`
(`--references` lists the names). If that binary rejects `--reference`, run
`MANTA skills get orchestration --full` and read the named bundled reference before acting.

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Manta is not running, start it with `MANTA open --json`
and retry. If `skills get` is unknown, explain that updating Manta restores the guide; use
`--help` for read-only discovery and do not guess unsupported commands.
