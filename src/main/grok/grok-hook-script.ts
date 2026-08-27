import {
  getSharedManagedScriptPath,
  wrapPosixHookCommand,
  wrapWindowsCmdHookCommand
} from '../agent-hooks/installer-utils'
import {
  buildPosixHookPayloadCapture,
  buildPosixHookSpoolLines
} from '../agent-hooks/hook-stdin-contract'
import {
  buildWindowsGrokHookScript,
  GROK_HOME_ENVELOPE_MAX_LENGTH
} from './windows-grok-hook-script'

export function getGrokManagedScriptFileName(): string {
  return process.platform === 'win32' ? 'grok-hook.cmd' : 'grok-hook.sh'
}

export function getGrokManagedScriptPath(): string {
  return getSharedManagedScriptPath(getGrokManagedScriptFileName())
}

export function getGrokManagedCommand(scriptPath: string): string {
  // A cmd-safe bare path avoids two extra Windows interpreters; POSIX can gate before spawning the
  // managed script because Manta injects MANTA_PANE_KEY only into panes it owns.
  return process.platform === 'win32'
    ? wrapWindowsCmdHookCommand(scriptPath)
    : wrapPosixHookCommand(scriptPath, {}, { requiredEnvVar: 'MANTA_PANE_KEY' })
}

export function getGrokManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return buildWindowsGrokHookScript()
  }

  return [
    '#!/bin/sh',
    ...buildPosixHookPayloadCapture(),
    ...buildPosixHookSpoolLines('grok'),
    'if [ -n "$MANTA_AGENT_HOOK_ENDPOINT" ] && [ -r "$MANTA_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$MANTA_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$MANTA_AGENT_HOOK_PORT" ] || [ -z "$MANTA_AGENT_HOOK_TOKEN" ] || [ -z "$MANTA_PANE_KEY" ]; then',
    '  spool_hook_event',
    '  exit 0',
    'fi',
    'grok_home=',
    `if [ -n "\${GROK_HOME:-}" ] && [ "\${#GROK_HOME}" -le ${GROK_HOME_ENVELOPE_MAX_LENGTH} ]; then`,
    '  grok_home=$GROK_HOME',
    'fi',
    'printf \'%s\' "$payload" | curl -sS -X POST "http://127.0.0.1:${MANTA_AGENT_HOOK_PORT}/hook/grok" \\',
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Manta-Agent-Hook-Token: ${MANTA_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${MANTA_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${MANTA_TAB_ID}" \\',
    '  --data-urlencode "launchToken=${MANTA_AGENT_LAUNCH_TOKEN}" \\',
    '  --data-urlencode "worktreeId=${MANTA_WORKTREE_ID}" \\',
    '  --data-urlencode "env=${MANTA_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${MANTA_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "grokHome=${grok_home}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || spool_hook_event',
    'exit 0',
    ''
  ].join('\n')
}
