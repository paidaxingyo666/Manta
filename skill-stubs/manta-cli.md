# Manta CLI

This file is a discovery stub, not the usage guide. The full, version-matched Manta CLI
reference is served by the `manta` binary itself — kept out of this file on purpose so it
can never drift from the binary that will actually run your commands.

Engage Manta whenever its running editor/runtime is the source of truth: Manta-managed
worktrees, folder contexts, terminals, repos, automations, worktree comments, and the
browser embedded inside the Manta app. Triggers include "$orca-cli", "Manta worktree",
"child worktree", "spawn codex/claude in a worktree", "read/wait/send Manta terminal",
"full handoff" / "handover" / "give this to another agent", and "control the browser
inside Manta". Use plain shell tools when Manta state does not matter.

<!-- shared: resolver -->

## Load the full guide before running Manta commands

```text
MANTA skills get orca-cli
```

That prints the complete, version-matched guide for the exact binary that will handle your
next commands — worktrees, handoffs, terminals, automations, and the built-in browser.
Read it first, then run the specific command you need.

<!-- shared: no-guessing -->

<!-- shared: older-binary-intro -->

```text
MANTA status --json
MANTA worktree ps --json
MANTA terminal list --json
```

<!-- shared: older-binary-outro -->
