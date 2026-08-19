import { getPosixOmpShellWrapper } from '../pty/omp-shell-wrapper'
import { getPosixCodexShellLaunchPreflight } from '../pty/codex-shell-launch-preflight'
import { getZshFinalZdotdirRestoreBlock, getZshStartupFileSourceBlock } from '../shell-templates'

export function getDaemonZshShellReadyRcfileContent(): string {
  return `# Manta daemon zsh shell-ready wrapper
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
