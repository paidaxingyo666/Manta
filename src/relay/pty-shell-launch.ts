import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getPosixOmpShellWrapper } from '../main/pty/omp-shell-wrapper'
import {
  BASH_PROMPT_COMMAND_COMPOSITION_BLOCK,
  getZshFinalZdotdirRestoreBlock,
  getZshShellReadyMarkerRegistrationBlock,
  SHELL_STARTUP_IDENTITY_MARKER_BLOCK,
  getZshStartupFileSourceBlock
} from '../main/shell-templates'

const RELAY_SHELL_READY_DIR = '.manta-relay/shell-ready'
const POSIX_LOGIN_ARGS = ['-l']
const SHELL_READY_MARKER_ESCAPED = '\\033]777;manta-shell-ready\\007'

export type RelayShellLaunchConfig = {
  args: string[]
  env: Record<string, string>
}

function quotePosixSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function shellBasename(shellPath: string): string {
  return shellPath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
}

function windowsShellArgs(
  shellName: string,
  options: { terminalWindowsWslDistro?: string | null } = {}
): string[] | null {
  if (shellName === 'powershell.exe' || shellName === 'powershell') {
    return ['-NoLogo']
  }
  if (shellName === 'pwsh.exe' || shellName === 'pwsh') {
    return ['-NoLogo']
  }
  if (shellName === 'cmd.exe' || shellName === 'cmd') {
    return []
  }
  if (shellName === 'wsl.exe' || shellName === 'wsl') {
    const distro = options.terminalWindowsWslDistro?.trim()
    return distro ? ['-d', distro] : []
  }
  return null
}

function hasOverlayRestoreEnv(env: Record<string, string>): boolean {
  return Boolean(
    env.MANTA_OPENCODE_CONFIG_DIR ||
    env.MANTA_MIMOCODE_HOME ||
    env.MANTA_REMOTE_CLI_BIN_DIR ||
    env.MANTA_OMP_STATUS_EXTENSION
  )
}

function getWrapperRoot(env: Record<string, string>): string {
  return join(env.HOME || process.env.HOME || homedir(), RELAY_SHELL_READY_DIR)
}

function normalizeOriginalZdotdirCandidate(value: string | undefined): string | null {
  if (!value) {
    return null
  }
  const normalized = value.replace(/\/+$/, '')
  if (!normalized || normalized.endsWith('/shell-ready/zsh')) {
    return null
  }
  return value
}

function resolveOriginalZdotdir(env: Record<string, string>): string {
  return (
    normalizeOriginalZdotdirCandidate(env.ZDOTDIR) ||
    normalizeOriginalZdotdirCandidate(env.MANTA_ORIG_ZDOTDIR) ||
    env.HOME ||
    process.env.HOME ||
    ''
  )
}

function ensureOverlayRestoreWrappers(root: string): void {
  const zshDir = join(root, 'zsh')
  const bashDir = join(root, 'bash')

  const zshEnv = `# Manta relay zsh overlay wrapper
${SHELL_STARTUP_IDENTITY_MARKER_BLOCK}
export MANTA_ORIG_ZDOTDIR="\${MANTA_ORIG_ZDOTDIR:-$HOME}"
case "\${MANTA_ORIG_ZDOTDIR%/}" in
  */shell-ready/zsh) export MANTA_ORIG_ZDOTDIR="$HOME" ;;
esac
[[ -f "$MANTA_ORIG_ZDOTDIR/.zshenv" ]] && source "$MANTA_ORIG_ZDOTDIR/.zshenv"
export MANTA_USER_ZDOTDIR="\${ZDOTDIR:-\${MANTA_ORIG_ZDOTDIR:-$HOME}}"
case "\${MANTA_USER_ZDOTDIR%/}" in
  */shell-ready/zsh) export MANTA_USER_ZDOTDIR="$HOME" ;;
esac
export ZDOTDIR=${quotePosixSingle(zshDir)}
`
  const zshProfile = `# Manta relay zsh overlay wrapper
${getZshStartupFileSourceBlock({
  fileName: '.zprofile',
  homeExpression: '"${MANTA_USER_ZDOTDIR:-${MANTA_ORIG_ZDOTDIR:-$HOME}}"'
})}
`
  const zshRc = `# Manta relay zsh overlay wrapper
${getZshStartupFileSourceBlock({
  fileName: '.zshrc',
  homeExpression: '"${MANTA_USER_ZDOTDIR:-${MANTA_ORIG_ZDOTDIR:-$HOME}}"',
  interactiveOnly: true
})}
if [[ ! -o login ]]; then
  # Why: remote startup files can re-export user defaults after relay spawn.
  [[ -n "\${MANTA_OPENCODE_CONFIG_DIR:-}" ]] && export OPENCODE_CONFIG_DIR="\${MANTA_OPENCODE_CONFIG_DIR}"
  [[ -n "\${MANTA_MIMOCODE_HOME:-}" ]] && export MIMOCODE_HOME="\${MANTA_MIMOCODE_HOME}"
  [[ -n "\${MANTA_REMOTE_CLI_BIN_DIR:-}" ]] && case ":$PATH:" in *:"\${MANTA_REMOTE_CLI_BIN_DIR}":*) ;; *) export PATH="\${MANTA_REMOTE_CLI_BIN_DIR}:$PATH" ;; esac
  ${getPosixOmpShellWrapper()}
fi
if [[ ! -o login ]]; then
${getZshFinalZdotdirRestoreBlock('"${MANTA_USER_ZDOTDIR:-${MANTA_ORIG_ZDOTDIR:-$HOME}}"')}
fi
`
  const zshLogin = `# Manta relay zsh overlay wrapper
${getZshStartupFileSourceBlock({
  fileName: '.zlogin',
  homeExpression: '"${MANTA_USER_ZDOTDIR:-${MANTA_ORIG_ZDOTDIR:-$HOME}}"',
  interactiveOnly: true
})}
# Why: .zlogin is the final zsh login startup file before the prompt.
[[ -n "\${MANTA_OPENCODE_CONFIG_DIR:-}" ]] && export OPENCODE_CONFIG_DIR="\${MANTA_OPENCODE_CONFIG_DIR}"
[[ -n "\${MANTA_MIMOCODE_HOME:-}" ]] && export MIMOCODE_HOME="\${MANTA_MIMOCODE_HOME}"
[[ -n "\${MANTA_REMOTE_CLI_BIN_DIR:-}" ]] && case ":$PATH:" in *:"\${MANTA_REMOTE_CLI_BIN_DIR}":*) ;; *) export PATH="\${MANTA_REMOTE_CLI_BIN_DIR}:$PATH" ;; esac
${getPosixOmpShellWrapper()}
${getZshFinalZdotdirRestoreBlock('"${MANTA_USER_ZDOTDIR:-${MANTA_ORIG_ZDOTDIR:-$HOME}}"')}
${getZshShellReadyMarkerRegistrationBlock(SHELL_READY_MARKER_ESCAPED)}
`
  const bashRc = `# Manta relay bash overlay wrapper
${SHELL_STARTUP_IDENTITY_MARKER_BLOCK}
[[ -f /etc/profile ]] && source /etc/profile
if [[ -f "$HOME/.bash_profile" ]]; then
  source "$HOME/.bash_profile"
elif [[ -f "$HOME/.bash_login" ]]; then
  source "$HOME/.bash_login"
elif [[ -f "$HOME/.profile" ]]; then
  source "$HOME/.profile"
fi
# Why: enable bracketed paste so Manta can deliver a multiline startup prompt as
# a single literal paste (ESC[200~…ESC[201~); without it, older readline builds
# treat each embedded newline as Enter and mangle the prompt into PS2
# continuation. Modern readline defaults this on; force it for the rest.
[[ $- == *i* ]] && bind 'set enable-bracketed-paste on' 2>/dev/null
# Why: remote startup files can re-export user defaults after relay spawn.
[[ -n "\${MANTA_OPENCODE_CONFIG_DIR:-}" ]] && export OPENCODE_CONFIG_DIR="\${MANTA_OPENCODE_CONFIG_DIR}"
[[ -n "\${MANTA_MIMOCODE_HOME:-}" ]] && export MIMOCODE_HOME="\${MANTA_MIMOCODE_HOME}"
[[ -n "\${MANTA_REMOTE_CLI_BIN_DIR:-}" ]] && case ":$PATH:" in *:"\${MANTA_REMOTE_CLI_BIN_DIR}":*) ;; *) export PATH="\${MANTA_REMOTE_CLI_BIN_DIR}:$PATH" ;; esac
${getPosixOmpShellWrapper()}
# Why: SSH bash sessions need the same command lifecycle markers as local
# bash so agent rows stop showing "working" when the foreground command exits.
__manta_initializing_wrapper=1
__manta_osc133_precmd() {
  local exit_code=$?
  __manta_in_prompt_command=1
  if [[ -n "\${__manta_in_command:-}" ]]; then
    printf "\\033]133;D;%s\\007" "$exit_code"
    unset __manta_in_command
  fi
  printf "\\033]133;A\\007"
  return "$exit_code"
}
__manta_osc133_prompt_done() {
  unset __manta_in_prompt_command; __manta_adopt_outer_debug_trap
  trap '__manta_osc133_preexec' DEBUG
}
__manta_osc133_preexec() {
  if [[ -n "\${__manta_prompt_status_capture_command:-}" && "$BASH_COMMAND" == "$__manta_prompt_status_capture_command" ]]; then
    unset __manta_initial_prompt
    __manta_in_legacy_prompt_wrapper=1
    return 0
  fi
  if [[ -n "\${__manta_initializing_wrapper:-}\${__manta_in_debug_capture:-}\${__manta_initial_prompt:-}\${__manta_in_prompt_dispatch:-}\${__manta_in_legacy_prompt_wrapper:-}\${__manta_in_prompt_command:-}" ]]; then
    [[ -z "\${__manta_initializing_wrapper:-}\${__manta_in_debug_capture:-}" ]] || return 0
    if [[ -n "\${__manta_initial_prompt:-}" && "$BASH_COMMAND" == "__manta_osc133_precmd" ]]; then
      unset __manta_initial_prompt; return 0
    fi
    if [[ -n "\${__manta_in_prompt_dispatch:-}" ]]; then
      [[ -n "\${__manta_dispatching_user_prompt_command:-}" ]] || return 0
      if [[ "\${FUNCNAME[1]:-}" == "__manta_run_prompt_command_array" ]]; then
        case "$BASH_COMMAND" in
          '(( __manta_exit_code == 0 ))'|'__manta_restore_prompt_status "$__manta_exit_code"'|'eval "$__manta_prompt_part"'|'eval "$__manta_final_prompt_command"'|__manta_dispatching_user_prompt_command=*|__manta_osc133_precmd|__manta_osc133_prompt_done|__manta_prompt_mark) return 0 ;;
        esac
      fi
    elif [[ "\${FUNCNAME[1]:-}" == "__manta_run_prompt_command_array" || "$BASH_COMMAND" == "__manta_run_prompt_command_array" ]]; then
      return 0
    fi
    [[ -z "\${__manta_in_legacy_prompt_wrapper:-}" || -n "\${__manta_dispatching_user_prompt_command:-}" ]] || return 0
    if [[ -n "\${__manta_in_prompt_command:-}" && "$BASH_COMMAND" == "__manta_in_debug_capture=1" ]]; then
      return 0
    fi
  fi
  case "\${FUNCNAME[1]:-}" in __manta_osc133_*|__manta_prompt_mark|__manta_restore_prompt_status) return 0 ;; esac
  case "$BASH_COMMAND" in __manta_osc133_precmd|__manta_osc133_prompt_done|__manta_prompt_mark) return 0 ;; esac
  __manta_run_user_debug_trap
  [[ -z "\${__manta_in_prompt_command:-}" ]] || return 0
  [[ -z "\${__manta_in_command:-}" ]] || return 0
  printf "\\033]133;C\\007"
  __manta_in_command=1
}
${BASH_PROMPT_COMMAND_COMPOSITION_BLOCK}
__manta_prepend_prompt_command "__manta_osc133_precmd"
# Why: SSH startup commands are renderer-delivered; emit the same internal
# readiness marker as local shells only when that delivery mode asks for it.
if [[ "\${MANTA_SHELL_READY_MARKER:-0}" == "1" ]]; then
  __manta_prompt_mark() {
    printf "${SHELL_READY_MARKER_ESCAPED}"
  }
  __manta_append_prompt_command "__manta_prompt_mark"
fi
__manta_append_prompt_command '__manta_in_debug_capture=1; __manta_prompt_had_functrace=""; if [[ -o functrace ]]; then __manta_prompt_had_functrace=1; set +T; fi; __manta_outer_debug_trap_spec="$(trap -p DEBUG)"; [[ -z "$__manta_prompt_had_functrace" ]] || set -T; unset __manta_prompt_had_functrace __manta_in_debug_capture'
__manta_append_prompt_command "__manta_osc133_prompt_done"
__manta_had_functrace=""
[[ -o functrace ]] && __manta_had_functrace=1
set +T
__manta_debug_trap_spec="$(trap -p DEBUG)"
[[ -z "$__manta_had_functrace" ]] || set -T
if [[ -n "$__manta_debug_trap_spec" && "$__manta_debug_trap_spec" != "trap -- '__manta_osc133_preexec' DEBUG" ]]; then
  __manta_debug_trap_command="\${__manta_debug_trap_spec#trap -- }"
  __manta_debug_trap_command="\${__manta_debug_trap_command% DEBUG}"
  eval "__manta_user_debug_trap=$__manta_debug_trap_command"
fi
unset __manta_debug_trap_spec __manta_debug_trap_command __manta_had_functrace
unset -f __manta_normalize_prompt_command_part __manta_normalize_prompt_command __manta_prepend_prompt_command __manta_append_prompt_command
unset __manta_prompt_command_normalized
# Why: arm DEBUG after wrapper setup so the relay rcfile itself does not emit
# fake command-start/end markers before the first prompt.
__manta_initial_prompt=1
trap '__manta_osc133_preexec' DEBUG
unset __manta_initializing_wrapper
`

  const files = [
    [join(zshDir, '.zshenv'), zshEnv],
    [join(zshDir, '.zprofile'), zshProfile],
    [join(zshDir, '.zshrc'), zshRc],
    [join(zshDir, '.zlogin'), zshLogin],
    [join(bashDir, 'rcfile'), bashRc]
  ] as const

  for (const [path, content] of files) {
    mkdirSync(dirname(path), { recursive: true })
    let existing: string | null = null
    try {
      existing = readFileSync(path, 'utf8')
    } catch {
      existing = null
    }
    // Why: relay wrapper files persist under ~/.manta-relay across app
    // upgrades. Existence alone is not enough; stale wrappers would miss
    // later fixes such as preserving post-.zshenv ZDOTDIR.
    if (existing !== content) {
      writeFileSync(path, content, 'utf8')
    }
    chmodSync(path, 0o644)
  }
}

export function getRelayShellLaunchConfig(
  shellPath: string,
  env: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
  options: {
    emitReadyMarker?: boolean
    emitStartupIdentity?: boolean
    terminalWindowsWslDistro?: string | null
  } = {}
): RelayShellLaunchConfig {
  const shellName = shellBasename(shellPath)
  const emitReadyMarker = options.emitReadyMarker === true
  const emitStartupIdentity = options.emitStartupIdentity === true
  if (platform === 'win32') {
    // Why: pwsh also exists on POSIX remotes; Windows-specific shell args must
    // only apply when the relay itself is running on native Windows.
    return {
      args:
        windowsShellArgs(shellName, {
          terminalWindowsWslDistro: options.terminalWindowsWslDistro
        }) ?? [],
      env: {}
    }
  }

  if (shellName !== 'zsh' && shellName !== 'bash') {
    return { args: POSIX_LOGIN_ARGS, env: {} }
  }
  // Why: preserve plain zsh startup fast path unless markers or overlay restoration are requested.
  const requiresZshWrapper = hasOverlayRestoreEnv(env) || emitReadyMarker || emitStartupIdentity
  if (shellName === 'zsh' && !requiresZshWrapper) {
    return { args: POSIX_LOGIN_ARGS, env: {} }
  }

  const root = getWrapperRoot(env)
  ensureOverlayRestoreWrappers(root)

  if (shellName === 'zsh') {
    return {
      args: POSIX_LOGIN_ARGS,
      env: {
        MANTA_ORIG_ZDOTDIR: resolveOriginalZdotdir(env),
        ZDOTDIR: join(root, 'zsh'),
        ...(emitReadyMarker ? { MANTA_SHELL_READY_MARKER: '1' } : {}),
        ...(emitStartupIdentity ? { MANTA_SHELL_STARTUP_IDENTITY: '1' } : {})
      }
    }
  }

  return {
    args: ['--rcfile', join(root, 'bash', 'rcfile')],
    env: {
      ...(emitReadyMarker ? { MANTA_SHELL_READY_MARKER: '1' } : {}),
      ...(emitStartupIdentity ? { MANTA_SHELL_STARTUP_IDENTITY: '1' } : {})
    }
  }
}
