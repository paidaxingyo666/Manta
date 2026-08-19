import { buildWindowsAgentHookPostCommand } from '../agent-hooks/installer-utils'
import {
  buildWindowsHookEnvironmentGuardLines,
  buildWindowsHookStdinDrainEpilogue
} from '../agent-hooks/hook-stdin-contract'

/** Matches the envelope length cap used by the POSIX grok-hook branch. */
export const GROK_HOME_ENVELOPE_MAX_LENGTH = 4096

const WINDOWS_GROK_HOOK_POST_COMMAND = buildWindowsAgentHookPostCommand('grok', [
  // Why: attach grokHome before payload@- without string-replacing the shared template.
  '  --data-urlencode "grokHome=%MANTA_GROK_HOME%" ^'
])

/**
 * Windows `grok-hook.cmd` body.
 *
 * Why (#9358 / #9941): cmd expands `%VAR:~n,m%` at parse time. When `GROK_HOME`
 * is unset (the default outside a Manta-managed terminal), length/trailing
 * guards become a syntax error and every Grok hook event fails with exit 255.
 *
 * - Guard substring ops behind `if defined` + goto (not a parenthesized block).
 * - Reject oversized values before copying them onto a cmd input line.
 */
export function buildWindowsGrokHookScript(): string {
  return [
    '@echo off',
    // Why: a bare `setlocal` inherits delayed expansion from the caller (`cmd /v:on`
    // or the Command Processor registry default), and every `!` in a percent-expanded
    // value on the curl line is then eaten as a delayed reference — silently mangling
    // paneKey and dropping worktreeId. `!` is legal in a Windows path.
    'setlocal DisableDelayedExpansion',
    'if defined MANTA_AGENT_HOOK_ENDPOINT if exist "%MANTA_AGENT_HOOK_ENDPOINT%" call "%MANTA_AGENT_HOOK_ENDPOINT%" 2>nul',
    ...buildWindowsHookEnvironmentGuardLines(),
    'set "MANTA_GROK_HOME="',
    'if not defined GROK_HOME goto :manta_grok_home_ready',
    `if not "%GROK_HOME:~${GROK_HOME_ENVELOPE_MAX_LENGTH},1%"=="" goto :manta_grok_home_ready`,
    'set "MANTA_GROK_HOME=%GROK_HOME%"',
    'if not defined MANTA_GROK_HOME goto :manta_grok_home_ready',
    'if "%MANTA_GROK_HOME:~-1%"=="\\" set "MANTA_GROK_HOME=%MANTA_GROK_HOME%."',
    // Why: the trailing-backslash safety sentinel counts toward the relay envelope.
    `if not "%MANTA_GROK_HOME:~${GROK_HOME_ENVELOPE_MAX_LENGTH},1%"=="" set "MANTA_GROK_HOME="`,
    ':manta_grok_home_ready',
    WINDOWS_GROK_HOOK_POST_COMMAND,
    'exit /b 0',
    ...buildWindowsHookStdinDrainEpilogue(),
    ''
  ].join('\r\n')
}
