export const BASH_PROMPT_COMMAND_COMPOSITION_BLOCK = `__manta_normalize_prompt_command_part() {
  local __manta_value="$1" __manta_output_name="$2" __manta_character __manta_chunk
  local __manta_value_length=\${#1} __manta_suffix_length=0 __manta_backslash_length=0
  local __manta_output_length __manta_scan_start
  while (( __manta_value_length - __manta_suffix_length >= 1024 )); do
    __manta_scan_start=$(( __manta_value_length - __manta_suffix_length - 1024 ))
    __manta_chunk="\${__manta_value:__manta_scan_start:1024}"
    case "$__manta_chunk" in
      *[!$' \\t\\n;']*) break ;;
      *) __manta_suffix_length=$(( __manta_suffix_length + 1024 )) ;;
    esac
  done
  while (( __manta_suffix_length < __manta_value_length )); do
    __manta_character="\${__manta_value: -__manta_suffix_length - 1:1}"
    case "$__manta_character" in
      ' '|$'\\t'|$'\\n'|';') __manta_suffix_length=$(( __manta_suffix_length + 1 )) ;;
      *) break ;;
    esac
  done
  __manta_output_length=$(( \${#__manta_value} - __manta_suffix_length ))
  while (( __manta_output_length - __manta_backslash_length >= 1024 )); do
    __manta_scan_start=$(( __manta_output_length - __manta_backslash_length - 1024 ))
    __manta_chunk="\${__manta_value:__manta_scan_start:1024}"
    case "$__manta_chunk" in
      *[!\\\\]*) break ;;
      *) __manta_backslash_length=$(( __manta_backslash_length + 1024 )) ;;
    esac
  done
  while (( __manta_backslash_length < __manta_output_length )); do
    __manta_character="\${__manta_value:__manta_output_length - __manta_backslash_length - 1:1}"
    [[ "$__manta_character" == '\\' ]] || break
    __manta_backslash_length=$(( __manta_backslash_length + 1 ))
  done
  # Preserve the first separator when an odd backslash run escapes it.
  if (( __manta_suffix_length > 0 && __manta_backslash_length % 2 == 1 )); then
    __manta_suffix_length=$(( __manta_suffix_length - 1 ))
    __manta_backslash_length=0
  fi
  __manta_output_length=$(( \${#__manta_value} - __manta_suffix_length ))
  __manta_value="\${__manta_value:0:__manta_output_length}"
  # Bash 4.4-5.0 scalar prompt evaluation preserves an odd terminal backslash.
  if (( __manta_suffix_length == 0 && ((BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] == 0)) && __manta_backslash_length % 2 == 1 )); then
    __manta_value="$__manta_value\\\\"
  fi
  printf -v "$__manta_output_name" '%s' "$__manta_value"
}
__manta_restore_prompt_status() {
  return "$1"
}
__manta_update_user_debug_trap() {
  local __manta_debug_trap_spec="$1" __manta_unchanged_debug_trap_spec="$2"
  local __manta_debug_trap_command
  [[ "$__manta_debug_trap_spec" != "$__manta_unchanged_debug_trap_spec" ]] || return 0
  [[ "$__manta_debug_trap_spec" != "trap -- '__manta_osc133_preexec' DEBUG" ]] || return 0
  if [[ -z "$__manta_debug_trap_spec" ]]; then
    __manta_user_debug_trap=""
    unset __manta_chained_debug_trap
    return 0
  fi
  __manta_debug_trap_command="\${__manta_debug_trap_spec#trap -- }"
  __manta_debug_trap_command="\${__manta_debug_trap_command% DEBUG}"
  eval "__manta_user_debug_trap=$__manta_debug_trap_command"
  unset __manta_chained_debug_trap
}
__manta_run_user_debug_trap() {
  if [[ -n "\${__manta_user_debug_trap:-}" ]]; then
    eval "$__manta_user_debug_trap" || true
  fi
}
__manta_adopt_outer_debug_trap() {
  local __manta_debug_trap_spec="\${__manta_outer_debug_trap_spec:-}"
  unset __manta_outer_debug_trap_spec
  __manta_update_user_debug_trap "$__manta_debug_trap_spec" "trap -- '__manta_osc133_preexec' DEBUG"
}
__manta_run_prompt_command_array() {
  local __manta_exit_code="\${__manta_prompt_status:-$?}" __manta_prompt_part __manta_prompt_index __manta_user_count
  local __manta_suffix_part
  local __manta_final_prompt_command
  local __manta_in_prompt_dispatch=1 __manta_dispatching_user_prompt_command=""
  unset __manta_prompt_status
  __manta_adopt_outer_debug_trap
  trap '__manta_osc133_preexec' DEBUG
  for __manta_prompt_part in "\${__manta_prompt_command_prefix[@]+"\${__manta_prompt_command_prefix[@]}"}"; do
    if (( __manta_exit_code == 0 )); then
      eval "$__manta_prompt_part"
    else
      __manta_restore_prompt_status "$__manta_exit_code" || eval "$__manta_prompt_part"
    fi
  done
  __manta_user_count=0
  for __manta_prompt_part in "\${__manta_prompt_command_array[@]+"\${__manta_prompt_command_array[@]}"}"; do
    __manta_user_count=$(( __manta_user_count + 1 ))
  done
  for (( __manta_prompt_index = 0; __manta_prompt_index + 1 < __manta_user_count; __manta_prompt_index++ )); do
    __manta_prompt_part="\${__manta_prompt_command_array[__manta_prompt_index]}"
    __manta_dispatching_user_prompt_command=1
    if (( __manta_exit_code == 0 )); then
      eval "$__manta_prompt_part"
    else
      __manta_restore_prompt_status "$__manta_exit_code" || eval "$__manta_prompt_part"
    fi
    __manta_dispatching_user_prompt_command=""
  done
  if (( __manta_user_count > 0 )); then
    __manta_prompt_part="\${__manta_prompt_command_array[__manta_user_count - 1]}"
    # Why: keep the final user hook and Manta suffixes in one status-preserving eval.
    __manta_final_prompt_command='eval "$__manta_prompt_part"'
    for __manta_suffix_part in "\${__manta_prompt_command_suffix[@]+"\${__manta_prompt_command_suffix[@]}"}"; do
      __manta_final_prompt_command+=$'\\n'"$__manta_suffix_part"
    done
    __manta_dispatching_user_prompt_command=1
    if (( __manta_exit_code == 0 )); then
      eval "$__manta_final_prompt_command"
    else
      __manta_restore_prompt_status "$__manta_exit_code" || eval "$__manta_final_prompt_command"
    fi
    __manta_dispatching_user_prompt_command=""
  else
    for __manta_prompt_part in "\${__manta_prompt_command_suffix[@]+"\${__manta_prompt_command_suffix[@]}"}"; do
      if (( __manta_exit_code == 0 )); then
        eval "$__manta_prompt_part"
      else
        __manta_restore_prompt_status "$__manta_exit_code" || eval "$__manta_prompt_part"
      fi
    done
  fi
  return "$__manta_exit_code"
}
__manta_finish_legacy_prompt_dispatch() {
  local __manta_suffix_part
  if [[ -n "\${__manta_in_prompt_command:-}" ]]; then
    for __manta_suffix_part in "\${__manta_prompt_command_suffix[@]+"\${__manta_prompt_command_suffix[@]}"}"; do
      eval "$__manta_suffix_part"
    done
  fi
  trap '__manta_osc133_preexec' DEBUG
  unset __manta_in_legacy_prompt_wrapper
}
__manta_normalize_prompt_command() {
  [[ -z "\${__manta_prompt_command_normalized:-}" ]] || return 0
  local __manta_prompt_part
  local -a __manta_normalized=()
  for __manta_prompt_part in "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}"; do
    __manta_normalize_prompt_command_part "$__manta_prompt_part" __manta_prompt_part
    [[ -n "$__manta_prompt_part" ]] && __manta_normalized+=("$__manta_prompt_part")
  done
  __manta_prompt_command_normalized=1
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND=("\${__manta_normalized[@]+"\${__manta_normalized[@]}"}")
  else
    __manta_prompt_command_array=("\${__manta_normalized[@]+"\${__manta_normalized[@]}"}")
    __manta_prompt_command_prefix=()
    __manta_prompt_command_suffix=()
    unset PROMPT_COMMAND
    # Why: PID scope distinguishes legacy prompt dispatch from ordinary user command text.
    __manta_prompt_status_variable="__manta_prompt_status_$$"
    __manta_prompt_status_capture_command="$__manta_prompt_status_variable=\\$?"
    __manta_prompt_status_value="\\\${$__manta_prompt_status_variable}"
    PROMPT_COMMAND="$__manta_prompt_status_capture_command; __manta_prompt_status=$__manta_prompt_status_value"'; __manta_prompt_had_functrace=""; if [[ -o functrace ]]; then __manta_prompt_had_functrace=1; set +T; fi; __manta_outer_debug_trap_spec="$(trap -p DEBUG)"; [[ -z "$__manta_prompt_had_functrace" ]] || set -T; unset __manta_prompt_had_functrace; __manta_run_prompt_command_array; __manta_finish_legacy_prompt_dispatch'
  fi
}
__manta_prepend_prompt_command() {
  local command="$1"
  __manta_normalize_prompt_command
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND=("$command" "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}")
  else
    __manta_prompt_command_prefix=("$command" "\${__manta_prompt_command_prefix[@]+"\${__manta_prompt_command_prefix[@]}"}")
  fi
}
__manta_append_prompt_command() {
  local command="$1"
  __manta_normalize_prompt_command
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND+=("$command")
  else
    __manta_prompt_command_suffix+=("$command")
  fi
}`
