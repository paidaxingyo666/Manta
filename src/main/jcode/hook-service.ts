import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import type { AgentHookInstallState, AgentHookInstallStatus } from '../../shared/agent-hook-types'
import {
  buildWindowsAgentHookPostCommand,
  writeManagedScript
} from '../agent-hooks/installer-utils'
import { refreshManagedScriptIfPresent } from '../agent-hooks/managed-hook-script-refresh'
import {
  readTextFileRemote,
  writeManagedScriptRemote,
  writeTextFileRemoteAtomic
} from '../agent-hooks/installer-utils-remote'
import {
  buildWindowsHookEnvironmentGuardLines,
  buildWindowsHookStdinDrainEpilogue,
  POSIX_HOOK_STDIN_DRAIN_COMMAND,
  WINDOWS_HOOK_STDIN_DRAIN_COMMAND
} from '../agent-hooks/hook-stdin-contract'
import {
  applyJcodeManagedHooks,
  parseJcodeHooksTable,
  removeJcodeManagedHooks
} from './hook-config'
import {
  getJcodeConfigPath,
  getJcodeManagedScriptFileName,
  getJcodeManagedScriptPath,
  getJcodePosixManagedScriptFileName,
  getJcodeRemoteConfigPath,
  JCODE_HOOK_EVENTS
} from './hook-settings'

function getManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      // Why: endpoint file holds the live port/token; a PTY that outlives a Manta restart carries stale env, so `call` it to refresh (else PTY env).
      'if defined MANTA_AGENT_HOOK_ENDPOINT if exist "%MANTA_AGENT_HOOK_ENDPOINT%" call "%MANTA_AGENT_HOOK_ENDPOINT%" 2>nul',
      ...buildWindowsHookEnvironmentGuardLines(),
      // Why: pre_tool is jcode's gate — it writes the tool input to our stdin and
      // waits for us. Drain it first so a tool input larger than the pipe buffer
      // can never stall the agent mid-write.
      `if "%JCODE_HOOK_EVENT%"=="pre_tool" ${WINDOWS_HOOK_STDIN_DRAIN_COMMAND}`,
      buildWindowsAgentHookPostCommand('jcode'),
      'exit /b 0',
      ...buildWindowsHookStdinDrainEpilogue(),
      ''
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    // Why: endpoint file holds the live port/token; PTYs that outlive a Manta restart carry stale env, so source it to reach the new server (else PTY env).
    // Why: silence the `.` builtin (2>/dev/null + `|| :`) so a TOCTOU race or CRLF-mangled line can't leak shell parse errors into agent transcripts (fail-open).
    'if [ -n "$MANTA_AGENT_HOOK_ENDPOINT" ] && [ -r "$MANTA_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$MANTA_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    // Why: pre_tool is jcode's gate. It writes the tool input to our stdin and
    // waits for us, so drain stdin before any exit — a tool input larger than
    // the pipe buffer would otherwise stall the agent mid-write.
    'if [ "$JCODE_HOOK_EVENT" = pre_tool ]; then',
    `  ${POSIX_HOOK_STDIN_DRAIN_COMMAND}`,
    'fi',
    'if [ -z "$MANTA_AGENT_HOOK_PORT" ] || [ -z "$MANTA_AGENT_HOOK_TOKEN" ] || [ -z "$MANTA_PANE_KEY" ]; then',
    '  exit 0',
    'fi',
    // Why: jcode already supplies JCODE_HOOK_PAYLOAD as a JSON object (capped
    // at 16 KB), so Manta forwards it verbatim instead of hand-building JSON in
    // shell (unsafe for arbitrary text). The event name is also posted as a
    // top-level form field for old payloads that omit it.
    'orca_post_jcode_event() {',
    '  printf \'%s\' "$JCODE_HOOK_PAYLOAD" | curl -sS -X POST "http://127.0.0.1:${MANTA_AGENT_HOOK_PORT}/hook/jcode" \\',
    '    --connect-timeout 0.5 --max-time 1.5 \\',
    '    -H "Content-Type: application/x-www-form-urlencoded" \\',
    '    -H "X-Manta-Agent-Hook-Token: ${MANTA_AGENT_HOOK_TOKEN}" \\',
    '    --data-urlencode "paneKey=${MANTA_PANE_KEY}" \\',
    '    --data-urlencode "tabId=${MANTA_TAB_ID}" \\',
    '    --data-urlencode "launchToken=${MANTA_AGENT_LAUNCH_TOKEN}" \\',
    '    --data-urlencode "worktreeId=${MANTA_WORKTREE_ID}" \\',
    '    --data-urlencode "env=${MANTA_AGENT_HOOK_ENV}" \\',
    '    --data-urlencode "version=${MANTA_AGENT_HOOK_VERSION}" \\',
    '    --data-urlencode "hook_event_name=${JCODE_HOOK_EVENT}" \\',
    '    --data-urlencode "session_id=${JCODE_HOOK_SESSION_ID}" \\',
    '    --data-urlencode "cwd=${JCODE_HOOK_CWD}" \\',
    '    --data-urlencode "payload@-" >/dev/null 2>&1 || true',
    '}',
    // Why: jcode reads this gate's stderr to EOF before releasing the tool call, so
    // the POST runs detached with both pipes closed. Manta observes the tool live and
    // adds no latency; the gate always allows (Manta never blocks a jcode tool).
    'if [ "$JCODE_HOOK_EVENT" = pre_tool ]; then',
    '  orca_post_jcode_event >/dev/null 2>&1 &',
    '  exit 0',
    'fi',
    'orca_post_jcode_event',
    'exit 0',
    ''
  ].join('\n')
}

export class JcodeHookService {
  getStatus(): AgentHookInstallStatus {
    const configPath = getJcodeConfigPath()
    const scriptPath = getJcodeManagedScriptPath()
    const table = readJcodeHooksTable(configPath)
    if (table === null) {
      return {
        agent: 'jcode',
        state: 'error',
        configPath,
        managedHooksPresent: false,
        detail: 'Could not parse jcode config.toml [hooks] table'
      }
    }
    const scriptPresent = existsSync(scriptPath)
    const managedCommand = scriptPath
    const missing: string[] = []
    const userOwned: string[] = []
    let managedCount = 0
    for (const event of JCODE_HOOK_EVENTS) {
      const value = table[event]
      if (value === managedCommand) {
        managedCount += 1
      } else if (value === undefined) {
        missing.push(event)
      } else {
        userOwned.push(event)
      }
    }
    const managedHooksPresent = managedCount > 0 || scriptPresent
    let state: AgentHookInstallState
    let detail: string | null
    if (missing.length === 0 && userOwned.length === 0) {
      state = 'installed'
      detail = null
    } else if (managedCount === 0 && missing.length === JCODE_HOOK_EVENTS.length) {
      state = 'not_installed'
      detail = null
    } else {
      state = 'partial'
      const parts: string[] = []
      if (missing.length > 0) {
        parts.push(`Managed hook missing for events: ${missing.join(', ')}`)
      }
      if (userOwned.length > 0) {
        parts.push(`User-owned hooks kept for events: ${userOwned.join(', ')}`)
      }
      detail = parts.join('; ')
    }
    return { agent: 'jcode', state, configPath, managedHooksPresent, detail }
  }

  install(): AgentHookInstallStatus {
    const configPath = getJcodeConfigPath()
    const scriptPath = getJcodeManagedScriptPath()
    const table = readJcodeHooksTable(configPath)
    if (table === null) {
      return {
        agent: 'jcode',
        state: 'error',
        configPath,
        managedHooksPresent: false,
        detail: 'Could not parse jcode config.toml [hooks] table'
      }
    }
    writeManagedScript(scriptPath, getManagedScript())
    const content = readConfigContent(configPath)
    const edited = applyJcodeManagedHooks(
      content,
      JCODE_HOOK_EVENTS,
      scriptPath,
      getJcodeManagedScriptFileName()
    )
    writeConfigContent(configPath, edited.content)
    return this.getStatus()
  }

  // Why: jcode invokes the script path recorded in its own config.toml, so a Manta
  // upgrade that changes the script body must rewrite the file the user already has.
  async refreshManagedScripts(): Promise<void> {
    await refreshManagedScriptIfPresent(getJcodeManagedScriptPath(), getManagedScript())
  }

  async installRemote(sftp: SFTPWrapper, remoteHome: string): Promise<AgentHookInstallStatus> {
    // Why: remote-Windows is out of scope for v1 (same as Devin); assume POSIX.
    const remoteConfigPath = getJcodeRemoteConfigPath(remoteHome)
    const remoteScriptFileName = getJcodePosixManagedScriptFileName()
    const remoteScriptPath = `${remoteHome.replace(/\/+$/, '')}/.manta/agent-hooks/${remoteScriptFileName}`
    try {
      const body = await readTextFileRemote(sftp, remoteConfigPath)
      const content = body === null ? '' : body
      const parsed = parseJcodeHooksTable(content)
      if (parsed === null) {
        return {
          agent: 'jcode',
          state: 'error',
          configPath: remoteConfigPath,
          managedHooksPresent: false,
          detail: 'Could not parse remote jcode config.toml [hooks] table'
        }
      }
      // Why: write script before settings so a mid-install failure never leaves config referencing a missing script.
      await writeManagedScriptRemote(sftp, remoteScriptPath, getManagedScript('posix'))
      const edited = applyJcodeManagedHooks(
        content,
        JCODE_HOOK_EVENTS,
        remoteScriptPath,
        remoteScriptFileName
      )
      await writeTextFileRemoteAtomic(sftp, remoteConfigPath, edited.content)
      return {
        agent: 'jcode',
        state: edited.userOwnedEvents.length > 0 ? 'partial' : 'installed',
        configPath: remoteConfigPath,
        managedHooksPresent: true,
        detail:
          edited.userOwnedEvents.length > 0
            ? `User-owned hooks kept for events: ${edited.userOwnedEvents.join(', ')}`
            : null
      }
    } catch (error) {
      return {
        agent: 'jcode',
        state: 'error',
        configPath: remoteConfigPath,
        managedHooksPresent: false,
        detail: error instanceof Error ? error.message : String(error)
      }
    }
  }

  remove(): AgentHookInstallStatus {
    const configPath = getJcodeConfigPath()
    const content = readConfigContent(configPath)
    const removed = removeJcodeManagedHooks(content, getJcodeManagedScriptFileName())
    if (removed.changed) {
      writeConfigContent(configPath, removed.content)
    }
    return this.getStatus()
  }
}

export const jcodeHookService = new JcodeHookService()

function readJcodeHooksTable(configPath: string): Record<string, string> | null {
  if (!existsSync(configPath)) {
    return {}
  }
  try {
    return parseJcodeHooksTable(readFileSync(configPath, 'utf-8'))
  } catch {
    return null
  }
}

function readConfigContent(configPath: string): string {
  try {
    return existsSync(configPath) ? readFileSync(configPath, 'utf-8') : ''
  } catch {
    return ''
  }
}

function writeConfigContent(configPath: string, content: string): void {
  // Why: skip the write when the on-disk content is already identical (same
  // no-op guard as writeHooksJson) so repeated install() calls stay inert.
  if (readConfigContent(configPath) === content) {
    return
  }
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, content, 'utf-8')
}
