# Built-in browser commands

Use a snapshot-interact-re-snapshot loop:

```text
MANTA goto --url https://example.com --json
MANTA snapshot --json
MANTA click --element @e3 --json
MANTA snapshot --json
```

Common commands:

```text
MANTA goto --url <url> --json
MANTA back --json
MANTA reload --json
MANTA snapshot --json
MANTA screenshot --json
MANTA full-screenshot --json
MANTA pdf --json
MANTA click --element <ref> --json
MANTA fill --element <ref> --value <text> --json
MANTA type --input <text> --json
MANTA select --element <ref> --value <value> --json
MANTA check --element <ref> --json
MANTA scroll --direction down --amount 1000 --json
MANTA hover --element <ref> --json
MANTA focus --element <ref> --json
MANTA keypress --key Enter --json
MANTA upload --element <ref> --files <paths> --json
MANTA wait --text <text> --json
MANTA wait --url <substring> --json
MANTA wait --selector <css> --json
MANTA wait --load networkidle --json
MANTA eval --expression <js> --json
MANTA tab list --json
MANTA tab create --url <url> --json
MANTA tab switch --index <n> --json
MANTA tab close --index <n> --json
MANTA cookie get --json
MANTA capture start --json
MANTA console --limit 50 --json
MANTA network --limit 50 --json
MANTA exec --command "help" --json
```

Browser rules:

- Re-snapshot after navigation, tab switches, clicks that change the page, and any `browser_stale_ref`.
- Refs like `@e1` are assigned by `snapshot`, scoped to one tab, and invalidated by navigation or tab switch.
- Browser commands default to the current worktree and its active tab. Use `--worktree all` only intentionally.
- For concurrent browser work, run `MANTA tab list --json`, read `tabs[].browserPageId`, and pass `--page <browserPageId>` on later commands.
- Use typed tab commands (`MANTA tab list/create/close/switch`), not `MANTA exec --command "tab ..."`, so Manta keeps UI state synchronized.
- Prefer `wait --text`, `--url`, `--selector`, or `--load` after async page changes instead of bare timeouts.
- Anything not listed above goes through `MANTA exec --command "<agent-browser command>"`.
- If `fill` or `type` fails on a custom input, try `MANTA focus --element @e1 --json` then `MANTA inserttext --text "text" --json`.
- A client-hosted page renders in the paired desktop's browser engine, so every command against it needs that desktop online and returns `browser_host_unavailable` while it is closed, asleep, or disconnected. Server-hosted pages run with no desktop attached; prefer them for long or unattended automation.

Common recoveries:

- `browser_no_tab`: open a tab with `MANTA tab create --url <url> --json`.
- `browser_stale_ref`: run `MANTA snapshot --json` and retry with fresh refs.
- `browser_tab_not_found`: run `MANTA tab list --json` before switching or closing.
- `browser_host_unavailable`: the desktop hosting the page is offline. Bring it back, or recreate the page with server placement if the work must outlive the desktop session.
