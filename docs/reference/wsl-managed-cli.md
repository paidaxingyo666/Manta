# CLI access in Manta-managed WSL shells

A WSL terminal on a Windows host gets this app's CLI (`manta-ide` packaged,
`manta-dev` in development) on its PATH with nothing installed in the guest:
`~/.local/bin`, shell profiles, and the Windows user PATH are untouched. External
WSL shells still need Settings → General registration.

1. **Host.** `buildPtyHostEnv` calls `getManagedWslCliDir` for WSL panes only. It
   writes a launcher and PowerShell bridge (reusing `wsl-cli-scripts.ts`) under
   `<userData>/wsl-managed-cli/<content hash>` and exports `ORCA_WSL_CLI_DIR`.
   Content addressing follows `shell-wrapper-content-address.ts`: builds sharing
   user data never overwrite each other, and a present file is complete because
   each one lands by rename. Old directories are not collected.
2. **Crossing.** `addMantaWslInteropEnv` adds `MANTA_WSL_CLI_DIR/p`, so both the
   daemon and in-process spawn paths translate it with the distro's own mounts.
3. **Guest.** `WSL_MANAGED_CLI_PATH_RESTORE` runs after user startup files in the
   bash rcfile and the local zsh first-prompt hook, which run once per Manta shell.
   It leads PATH with the directory when `$ORCA_WSL_CLI_DIR/$MANTA_CLI_COMMAND` is
   executable, and otherwise prints one warning. Other login shells get no CLI;
   nothing blocks a shell.

The colocated launcher finds its bridge beside itself and PowerShell by Windows
path, so neither guest PATH nor the automount root matters. The bridge pins this
app's user-data directory and is written with a UTF-8 BOM so Windows PowerShell 5.1
reads non-ASCII paths correctly. It clears `ORCA_WSL_CLI_DIR`, which WSLENV maps
back to Windows, so an app the CLI starts never inherits it. In development it runs
Electron as Node on `out/cli/index.js` directly, with the environment
`buildWindowsDevLauncher` sets (`MANTA_APP_EXECUTABLE`, stashed `NODE_OPTIONS`).
Otherwise it launches its child exactly like the registered bridge.

A missing runtime (logged once) or a failed write (logged per spawn) leaves
`ORCA_WSL_CLI_DIR` unset. A terminal daemon from an older build adds no WSLENV
entry, so its WSL panes lack the CLI until the daemon restarts.

Run the opt-in end-to-end test on Windows with `MANTA_BACKGROUND_LAUNCH=1`,
`ORCA_TEST_MANAGED_WSL=1`, and optionally `MANTA_TEST_WSL_DISTRO=<distro>`. The zsh
case skips when the distro lacks `zsh` or `script`.
