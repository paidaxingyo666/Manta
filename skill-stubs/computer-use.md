# Computer Use

This file is a discovery stub, not the usage guide. The full, version-matched computer-use
reference is served by the `manta` binary itself — kept out of this file on purpose so it can
never drift from the binary that will actually run your commands.

Engage Manta's computer-use surface when a task requires desktop-level access to a visible local
app or window, including a native app or an external browser window/webview. Do not use for
Manta's embedded browser or page-only browser automation. Use `orca-cli` for Manta's embedded
pages and a page-automation tool such as Playwright or CDP for external pages.

<!-- shared: resolver -->

## Load the full guide before running Manta commands

```text
MANTA skills get computer-use
```

That prints the complete, version-matched guide for the exact binary that will handle your
next commands — listing apps/windows, reading UI, and driving clicks, typing, and other
accessibility actions. Read it first, then run the specific command you need.

<!-- shared: no-guessing -->

<!-- shared: older-binary-intro -->

```text
MANTA status --json
MANTA computer capabilities --json
MANTA computer list-apps --json
```

<!-- shared: older-binary-outro -->
