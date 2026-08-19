/**
 * Content of the bash rcfile Manta launches interactive bash with.
 *
 * Why: bash gets a single `--rcfile` wrapper (not a ZDOTDIR tree), so the login
 * startup-file chain, OSC 133 hooks, and the shell-ready marker all live here.
 */
import { BASH_PROMPT_COMMAND_COMPOSITION_BLOCK } from '../bash-prompt-command-composition'
import { getPosixOmpShellWrapper } from '../pty/omp-shell-wrapper'
import { getPosixCodexShellLaunchPreflight } from '../pty/codex-shell-launch-preflight'
import { SHELL_STARTUP_IDENTITY_MARKER_BLOCK } from '../shell-templates'
import { SHELL_READY_MARKER_ESCAPED } from './local-pty-shell-ready-wrapper-root'

export function getBashShellReadyRcfileContent(): string {
  return `# Manta bash shell-ready wrapper
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
# a single literal paste (ESC[200~…ESC[201~). Without it, older readline builds
# treat each embedded newline as Enter and mangle the prompt into PS2
# continuation. Modern readline defaults this on; force it for the rest.
[[ $- == *i* ]] && bind 'set enable-bracketed-paste on' 2>/dev/null
# Why: preserve bash's normal login-shell contract. Many users already source
# ~/.bashrc from ~/.bash_profile; forcing ~/.bashrc again here would duplicate
# PATH edits, hooks, and prompt init in Manta startup-command shells.
__manta_restore_agent_teams_path() {
  [[ -n "\${MANTA_AGENT_TEAMS_SHIM_DIR:-}" ]] || return 0
  case "$PATH" in
    "\${MANTA_AGENT_TEAMS_SHIM_DIR}"|"\${MANTA_AGENT_TEAMS_SHIM_DIR}:"*) return 0 ;;
  esac
  export PATH="\${MANTA_AGENT_TEAMS_SHIM_DIR}:$PATH"
}
__manta_restore_agent_teams_path
# Why: user startup files may set the default OpenCode config after Manta's
# spawn env; restore the Manta-managed config dir before the first prompt.
[[ -n "\${MANTA_OPENCODE_CONFIG_DIR:-}" ]] && export OPENCODE_CONFIG_DIR="\${MANTA_OPENCODE_CONFIG_DIR}"
[[ -n "\${MANTA_MIMOCODE_HOME:-}" ]] && export MIMOCODE_HOME="\${MANTA_MIMOCODE_HOME}"
${getPosixOmpShellWrapper()}
# Why: Codex must keep using Manta's runtime CODEX_HOME after profile scripts.
[[ -n "\${MANTA_CODEX_HOME:-}" ]] && export CODEX_HOME="\${MANTA_CODEX_HOME}"
${getPosixCodexShellLaunchPreflight()}
# Why: emit OSC 133 C/D so terminal-command-lifecycle can drop stale agent
# status when the foreground command (e.g. an interrupted Claude/Codex CLI)
# exits — mirrors the zsh wrapper. Without this, bash users (default on most
# Linux distros) keep a stuck 'working' spinner for up to 30 min after the
# CLI exits without sending a Stop/SessionEnd hook.
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
  unset __manta_in_prompt_command
  __manta_adopt_outer_debug_trap
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
  # Why: bash DEBUG fires for every simple command, including PROMPT_COMMAND
  # bodies and chained traps can call us repeatedly for one command.
  printf "\\033]133;C\\007"
  __manta_in_command=1
}
# Why: prepend so we capture $? before the user's PROMPT_COMMAND chain mutates it.
${BASH_PROMPT_COMMAND_COMPOSITION_BLOCK}
__manta_prepend_prompt_command "__manta_osc133_precmd"
# Why: append the marker through PROMPT_COMMAND so it fires after the login
# startup files have rebuilt the prompt, without re-running user rc files.
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
# Why: arm DEBUG after wrapper setup; otherwise bash treats our own rcfile
# commands as a foreground command and emits a fake C/D before the first prompt.
__manta_initial_prompt=1
trap '__manta_osc133_preexec' DEBUG
unset __manta_initializing_wrapper
`
}
