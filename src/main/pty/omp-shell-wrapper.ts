// Why: OMP 15.x discovers built-in user extensions from ~/.omp/agent, but a
// typed `omp` in an existing terminal still needs Manta's status extension
// passed explicitly. Do not redirect PI_CODING_AGENT_DIR here: that variable
// is OMP's mutable home, so config/auth/session commands must keep the user's
// normal source of truth.

const OMP_SUBCOMMANDS = [
  '__complete',
  'acp',
  'agents',
  'auth-broker',
  'auth-gateway',
  'bench',
  'commit',
  'completions',
  'config',
  'dry-balance',
  'gallery',
  'grep',
  'grievances',
  'install',
  'join',
  'models',
  'plugin',
  'read',
  'say',
  'search',
  'setup',
  'shell',
  'ssh',
  'stats',
  'tiny-models',
  'token',
  'ttsr',
  'update',
  'usage',
  'worktree',
  'q',
  'wt'
] as const

export function getPosixOmpShellWrapper(): string {
  const subcommands = OMP_SUBCOMMANDS.join('|')
  return `# Why: OMP does not auto-load Manta's managed status extension; wrap only
# interactive launch invocations so subcommands such as \`omp config\` keep
# their normal argv shape.
__manta_omp_should_skip_extension() {
  case "\${1:-}" in
    help|--help|-h|--version|-v) return 0 ;;
    ${subcommands}) return 0 ;;
  esac
  return 1
}
__manta_omp_cwd_is_usable() {
  local __manta_physical_cwd
  [[ -x . ]] || return 1
  if [[ -n "\${PWD:-}" && -d "\${PWD:-}" ]]; then
    [[ "\${PWD}" -ef . ]]
  else
    # Why compare the path: shell builtins can print a cached path for a deleted cwd.
    __manta_physical_cwd="$(builtin pwd -P 2>/dev/null)" || return 1
    [[ -d "$__manta_physical_cwd" && "$__manta_physical_cwd" -ef . ]]
  fi
}
__manta_omp_invoke() {
  local __manta_use_extension="$1"
  shift
  if [[ $__manta_use_extension -eq 1 && -n "\${MANTA_OMP_STATUS_EXTENSION:-}" && -f "\${MANTA_OMP_STATUS_EXTENSION}" ]]; then
    if [[ "\${1:-}" == "launch" ]]; then
      shift
      command omp launch --extension "\${MANTA_OMP_STATUS_EXTENSION}" "$@"
    else
      command omp --extension "\${MANTA_OMP_STATUS_EXTENSION}" "$@"
    fi
  else
    command omp "$@"
  fi
}
__manta_omp() {
  local __manta_use_extension=1
  __manta_omp_should_skip_extension "\${1:-}" && __manta_use_extension=0
  if ! __manta_omp_cwd_is_usable; then
    local __manta_logical_cwd="\${PWD:-\${MANTA_WORKTREE_PATH:-\${MANTA_ROOT_PATH:-}}}"
    # Why: a restored shell can retain the deleted directory inode after its path is recreated.
    (
      if [[ -z "$__manta_logical_cwd" ]]; then
        printf 'Manta: OMP cannot start because no terminal working directory is available. Open a new terminal in an existing directory.\\n' >&2
        return 1
      fi
      if ! builtin cd -P -- "$__manta_logical_cwd" 2>/dev/null; then
        printf 'Manta: OMP cannot access the terminal working directory "%s". Open a new terminal in an existing directory.\\n' "$__manta_logical_cwd" >&2
        return 1
      fi
      __manta_omp_invoke "$__manta_use_extension" "$@"
    )
  else
    __manta_omp_invoke "$__manta_use_extension" "$@"
  fi
}
if [[ -n "\${MANTA_OMP_STATUS_EXTENSION:-}" ]]; then
  # Why the function reserved word: it suppresses alias expansion of the name, which
  # an \`alias omp\` otherwise rewrites at parse time, aborting the rest of the file.
  function omp { __manta_omp "$@"; }
fi
`
}

export function getPowerShellOmpShellWrapper(): string {
  const subcommands = OMP_SUBCOMMANDS.map((value) => `'${value}'`).join(', ')
  return `# Why: OMP does not auto-load Manta's managed status extension; wrap only
# interactive launch invocations so subcommands such as \`omp config\` keep
# their normal argv shape.
function Global:__MantaOmpShouldSkipExtension {
    param([string]$Name)
    $skip = @("help", "--help", "-h", "--version", "-v") + @(${subcommands})
    return $skip -contains $Name
}
if ($env:MANTA_OMP_STATUS_EXTENSION) {
    function Global:omp {
        $mantaUseExtension = -not (__MantaOmpShouldSkipExtension -Name ([string]($args[0])))
        $mantaStatus = 0
        $mantaCommand = Get-Command omp -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $mantaCommand) {
            Write-Error "omp executable not found"
            $mantaStatus = 127
        } elseif ($mantaUseExtension -and $env:MANTA_OMP_STATUS_EXTENSION -and
            (Test-Path -LiteralPath $env:MANTA_OMP_STATUS_EXTENSION)) {
            if ($args.Count -gt 0 -and $args[0] -eq "launch") {
                $mantaLaunchArgs = @($args | Select-Object -Skip 1)
                & $mantaCommand.Source launch --extension $env:MANTA_OMP_STATUS_EXTENSION @mantaLaunchArgs
            } else {
                & $mantaCommand.Source --extension $env:MANTA_OMP_STATUS_EXTENSION @args
            }
            $mantaStatus = $LASTEXITCODE
        } else {
            & $mantaCommand.Source @args
            $mantaStatus = $LASTEXITCODE
        }

        $global:LASTEXITCODE = $mantaStatus
    }
}
`
}
