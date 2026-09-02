# Manta Orchestration

This file is a discovery stub, not the usage guide. The full, version-matched Manta
orchestration reference is served by the `manta` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage Manta orchestration whenever you need structured multi-agent coordination: threaded
messages, blocking ask/reply flows, task dispatch, worker_done/escalation waits, task DAGs,
decision gates, coordinator loops, or decomposing work across agents. Use the manta-cli skill
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
- Otherwise, on Linux outside a Manta-managed terminal, use `manta-ide`. The Linux package installs the executable as `manta-ide`, so bare
  `manta` is not on PATH outside Manta's terminals.
- Otherwise, use `manta`.

Below, `MANTA` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `MANTA` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Manta build.

## Load the full guide before running Manta commands

```text
MANTA skills get orchestration
```

That prints the complete, version-matched guide for the exact binary that will handle your
next commands — task creation and dispatch, injected lifecycle preambles, worker_done
authority, decision gates, and coordinator loops. Read it first, then run the specific
command you need.

Don't guess subcommands or flags from memory or from a cached copy of this stub. They
change between Manta releases, and this file deliberately no longer lists them. Confirm the
app is up with `MANTA status --json` (start it with `MANTA open --json` if needed), and
prefer `--json` for agent-driven calls.

## If an older Manta does not recognize `skills get`

Use this fallback only when the selected binary explicitly reports that `skills get` is an
unknown command. Another failure is not proof of an older binary; report it rather than
guessing or changing executables. For a confirmed pre-guide binary, use only this bounded,
read-only bootstrap to orient. Do not dead-end and do not invent commands:

```text
MANTA status --json
MANTA orchestration task-list --json
MANTA terminal list --json
```

Then tell the user that updating Manta restores the full, version-matched guide via
`MANTA skills get orchestration`. Beyond these commands, ask the user rather than guessing a
command surface this older binary may not support.
