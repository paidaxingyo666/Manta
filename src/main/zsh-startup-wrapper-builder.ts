/**
 * The single `.zshenv` Manta writes for every transport: local PTY, daemon/SSH,
 * and relay.
 *
 * Manta needs to run code AFTER the user's own zsh startup files. The old shape
 * bought that by keeping ZDOTDIR pointed at Manta's wrapper dir for the whole of
 * startup and sourcing each user file by hand — four generated files, and a
 * fake ZDOTDIR live while `/etc/zshrc` ran. That one decision was the root of a
 * whole bug family: `/etc/zshrc` assigns `HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history`
 * unconditionally, so history landed inside Manta's own dir (#11044); zsh's
 * `sourcehome()` ignores ZDOTDIR once the shell enters sh/ksh emulation, so a
 * user file ending in `emulate sh` hid every later wrapper file; and one wrapper
 * dir shared by two installed builds could mix files from both.
 *
 * This shape gives ZDOTDIR back before anything else can observe it, then defers
 * Manta's work to a `precmd` hook that runs at the first prompt — after
 * `.zprofile`, `/etc/zshrc`, `.zshrc` and `.zlogin`, all of which zsh now reads
 * from the user's own directory exactly as in an unwrapped shell. #11044 becomes
 * unreachable rather than repaired, and the emulation and mixed-build classes
 * stop existing.
 *
 * ORDER IS LOAD-BEARING: every function is defined ABOVE the `source` of the
 * user's `.zshenv`. A user `.zshenv` ending in `emulate sh` puts the rest of
 * this file under sh parsing rules, and zsh-only syntax then fails to parse,
 * taking the whole wrapper with it. Function bodies are parsed at definition
 * time, so defining them first makes them immune; `emulate -L zsh` inside the
 * hook restores zsh option semantics for the body at call time.
 */
import { getPosixOmpShellWrapper } from './pty/omp-shell-wrapper'
import { getPosixCodexShellLaunchPreflight } from './pty/codex-shell-launch-preflight'
import {
  getZshShellReadyMarkerRegistrationBlock,
  SHELL_STARTUP_IDENTITY_MARKER_BLOCK,
  ZSH_FEATURE_CHANNEL_BLOCK,
  ZSH_USER_ZSHENV_SOURCE_BLOCK,
  ZSH_ZDOTDIR_HANDBACK_BLOCK
} from './shell-templates'

/** Runtime values the hook re-exports after the user's own startup files ran. */
export type ZshWrapperRestoreSpec = {
  /** Manta's agent-teams shim dir back onto PATH. */
  agentTeamsPath: boolean
  /** Remote CLI bin dir onto PATH — relay hosts only. */
  remoteCliBinDir: boolean
  /** Manta's runtime CODEX_HOME. */
  codexHome: boolean
  /** The `codex()` wrapper that runs Manta's launch preflight. */
  codexLaunchPreflight: boolean
}

export type ZshStartupHookSpec = {
  /** First line of the generated file, e.g. `# Manta zsh shell-ready wrapper`. */
  headerLabel: string
  readyMarkerEscaped: string
  /** OSC 133 command-lifecycle hooks (behind the `markers` feature). */
  osc133CommandMarkers: boolean
  /** Local-only command delivery from the first zle line editor. */
  startupCommandDelivery: boolean
  /** Comment heading the overlay restores inside the hook. */
  overlayRestoreComment: string
  restores: ZshWrapperRestoreSpec
}

const AGENT_TEAMS_PATH_RESTORE_BLOCK = `__manta_restore_agent_teams_path() {
  [[ -n "\${MANTA_AGENT_TEAMS_SHIM_DIR:-}" ]] || return 0
  case "$PATH" in
    "\${MANTA_AGENT_TEAMS_SHIM_DIR}"|"\${MANTA_AGENT_TEAMS_SHIM_DIR}:"*) return 0 ;;
  esac
  export PATH="\${MANTA_AGENT_TEAMS_SHIM_DIR}:$PATH"
}
__manta_restore_agent_teams_path`

const OPENCODE_CONFIG_DIR_RESTORE = `[[ -n "\${MANTA_OPENCODE_CONFIG_DIR:-}" ]] && export OPENCODE_CONFIG_DIR="\${MANTA_OPENCODE_CONFIG_DIR}"`
const MIMOCODE_HOME_RESTORE = `[[ -n "\${MANTA_MIMOCODE_HOME:-}" ]] && export MIMOCODE_HOME="\${MANTA_MIMOCODE_HOME}"`
const REMOTE_CLI_BIN_DIR_RESTORE = `[[ -n "\${MANTA_REMOTE_CLI_BIN_DIR:-}" ]] && case ":$PATH:" in *:"\${MANTA_REMOTE_CLI_BIN_DIR}":*) ;; *) export PATH="\${MANTA_REMOTE_CLI_BIN_DIR}:$PATH" ;; esac`
const CODEX_HOME_RESTORE = `# Why: Codex must keep using Manta's runtime CODEX_HOME after rc files.
[[ -n "\${MANTA_CODEX_HOME:-}" ]] && export CODEX_HOME="\${MANTA_CODEX_HOME}"`

/**
 * The OSC 133 hooks, defined at top level so their bodies are parsed before the
 * user's `.zshenv` can change the parsing mode.
 */
const ZSH_OSC133_FUNCTION_BLOCK = `__manta_osc133_precmd() {
  local exit_code=$?
  if [[ -n "\${__manta_in_command:-}" ]]; then
    builtin printf "\\033]133;D;%s\\007" "$exit_code"
    builtin unset __manta_in_command
  fi
  builtin printf "\\033]133;A\\007"
}
__manta_osc133_preexec() {
  builtin printf "\\033]133;C\\007"
  # Why typeset -g: a plain assignment here creates a global inside a function,
  # which prints a warning above every command under warn_create_global.
  builtin typeset -g __manta_in_command=1
}`

function joinBlocks(blocks: (string | null)[]): string {
  return blocks.filter((block): block is string => block !== null).join('\n')
}

function indentBlock(block: string, indent: string): string {
  return block
    .split('\n')
    .map((line) => (line.length > 0 ? `${indent}${line}` : line))
    .join('\n')
}

/** One hook feature: `if __manta_has_feature <name>; then ... fi`. */
function featureGuard(name: string, body: (string | null)[]): string | null {
  const blocks = body.filter((block): block is string => block !== null)
  if (blocks.length === 0) {
    return null
  }
  return `  if __manta_has_feature ${name}; then\n${indentBlock(joinBlocks(blocks).replace(/\n$/, ''), '    ')}\n  fi`
}

/** The env/PATH restores that must outlast the user's own startup files. */
function getOverlayRestoreBlocks(spec: ZshStartupHookSpec): (string | null)[] {
  return [
    spec.overlayRestoreComment,
    spec.restores.agentTeamsPath ? AGENT_TEAMS_PATH_RESTORE_BLOCK : null,
    OPENCODE_CONFIG_DIR_RESTORE,
    MIMOCODE_HOME_RESTORE,
    spec.restores.remoteCliBinDir ? REMOTE_CLI_BIN_DIR_RESTORE : null,
    getPosixOmpShellWrapper(),
    spec.restores.codexHome ? CODEX_HOME_RESTORE : null,
    spec.restores.codexLaunchPreflight ? getPosixCodexShellLaunchPreflight() : null
  ]
}

/**
 * Everything Manta owns that must run after the user's config, in one function
 * invoked from the first prompt's precmd sweep and then retired.
 */
function buildDeferredInit(spec: ZshStartupHookSpec): string {
  // Why substitute in the markers case and remove otherwise: OSC 133 needs a
  // permanent precmd, so swapping this hook for it keeps the array position the
  // user's own hooks were registered around. With no permanent hook to leave
  // behind, removing is what keeps a history-only pane observably identical to
  // the unwrapped pane it was — no stray Manta name in `precmd_functions`.
  // Verified on zsh 5.9 that self-removal mid-sweep skips no later hook, from
  // the head, the middle and the tail of the array.
  const permanentPrecmd = spec.osc133CommandMarkers
    ? `  if __manta_has_feature markers; then
    precmd_functions=(\${precmd_functions:/__manta_deferred_init/__manta_osc133_precmd})
    preexec_functions=(__manta_osc133_preexec \${preexec_functions[@]})
  else
    precmd_functions=(\${precmd_functions:#__manta_deferred_init})
  fi`
    : `  precmd_functions=(\${precmd_functions:#__manta_deferred_init})`
  const lineInitRegistration = spec.startupCommandDelivery
    ? `  if __manta_has_feature ready || __manta_has_feature startup; then
    __manta_emit_ready_marker=""
    __manta_has_feature ready && __manta_emit_ready_marker=1
${indentBlock(getZshShellReadyMarkerRegistrationBlock(spec.readyMarkerEscaped, true), '    ')}
  fi`
    : featureGuard('ready', [
        indentBlock(getZshShellReadyMarkerRegistrationBlock(spec.readyMarkerEscaped), '')
      ])

  return `__manta_deferred_init() {
  # Why first: this body runs after the user's own config, so it would otherwise
  # inherit whatever options that config left set. Under NO_UNSET an unset
  # precmd_functions is fatal, and KSH_ARRAYS makes the 1-based feature lookup
  # drop whichever feature is listed first.
  builtin emulate -L zsh
  (( $+_manta_deferred_init_done )) && return 0
  builtin typeset -g _manta_deferred_init_done=1
  builtin typeset -g precmd_functions
${permanentPrecmd}
${joinBlocks([
  featureGuard('overlay', getOverlayRestoreBlocks(spec)),
  // Why no /etc/zshrc repair branch: ZDOTDIR was handed back before that file
  // ran, so the value it derives is the user's own path. #11044 is unreachable.
  `  if [[ -n "\${_manta_histfile:-}" ]]; then
    HISTFILE="$_manta_histfile"
  fi`,
  lineInitRegistration
])}
${
  spec.osc133CommandMarkers
    ? `  # Why called here: we were appended during this prompt's own precmd sweep, so
  # the permanent hook has not run yet and the first prompt would lose its mark.
  __manta_has_feature markers && __manta_osc133_precmd\n`
    : ''
}  builtin unset _manta_shell_features _manta_histfile
  builtin unfunction __manta_deferred_init __manta_has_feature
}`
}

export function buildZshStartupHook(spec: ZshStartupHookSpec): string {
  return `${joinBlocks([
    `# ${spec.headerLabel}`,
    ZSH_ZDOTDIR_HANDBACK_BLOCK,
    ZSH_FEATURE_CHANNEL_BLOCK,
    SHELL_STARTUP_IDENTITY_MARKER_BLOCK,
    spec.osc133CommandMarkers ? ZSH_OSC133_FUNCTION_BLOCK : null,
    buildDeferredInit(spec),
    ZSH_USER_ZSHENV_SOURCE_BLOCK
  ])}\n`
}
