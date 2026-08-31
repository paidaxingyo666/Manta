import { basename, win32 as pathWin32 } from 'node:path'

export const POSIX_SHELL_STARTUP_COMMAND_ENV = 'MANTA_POSIX_SHELL_STARTUP_COMMAND'

export function supportsPosixShellStartupCommand(shellPath: string): boolean {
  const shellName = pathWin32.basename(basename(shellPath)).toLowerCase()
  return shellName === 'bash' || shellName === 'zsh' || shellName === 'fish'
}

export function getBashStartupCommandPromptBlock(): string {
  return `if [[ \${${POSIX_SHELL_STARTUP_COMMAND_ENV}+present} == present ]]; then
  __manta_remove_startup_command_prompt_hook() {
    local __manta_item
    local -a __manta_remaining=()
    if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
      for __manta_item in "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}"; do
        [[ "$__manta_item" == "__manta_run_startup_command" ]] || __manta_remaining+=("$__manta_item")
      done
      PROMPT_COMMAND=("\${__manta_remaining[@]+"\${__manta_remaining[@]}"}")
    else
      for __manta_item in "\${__manta_prompt_command_suffix[@]+"\${__manta_prompt_command_suffix[@]}"}"; do
        [[ "$__manta_item" == "__manta_run_startup_command" ]] || __manta_remaining+=("$__manta_item")
      done
      __manta_prompt_command_suffix=("\${__manta_remaining[@]+"\${__manta_remaining[@]}"}")
    fi
  }
  __manta_run_startup_command() {
    local __manta_command="$${POSIX_SHELL_STARTUP_COMMAND_ENV}" __manta_status
    unset ${POSIX_SHELL_STARTUP_COMMAND_ENV}
    __manta_remove_startup_command_prompt_hook
    unset -f __manta_remove_startup_command_prompt_hook
    builtin history -s "$__manta_command" 2>/dev/null || true
    builtin printf '%s\n' "$__manta_command"
    eval "$__manta_command"
    __manta_status=$?
    unset -f __manta_run_startup_command
    return "$__manta_status"
  }
  __manta_append_prompt_command "__manta_run_startup_command"
fi`
}
