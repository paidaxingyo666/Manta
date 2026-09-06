---
name: orca-emulator
description: >-
  iOS Simulator control from inside Manta, with the live device view in Manta's
  emulator pane. Use when driving a booted Apple Simulator on macOS: taps,
  gestures, typing, hardware buttons, rotation, and the accessibility tree, or
  when an iOS change needs simulator evidence. For an Android device or emulator
  use the Android emulator skill; build and install the app with xcodebuild or
  simctl first.
license: Apache-2.0
---

# Manta Emulator (iOS)

**Result:** an observed UI state change on a booted Apple Simulator, driven from the CLI
while the live stream stays visible in Manta's emulator pane.

**Done:** every action you report names the command and the evidence you read back: an
accessibility-tree dump, a returned payload, or a named error. No evidence means unverified;
say so instead of done.

**Safe failure:** if a command is unknown or its output has an unexpected shape, trust
`MANTA emulator --help` over this guide and tell the user the guide may be stale.

`MANTA` in every example, including tables and prose, is the executable you used to run
`skills get`. Substitute it before running; do not make a shell variable or run `MANTA`
literally. The examples work in POSIX shells, PowerShell, and cmd.exe.

## Command surface

`MANTA emulator --help` lists the wrapped verbs. Anything else goes through
`MANTA emulator exec --command "<serve-sim command>"`, which forwards the string to serve-sim
unvalidated with the active device injected.

`install`, `launch`, `permissions`, and `logcat` are Android-only and fail against an iOS
device with `emulator_unsupported`. `tap`, `type`, `gesture`, `button`, `rotate`, `ax`, and
`exec` work on both backends.

Emulator control is local to the Mac that owns the simulator; remote and SSH worktrees are
out of scope.

## Prerequisites

- macOS with the Xcode Command Line Tools (`xcrun --version`).
- A booted simulator (`xcrun simctl list devices booted`), or let `attach` boot one.
- An active session for the worktree before any input verb: run `MANTA emulator attach` or
  open the emulator pane.
- In a `pnpm dev` checkout, run `pnpm build:cli` before the first emulator command so the
  dev CLI shim reaches this worktree's runtime instead of a packaged install.

Manta reports a clear error when the host is missing macOS or the Xcode tools.

## Operations

Use `--json` for agent-driven calls. Unqualified commands target the worktree's active
device.

| Goal                     | Command                                                     | Constraint                                                                                                              |
| ------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| List available / running | `MANTA emulator list --json`                                 | Manta-managed sessions plus raw serve-sim streams. Use its ids for `--device` / `--emulator`.                            |
| List devices everywhere  | `MANTA emulator devices --json`                              | Every backend's devices with a platform column, booted and shutdown.                                                     |
| Attach / make active     | `MANTA emulator attach "iPhone 16 Pro" --json`               | Starts the helper if needed and makes the device active for the worktree. `--focus` switches the UI; it does not by default. |
| Single tap               | `MANTA emulator tap <x> <y> --json`                          | Normalized 0..1 coordinates.                                                                                             |
| Multi-step gesture       | `MANTA emulator gesture '<json>' --json`                     | Begin/move/end points. Use `tap` for a single tap.                                                                       |
| Type text                | `MANTA emulator type "text" --json`                          | US-ASCII only.                                                                                                           |
| Hardware button          | `MANTA emulator button home --json`                          | `home` and `side_button` are documented by the CLI spec; other names such as `swipe_home`, `app_switcher`, `lock`, and `siri` are forwarded to serve-sim unvalidated. |
| Rotate device            | `MANTA emulator rotate landscape_left --json`                | The orientation persists for subsequent gestures.                                                                        |
| Accessibility tree       | `MANTA emulator ax --json`                                   | serve-sim node tree, capped at 500 nodes, frames normalized 0..1 with a top-left origin. Needs an active session.        |
| Raw passthrough          | `MANTA emulator exec --command "ca-debug blended on" --json` | serve-sim subcommand string, without a `serve-sim` prefix.                                                                |
| Stop the helper          | `MANTA emulator kill --json`                                 | Leaves the device booted.                                                                                                |
| Stop and power off       | `MANTA emulator shutdown --json`                             | Stops the helper and shuts the simulator device down.                                                                    |

## Targeting

`attach`, or opening the emulator pane, makes one device active per worktree, and unqualified
commands target it. Pass a selector only to override that or reach a second device. With no
active session an unqualified command fails with `emulator_no_active`; attach or open the pane
and retry.

- `--device "iPhone 16 Pro"` or `--device <udid>`, from `list` or `devices`. `--emulator
  <id>` is an alternative spelling: the bridge resolves both through the same lookup. These
  selectors apply to the action verbs; `list` and `devices` take only `--worktree`, and
  `attach` names its device as a positional argument.
- `--worktree id:<fullWorktreeId>` or `--worktree active`. The full id is the exact
  `<repo-id>::<path>` value returned by `MANTA worktree list --json`; a bare repo id is not
  valid here.
- `--worktree all` drops worktree scoping on every verb, not only on listing, so a mutating
  command passed `all` runs unscoped. Use it only for listing.

## Constraints

- All coordinates are normalized 0..1 with a top-left origin, never pixels. Tap an `ax`
  element at its frame center: `x + width / 2`, `y + height / 2`.
- Prefer `tap` over `gesture` for a single tap. A separate gesture begin/end pair can be
  interpreted as a long press because of WebSocket overhead; `tap` sends the quick sequence.
- `type` sends US-ASCII only, and unsupported characters error rather than degrading.
- The pane and the CLI share one stream and one helper, so closing the pane can stop the
  stream.
- Run `kill` when you are done. A helper left running holds the device until Manta quits.
- The iOS backend drives private simulator APIs, so an Xcode update can change its behavior.

## Examples

```text
MANTA status --json
MANTA emulator list --json
MANTA emulator attach "iPhone 16 Pro" --json
MANTA emulator tap 0.5 0.8 --json
MANTA emulator type "user@example.com" --json
MANTA emulator button home --json
MANTA emulator ax --json
MANTA emulator exec --command "ca-debug blended on" --json
MANTA emulator kill --device "iPhone 16 Pro" --json
```

## Next action

Confirm `MANTA status --json` and `MANTA emulator list --json`, attach a device, then drive it
while reading back evidence for each action.

See also: `orca-emulator-android` for Android devices, `orca-cli` for terminals, worktrees,
and the built-in browser, and `computer-use` for desktop UI outside the simulator.
