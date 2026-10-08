// Why: stock zshrc can replace line-init after the user clears the prompt-hook array.
export const ZSH_DEFERRED_LINE_INIT_BLOCK = `__manta_deferred_line_init() {
  builtin emulate -L zsh
  (( \${+functions[__manta_deferred_init]} )) || return 0
  local __manta_direct_line_init=0
  [[ "\${widgets[zle-line-init]:-}" == user:__manta_deferred_line_init ]] && __manta_direct_line_init=1
  __manta_deferred_init
  if (( __manta_direct_line_init && \${+widgets[zle-line-init]} )); then
    zle zle-line-init "$@"
  elif [[ "\${widgets[zle-line-init]:-}" == user:__manta_prompt_mark ]]; then
    local __manta_prev_line_init_fn=""
    __manta_prompt_mark "$@"
  fi
}
# Why: scheduled callbacks run after user prompt hooks without copying their function metadata.
__manta_deferred_sched_init() {
  local __manta_prompt_status=$?
  builtin emulate -L zsh
  (( \${+functions[__manta_deferred_init]} )) && __manta_deferred_init
  builtin unset __manta_deferred_sched_armed
  builtin unfunction __manta_deferred_sched_init
  return $__manta_prompt_status
}
__manta_arm_deferred_line_init() {
  builtin emulate -L zsh
  if [[ "\${widgets[zle-line-init]:-}" != user:__manta_deferred_line_init ]]; then
    if (( \${+widgets[zle-line-init]} )); then
      zle -A zle-line-init __manta_saved_line_init
    fi
    zle -N zle-line-init __manta_deferred_line_init
  fi
  if (( ! $+__manta_deferred_sched_armed )) && builtin zmodload -F zsh/sched b:sched 2>/dev/null; then
    builtin sched +0 __manta_deferred_sched_init && builtin typeset -g __manta_deferred_sched_armed=1
  fi
}`

// Why: restore the exact prior widget before the existing readiness hook captures it.
export const ZSH_DEFERRED_LINE_INIT_RETIRE_BLOCK = `  if (( \${+widgets[__manta_saved_line_init]} )); then
    if [[ "\${widgets[zle-line-init]:-}" == user:__manta_deferred_line_init ]]; then
      zle -A __manta_saved_line_init zle-line-init
    fi
    zle -D __manta_saved_line_init
  elif [[ "\${widgets[zle-line-init]:-}" == user:__manta_deferred_line_init ]]; then
    zle -D zle-line-init
  fi`

// Why: add-zle-hook-widget can keep an alias of the bootstrap in its own chain.
export const ZSH_DEFERRED_LINE_INIT_CLEANUP_BLOCK = `  (( $+__manta_deferred_sched_armed )) || builtin unfunction __manta_deferred_sched_init
  local __manta_widget __manta_line_init_bound=0
  for __manta_widget in "\${(v)widgets[@]}"; do
    if [[ "$__manta_widget" == user:__manta_deferred_line_init ]]; then
      __manta_line_init_bound=1
      break
    fi
  done
  (( __manta_line_init_bound )) || builtin unfunction __manta_deferred_line_init`
