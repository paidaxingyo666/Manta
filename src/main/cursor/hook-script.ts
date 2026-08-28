import {
  buildWindowsAgentHookPostCommand,
  wrapPosixHookCommand,
  wrapWindowsHookCommand
} from '../agent-hooks/installer-utils'
import {
  buildPosixHookPayloadCapture,
  buildPosixHookSpoolLines,
  buildWindowsHookEnvironmentGuardLines,
  buildWindowsHookStdinDrainEpilogue
} from '../agent-hooks/hook-stdin-contract'
import { getCursorHookResponse, type CursorEvent } from './hook-events'

const CURSOR_HOOK_RESPONSE_ENV = 'MANTA_CURSOR_HOOK_RESPONSE'

export function getPosixManagedCommand(scriptPath: string, eventName: CursorEvent): string {
  const response = getCursorHookResponse(eventName)
  return wrapPosixHookCommand(
    scriptPath,
    { [CURSOR_HOOK_RESPONSE_ENV]: response },
    { fallbackStdout: response }
  )
}

export function getManagedCommand(scriptPath: string, eventName: CursorEvent): string {
  const response = getCursorHookResponse(eventName)
  return process.platform === 'win32'
    ? wrapWindowsHookCommand(
        scriptPath,
        { [CURSOR_HOOK_RESPONSE_ENV]: response },
        { fallbackStdout: response }
      )
    : getPosixManagedCommand(scriptPath, eventName)
}

export function getManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      // Why: Cursor permission hooks fail closed on empty/invalid stdout (#15462).
      `if defined ${CURSOR_HOOK_RESPONSE_ENV} (echo %${CURSOR_HOOK_RESPONSE_ENV}%) else (echo {})`,
      // Why: source current endpoint coordinates for PTYs surviving a Manta restart.
      'if defined MANTA_AGENT_HOOK_ENDPOINT if exist "%MANTA_AGENT_HOOK_ENDPOINT%" call "%MANTA_AGENT_HOOK_ENDPOINT%" 2>nul',
      ...buildWindowsHookEnvironmentGuardLines(),
      buildWindowsAgentHookPostCommand('cursor'),
      'exit /b 0',
      ...buildWindowsHookStdinDrainEpilogue(),
      ''
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    // Why: Cursor permission hooks fail closed on empty/invalid stdout (#15462).
    `if [ -n "$${CURSOR_HOOK_RESPONSE_ENV}" ]; then`,
    `  printf '%s\\n' "$${CURSOR_HOOK_RESPONSE_ENV}"`,
    'else',
    '  printf "{}\\n"',
    'fi',
    ...buildPosixHookPayloadCapture(),
    ...buildPosixHookSpoolLines('cursor'),
    // Why: refresh endpoint coordinates so surviving PTYs keep reporting.
    'if [ -n "$MANTA_AGENT_HOOK_ENDPOINT" ] && [ -r "$MANTA_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$MANTA_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$MANTA_AGENT_HOOK_PORT" ] || [ -z "$MANTA_AGENT_HOOK_TOKEN" ] || [ -z "$MANTA_PANE_KEY" ]; then',
    '  spool_hook_event',
    '  exit 0',
    'fi',
    // Why: post form fields because path-bearing worktree IDs are unsafe in hand-built JSON.
    // Why: pipe payload to curl stdin to keep large output off the command line.
    'printf \'%s\' "$payload" | curl -sS -X POST "http://127.0.0.1:${MANTA_AGENT_HOOK_PORT}/hook/cursor" \\',
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Manta-Agent-Hook-Token: ${MANTA_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${MANTA_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${MANTA_TAB_ID}" \\',
    '  --data-urlencode "launchToken=${MANTA_AGENT_LAUNCH_TOKEN}" \\',
    '  --data-urlencode "worktreeId=${MANTA_WORKTREE_ID}" \\',
    '  --data-urlencode "env=${MANTA_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${MANTA_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || spool_hook_event',
    'exit 0',
    ''
  ].join('\n')
}
