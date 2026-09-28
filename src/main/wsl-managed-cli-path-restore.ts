/** Leads PATH with the managed WSL CLI after startup files ran; an unusable CLI only warns. */
export const WSL_MANAGED_CLI_PATH_RESTORE = `if [ -n "\${MANTA_WSL_CLI_DIR:-}" ]; then
  if [ -x "$MANTA_WSL_CLI_DIR/\${MANTA_CLI_COMMAND:-}" ]; then
    export PATH="$MANTA_WSL_CLI_DIR\${PATH:+:$PATH}"
  else
    printf 'Manta CLI unavailable: cannot run %s. Check WSL Windows-drive mount options.\\n' "$MANTA_WSL_CLI_DIR/\${MANTA_CLI_COMMAND:-}" >&2
  fi
fi`
