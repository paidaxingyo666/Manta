/**
 * Generates the zsh ZDOTDIR tree and bash rcfile Manta launches shells with.
 *
 * Why: the wrappers emit an OSC 777 marker after startup files finish, which the
 * readiness scanner watches for before a startup command is written.
 */
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { getPosixOmpShellWrapper } from '../pty/omp-shell-wrapper'
import { getPosixCodexShellLaunchPreflight } from '../pty/codex-shell-launch-preflight'
import {
  getZshEnvTemplate,
  getZshFinalZdotdirRestoreBlock,
  getZshShellReadyMarkerRegistrationBlock,
  getZshStartupFileSourceBlock
} from '../shell-templates'
import { getBashShellReadyRcfileContent } from './local-pty-shell-ready-bash-rcfile'
import {
  getShellReadyWrapperRoot,
  shellReadyWrappersExist,
  SHELL_READY_MARKER_ESCAPED
} from './local-pty-shell-ready-wrapper-root'

let didEnsureShellReadyWrappers = false

export function getZshShellReadyRcfileContent(): string {
  return `# Manta zsh shell-ready wrapper
${getZshStartupFileSourceBlock({
  fileName: '.zshrc',
  interactiveOnly: true,
  skipWhenHomeIsCurrentZdotdir: true
})}
__manta_restore_agent_teams_path() {
  [[ -n "\${MANTA_AGENT_TEAMS_SHIM_DIR:-}" ]] || return 0
  case "$PATH" in
    "\${MANTA_AGENT_TEAMS_SHIM_DIR}"|"\${MANTA_AGENT_TEAMS_SHIM_DIR}:"*) return 0 ;;
  esac
  export PATH="\${MANTA_AGENT_TEAMS_SHIM_DIR}:$PATH"
}
[[ ! -o login ]] && __manta_restore_agent_teams_path
if [[ ! -o login ]]; then
  # Why: ~/.zshrc can export the user's default OpenCode config after spawn.
  [[ -n "\${MANTA_OPENCODE_CONFIG_DIR:-}" ]] && export OPENCODE_CONFIG_DIR="\${MANTA_OPENCODE_CONFIG_DIR}"
[[ -n "\${MANTA_MIMOCODE_HOME:-}" ]] && export MIMOCODE_HOME="\${MANTA_MIMOCODE_HOME}"
  ${getPosixOmpShellWrapper()}
  # Why: Codex must keep using Manta's runtime CODEX_HOME after rc files.
  [[ -n "\${MANTA_CODEX_HOME:-}" ]] && export CODEX_HOME="\${MANTA_CODEX_HOME}"
  ${getPosixCodexShellLaunchPreflight()}
fi
__manta_osc133_precmd() {
  local exit_code=$?
  if [[ -n "\${__manta_in_command:-}" ]]; then
    printf "\\033]133;D;%s\\007" "$exit_code"
    unset __manta_in_command
  fi
  printf "\\033]133;A\\007"
}
__manta_osc133_preexec() {
  printf "\\033]133;C\\007"
  __manta_in_command=1
}
# Why: prepend so Manta captures $? before user prompt hooks can overwrite it.
precmd_functions=(__manta_osc133_precmd \${precmd_functions[@]})
preexec_functions=(__manta_osc133_preexec \${preexec_functions[@]})
if [[ ! -o login ]]; then
${getZshFinalZdotdirRestoreBlock()}
fi
`
}

export function ensureShellReadyWrappersAt(root = getShellReadyWrapperRoot()): void {
  if (didEnsureShellReadyWrappers && shellReadyWrappersExist(root)) {
    return
  }
  didEnsureShellReadyWrappers = true

  const zshDir = `${root}/zsh`
  const bashDir = `${root}/bash`

  const zshEnv = getZshEnvTemplate(zshDir)
  const zshProfile = `# Manta zsh shell-ready wrapper
${getZshStartupFileSourceBlock({ fileName: '.zprofile' })}
`
  const zshRc = getZshShellReadyRcfileContent()
  const zshLogin = `# Manta zsh shell-ready wrapper
${getZshStartupFileSourceBlock({ fileName: '.zlogin', interactiveOnly: true })}
__manta_restore_agent_teams_path() {
  [[ -n "\${MANTA_AGENT_TEAMS_SHIM_DIR:-}" ]] || return 0
  case "$PATH" in
    "\${MANTA_AGENT_TEAMS_SHIM_DIR}"|"\${MANTA_AGENT_TEAMS_SHIM_DIR}:"*) return 0 ;;
  esac
  export PATH="\${MANTA_AGENT_TEAMS_SHIM_DIR}:$PATH"
}
__manta_restore_agent_teams_path
# Why: .zlogin is the final login startup file before the prompt is shown.
[[ -n "\${MANTA_OPENCODE_CONFIG_DIR:-}" ]] && export OPENCODE_CONFIG_DIR="\${MANTA_OPENCODE_CONFIG_DIR}"
[[ -n "\${MANTA_MIMOCODE_HOME:-}" ]] && export MIMOCODE_HOME="\${MANTA_MIMOCODE_HOME}"
${getPosixOmpShellWrapper()}
[[ -n "\${MANTA_CODEX_HOME:-}" ]] && export CODEX_HOME="\${MANTA_CODEX_HOME}"
${getPosixCodexShellLaunchPreflight()}
${getZshShellReadyMarkerRegistrationBlock(SHELL_READY_MARKER_ESCAPED)}
${getZshFinalZdotdirRestoreBlock()}
`
  const bashRc = getBashShellReadyRcfileContent()

  const files = [
    [`${zshDir}/.zshenv`, zshEnv],
    [`${zshDir}/.zprofile`, zshProfile],
    [`${zshDir}/.zshrc`, zshRc],
    [`${zshDir}/.zlogin`, zshLogin],
    [`${bashDir}/rcfile`, bashRc]
  ] as const

  try {
    for (const [path, content] of files) {
      const dir = path.slice(0, path.lastIndexOf('/'))
      mkdirSync(dir, { recursive: true })
      writeFileSync(path, content, 'utf8')
      chmodSync(path, 0o644)
    }
  } catch (error) {
    // Why: degrade gracefully — a failed wrapper (read-only FS, perms, disk) just means no ready marker, PTY stays usable.
    const errorMessage =
      error instanceof Error
        ? `${error.message} (${(error as NodeJS.ErrnoException).code || 'unknown'})`
        : String(error)
    console.error(`[shell-ready] Failed to create wrapper files in ${root}: ${errorMessage}`)
    console.error('[shell-ready] Shell will launch without wrapper (no shell-ready marker)')
    // Reset the flag so next attempt will try again
    didEnsureShellReadyWrappers = false
  }
}

export function ensureShellReadyWrappers(): void {
  if (process.platform === 'win32') {
    return
  }
  ensureShellReadyWrappersAt()
}
