// Why: local PTYs and the daemon/SSH path must use identical ZDOTDIR discovery;
// small drift here breaks different terminal transports in different ways.

function quotePosixSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export const SHELL_STARTUP_IDENTITY_MARKER_BLOCK = `if [[ "\${MANTA_SHELL_STARTUP_IDENTITY:-0}" == "1" ]]; then
  unset MANTA_SHELL_STARTUP_IDENTITY
  printf "\\033]777;manta-shell-start:%s\\007" "$$"
fi`

// Why: daemon, local, and relay wrappers must preserve one Bash prompt-hook contract.
export { BASH_PROMPT_COMMAND_COMPOSITION_BLOCK } from './bash-prompt-command-composition'
export function getZshEnvTemplate(zshDir: string, headerPrefix = ''): string {
  const header = headerPrefix
    ? `Manta ${headerPrefix} zsh shell-ready wrapper`
    : 'Manta zsh shell-ready wrapper'
  return `# ${header}
${SHELL_STARTUP_IDENTITY_MARKER_BLOCK}
# Why: capture the runtime wrapper dir before it is unset below. On WSL this
# file is generated with a Windows path but sourced via /mnt/c, so the baked
# literal is unusable there and ZDOTDIR must be restored from this value.
# Derive it from the file being sourced (%x, zsh's internal script name) rather
# than the env-imported $ZDOTDIR: zsh corrupts environment values whose UTF-8
# bytes fall in its 0x84-0x9D token range (e.g. a non-ASCII Windows username
# such as a Korean login), which would make the self-check below fail and fall
# back to the unusable baked literal, so the user's .zshrc never loads (#8003).
# %x is not subject to that corruption; keep $ZDOTDIR as a fallback for the
# rare shell where %x prompt expansion yields nothing.
_manta_wrapper_zdotdir_self="\${\${(%):-%x}:h}"
if [[ -z "\${_manta_wrapper_zdotdir_self:-}" ]]; then
  _manta_wrapper_zdotdir_self="\${ZDOTDIR:-}"
fi
while [[ "\${_manta_wrapper_zdotdir_self:-}" == */ ]]; do
  _manta_wrapper_zdotdir_self="\${_manta_wrapper_zdotdir_self%/}"
done
_manta_spawn_orig_zdotdir="\${MANTA_ORIG_ZDOTDIR:-}"
_manta_user_zdotdir="\${_manta_spawn_orig_zdotdir:-$HOME}"
_manta_zshenv_source_dir="\${MANTA_ZSHENV_SOURCE_DIR:-$HOME}"
_manta_zshenv_path=""
unset MANTA_ZSHENV_SOURCE_DIR

# Normalize fallback and source roots before reading user .zshenv so nested
# Manta PTYs never source another Manta wrapper recursively.
while [[ "\${_manta_user_zdotdir}" == */ ]]; do
  _manta_user_zdotdir="\${_manta_user_zdotdir%/}"
done
case "\${_manta_user_zdotdir}" in
  ""|*/shell-ready/zsh) _manta_user_zdotdir="$HOME" ;;
esac
while [[ "\${_manta_zshenv_source_dir}" == */ ]]; do
  _manta_zshenv_source_dir="\${_manta_zshenv_source_dir%/}"
done
case "\${_manta_zshenv_source_dir}" in
  ""|*/shell-ready/zsh) _manta_zshenv_source_dir="$HOME" ;;
esac

# Why: source at wrapper top level, not in a function/subshell, so .zshenv
# exports, functions, path/fpath typesets, and zsh options keep normal scope.
unset ZDOTDIR
if [[ -n "\${_manta_zshenv_source_dir:-}" && -f "\${_manta_zshenv_source_dir}/.zshenv" ]]; then
  _manta_zshenv_path="\${_manta_zshenv_source_dir}/.zshenv"
fi
if [[ -n "\${_manta_zshenv_path:-}" ]]; then
  source "\${_manta_zshenv_path}"
fi

_manta_discovered_zdotdir="\${ZDOTDIR:-}"

while [[ "\${_manta_discovered_zdotdir}" == */ ]]; do
  _manta_discovered_zdotdir="\${_manta_discovered_zdotdir%/}"
done

case "\${_manta_discovered_zdotdir}" in
  *[![:space:]]*) ;;
  *) _manta_discovered_zdotdir="" ;;
esac

if [[ -n "\${_manta_discovered_zdotdir}" && ! -d "\${_manta_discovered_zdotdir}" ]]; then
  [[ "\${MANTA_DEBUG:-0}" == "1" ]] && echo "[manta-shell-ready] Discovered ZDOTDIR '\${_manta_discovered_zdotdir}' does not exist, falling back" >&2
  _manta_discovered_zdotdir=""
fi

export MANTA_ORIG_ZDOTDIR="\${_manta_discovered_zdotdir:-\${_manta_user_zdotdir:-$HOME}}"

while [[ "\${MANTA_ORIG_ZDOTDIR}" == */ ]]; do
  MANTA_ORIG_ZDOTDIR="\${MANTA_ORIG_ZDOTDIR%/}"
done

case "\${MANTA_ORIG_ZDOTDIR}" in
  ""|*/shell-ready/zsh) export MANTA_ORIG_ZDOTDIR="$HOME" ;;
esac

# Why: use :- after user .zshenv — a pathological unset under set -u must not
# abort the wrapper; empty falls through to the baked-literal branch.
if [[ -n "\${_manta_wrapper_zdotdir_self:-}" && -f "\${_manta_wrapper_zdotdir_self:-}/.zshenv" ]]; then
  export ZDOTDIR="\${_manta_wrapper_zdotdir_self:-}"
else
  export ZDOTDIR=${quotePosixSingle(zshDir)}
fi
unset _manta_spawn_orig_zdotdir _manta_user_zdotdir _manta_zshenv_source_dir _manta_zshenv_path _manta_discovered_zdotdir _manta_wrapper_zdotdir_self
`
}

export function getZshStartupFileSourceBlock(options: {
  fileName: '.zprofile' | '.zshrc' | '.zlogin'
  homeExpression?: string
  interactiveOnly?: boolean
  skipWhenHomeIsCurrentZdotdir?: boolean
}): string {
  const homeExpression = options.homeExpression ?? '"${MANTA_ORIG_ZDOTDIR:-$HOME}"'
  const checks = [
    options.skipWhenHomeIsCurrentZdotdir ? '"$_manta_home" != "$ZDOTDIR"' : null,
    options.interactiveOnly ? '-o interactive' : null,
    `-f "$_manta_home/${options.fileName}"`
  ].filter(Boolean)

  return `_manta_home=${homeExpression}
case "\${_manta_home%/}" in
  */shell-ready/zsh) _manta_home="$HOME" ;;
esac
if [[ ${checks.join(' && ')} ]]; then
  _manta_wrapper_zdotdir="$ZDOTDIR"
  # Why: user startup files resolve plugin/config paths from their own ZDOTDIR;
  # Manta restores its wrapper dir afterward so zsh still loads wrapper files.
  export ZDOTDIR="$_manta_home"
  source "$_manta_home/${options.fileName}"
  export ZDOTDIR="$_manta_wrapper_zdotdir"
  unset _manta_wrapper_zdotdir
fi
`
}

// Why: zsh precmd fires before zle switches the PTY into line-editing mode,
// so the marker must be emitted from zle-line-init. Registering it through
// add-zle-hook-widget is unsafe: the azhw dispatcher aborts its hook chain
// when an earlier hook exits non-zero, and a pre-existing raw user widget
// (e.g. oh-my-zsh vi-mode without VI_MODE_SET_CURSOR) is preserved as the
// first hook and fails — silently suppressing the marker and stalling every
// startup command on the pre-ready timeout. Instead, own zle-line-init: emit
// the marker first, then chain to whatever widget was installed before.
export function getZshShellReadyMarkerRegistrationBlock(escapedMarker: string): string {
  return `if [[ "\${MANTA_SHELL_READY_MARKER:-0}" == "1" ]]; then
  # Why: capture the prior zle-line-init so the marker chains to it. On a
  # re-source we are already the bound widget, so keep the function captured
  # the first time instead of clobbering it to empty (which would silently
  # drop the user's widget on every prompt after the second source). Only
  # user-defined widgets are chainable as plain functions; builtin/completion
  # forms (rare for zle-line-init) are left unchained.
  if [[ "\${widgets[zle-line-init]:-}" == "user:__manta_prompt_mark" ]]; then
    :
  elif (( \${+widgets[zle-line-init]} )) && [[ "\${widgets[zle-line-init]}" == user:* ]]; then
    __manta_prev_line_init_fn="\${widgets[zle-line-init]#user:}"
  else
    __manta_prev_line_init_fn=""
  fi
  __manta_prompt_mark() {
    printf "${escapedMarker}"
    # Why: call the prior hook as a plain function, not an aliased widget, so
    # $WIDGET stays zle-line-init for add-zle-hook-widget dispatchers.
    if [[ -n "\${__manta_prev_line_init_fn:-}" ]]; then
      "\${__manta_prev_line_init_fn}" "$@"
    fi
  }
  zle -N zle-line-init __manta_prompt_mark
fi
`
}

// Why: fish has no ZDOTDIR-style wrapper dir, so the marker rides `--init-command`
// and fires on fish_prompt — the earliest event fish exposes (STA-3417). Unlike zsh's
// zle-line-init this lands just *before* fish arms `?2004h`, which PostReadyFlushGate
// absorbs. `builtin printf` so a user-defined printf can't silently swallow the marker
// and send every launch to the ready timeout.
export function getFishShellReadyInitCommand(escapedMarker: string): string {
  return `if test "$MANTA_SHELL_READY_MARKER" = 1
  function __manta_shell_ready_marker --on-event fish_prompt
    builtin printf "${escapedMarker}"
    functions -e __manta_shell_ready_marker
  end
end`
}

export function getZshFinalZdotdirRestoreBlock(homeExpression = '"${MANTA_ORIG_ZDOTDIR:-$HOME}"') {
  return `_manta_home=${homeExpression}
case "\${_manta_home%/}" in
  */shell-ready/zsh) _manta_home="$HOME" ;;
esac
# Why: after Manta's last wrapper file has loaded, the interactive shell should
# expose the same ZDOTDIR a normal zsh startup would expose.
export ZDOTDIR="$_manta_home"
unset _manta_home
`
}
