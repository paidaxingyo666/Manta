# Native structured chat large-result Electron evidence

- Date: 2026-08-31 (local dev build)
- App identity: `Manta: brennanb2025/fix-native-chat-large-results`
- Worktree: `/Users/brennanbenson/orca/workspaces/orca/fix-native-chat-large-results`
- Rendered surface: native Codex chat tab in the Electron app, attached through CDP on port 9340.
- Prompt 1: requested a shell command printing exactly 1,100,000 characters.
- Visible result: tool activity settled and the chat rendered `Confirmed: exactly 1,100,000 characters were printed.` without killing the tab or provider. The large payload was not dumped into the rendered transcript.
- Prompt 2 (same chat): `Now reply with exactly: follow-up succeeded`.
- Visible result: `follow-up succeeded` rendered in the same tab, proving the provider/session remained usable after the >1 MiB item completion.

