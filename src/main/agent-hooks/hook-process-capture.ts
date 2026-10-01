/** Capture before Manta inserts its managed-script shell. */
export const CLAUDE_HOOK_PARENT_CAPTURE =
  'ORCA_HOOK_AGENT_PID="${PPID:-}"; export ORCA_HOOK_AGENT_PID; '

export function buildHookProcessCapture(): string[] {
  return [
    'manta_agent_process=',
    // Why: skip the process reads for Claude sessions outside a Manta pane.
    '[ -z "${MANTA_PANE_KEY:-}" ] || case "${ORCA_HOOK_AGENT_PID:-}" in ""|*[!0-9]*) ;; *)',
    '  if [ -r "/proc/$ORCA_HOOK_AGENT_PID/stat" ]; then',
    '    manta_agent_stat=$(cat "/proc/$ORCA_HOOK_AGENT_PID/stat" 2>/dev/null) || manta_agent_stat=',
    '    manta_agent_boot=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null) || manta_agent_boot=',
    '    manta_agent_fields=${manta_agent_stat##*) }',
    '    manta_agent_start=$(printf "%s" "$manta_agent_fields" | awk \'{print $20}\')',
    '    case "$manta_agent_start" in ""|*[!0-9]*) ;; *)',
    '      [ -z "$manta_agent_boot" ] || manta_agent_process=$(printf \'{"pid":%s,"platform":"linux","startTime":"%s:%s"}\' "$ORCA_HOOK_AGENT_PID" "$manta_agent_boot" "$manta_agent_start") ;; esac',
    '  elif [ "$(uname -s 2>/dev/null)" = Darwin ]; then',
    // Why: lstart is local time; the host probe pins the same zone so the strings compare.
    '    manta_agent_start=$(TZ=UTC0 LC_ALL=C /bin/ps -p "$ORCA_HOOK_AGENT_PID" -o lstart= 2>/dev/null | sed \'s/^ *//;s/ *$//\')',
    '    [ -z "$manta_agent_start" ] || manta_agent_process=$(printf \'{"pid":%s,"platform":"darwin","startTime":"%s"}\' "$ORCA_HOOK_AGENT_PID" "$manta_agent_start")',
    '  fi ;;',
    'esac'
  ]
}
