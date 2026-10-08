// Manta's `codex` shell function for every shell family: runs launch prep and adds
// --no-daemon. Pure text, so any host that writes a shell script can embed it.
// Why --no-daemon: Codex 0.156+ otherwise shares one server per CODEX_HOME that runs every tab's
// hooks with the first tab's Manta env and dies with it (#22873). These args need that server or exit 2.
export const CODEX_SHARED_SERVER_ARGS = ['agents', 'queue', '--no-daemon', '--remote'] as const
const CODEX_SHARED_SERVER_ARG_PATTERN = `^(${CODEX_SHARED_SERVER_ARGS.join('|')}|--remote=.*)$`

export function getPosixCodexShellLaunchPreflight(): string {
  return `# Why: a typed alias expands inside the shell, after pane launch prep.
# Why unalias inside the substitution: an alias named codex makes command -v
# report the alias text, and the subshell leaves the user's own alias intact.
# Why || : twice — zsh alone aborts inside the substitution, but every shell's
# assignment adopts its exit status, so an absent codex trips set -e in bash too.
__manta_codex_binary="$(unalias codex 2>/dev/null || :; command -v codex 2>/dev/null || :)"
if [[ -n "\${__manta_codex_binary:-}" && -x "\${__manta_codex_binary}" ]]; then
  # Why the function reserved word: it suppresses alias expansion of the name,
  # which otherwise rewrites this header at parse time and aborts the whole file.
  function codex {
    # Why local: zsh's warn_create_global warns for each global a function creates.
    local __manta_codex_arg __manta_codex_isolate="\${ORCA_CODEX_ISOLATE:-1}"
    if [[ -n "\${MANTA_CODEX_LAUNCH_PREFLIGHT:-}" && -x "\${MANTA_CODEX_LAUNCH_PREFLIGHT}" ]]; then
      "\${MANTA_CODEX_LAUNCH_PREFLIGHT}" agent hooks prepare-codex >/dev/null 2>&1 || :
    fi
    for __manta_codex_arg in "$@"; do
      case "$__manta_codex_arg" in ${CODEX_SHARED_SERVER_ARGS.join('|')}|--remote=*) __manta_codex_isolate=0 ;; esac
    done
    # Why probe every launch: a cached answer goes stale across an upgrade, and 0.155 and older exit 2 on the flag.
    if [[ "$__manta_codex_isolate" != 0 ]]; then
      case "$(command codex --help 2>/dev/null </dev/null)" in *--no-daemon*) set -- --no-daemon "$@" ;; esac
    fi
    command codex "$@"
  }
fi
unset __manta_codex_binary
`
}

export function getFishCodexShellLaunchPreflight(): string {
  return `# Why captured: an unquoted (type -t codex) expands to zero words when codex is
# absent, leaving "test = file" — fish then errors instead of failing closed.
# Quoting in place is not the fix; fish never substitutes inside double quotes.
set -l __manta_codex_type (type -t codex 2>/dev/null)
if test "$__manta_codex_type" = file
  function codex
    if test -x "$MANTA_CODEX_LAUNCH_PREFLIGHT"
      command "$MANTA_CODEX_LAUNCH_PREFLIGHT" agent hooks prepare-codex >/dev/null 2>&1; or true
    end
    if test "$ORCA_CODEX_ISOLATE" != 0; and not string match -qr -- '${CODEX_SHARED_SERVER_ARG_PATTERN}' $argv; and command codex --help 2>/dev/null </dev/null | string match -q -- '*--no-daemon*'
      set argv --no-daemon $argv
    end
    command codex $argv
  end
end
set -e __manta_codex_type`
}

export function getPowerShellCodexShellLaunchPreflight(): string {
  return `$mantaCodexCommand = Get-Command codex -ErrorAction SilentlyContinue | Select-Object -First 1
if ($mantaCodexCommand -and
    $mantaCodexCommand.CommandType -in @("Application", "ExternalScript")) {
    function Global:codex {
        $mantaCodexExecutable = Get-Command codex -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $mantaCodexExecutable) {
            Write-Error "codex executable not found"
            $global:LASTEXITCODE = 127
            return
        }
        $mantaCodexFlags = @()
        # Why try/catch: under the user's $ErrorActionPreference = 'Stop', a failing prep or probe must not abort the launch.
        if ($env:MANTA_CODEX_LAUNCH_PREFLIGHT) {
            try {
                & $env:MANTA_CODEX_LAUNCH_PREFLIGHT agent hooks prepare-codex *> $null
            } catch {
            }
        }
        if ($env:ORCA_CODEX_ISOLATE -ne '0' -and -not (@($args) -cmatch '${CODEX_SHARED_SERVER_ARG_PATTERN}')) {
            try {
                if ((& $mantaCodexExecutable.Source --help 2>$null) -match '--no-daemon') {
                    $mantaCodexFlags = @('--no-daemon')
                }
            } catch {
            }
        }
        # Why: a native command inside a function never sees the function's pipeline input on its own.
        if ($MyInvocation.ExpectingInput) {
            $input | & $mantaCodexExecutable.Source @mantaCodexFlags @args
        } else {
            & $mantaCodexExecutable.Source @mantaCodexFlags @args
        }
        $global:LASTEXITCODE = $LASTEXITCODE
    }
}
Remove-Variable mantaCodexCommand -ErrorAction SilentlyContinue`
}
