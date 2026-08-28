export type PosixCommandPathLookupTarget =
  | { kind: 'literal'; value: string }
  | { kind: 'shell-variable'; name: string }

const SHELL_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export type PosixCommandPathLookupOptions = {
  /**
   * Skip PATH components that are Windows drives mounted into the guest.
   *
   * WSL appends the Windows PATH to the guest PATH, so a Windows `claude` can
   * sit ahead of a real guest install. Rejecting the result AFTER the walk is
   * not equivalent: the walk stops at the first hit, so discarding it reports
   * "not installed" for a user who has both. Skipping the component keeps the
   * walk going and finds the guest binary behind it.
   *
   * Matched by mount metadata, not by a `/mnt` name: the automount root is
   * configurable, and `/mnt` is an ordinary directory name on a Linux box.
   */
  skipWindowsMountDirs?: boolean
}

export function buildPosixCommandPathLookupScript(
  target: PosixCommandPathLookupTarget,
  options: PosixCommandPathLookupOptions = {}
): string {
  const commandAssignment = buildCommandAssignment(target)
  // `drvfs` is what WSL mounts a Windows drive as, wherever the automount root
  // is; 9p/virtiofs cover the WSL2 shapes.
  //
  // `${x+set}` so the table is read once per SHELL, not once per lookup: the
  // caller embeds this script inside `for cmd in <every agent>`, so an
  // unconditional assignment forked awk once per probed CLI -- 36 of them
  // against a 10s budget. The variable outlives the iteration, so the second
  // pass finds it set. Deliberately not `[ -n ... ]`: a host with no Windows
  // mounts yields the empty string, which must still count as read.
  const mountPrelude = options.skipWindowsMountDirs
    ? [
        '[ "${_manta_win_mounts+set}" = set ] || _manta_win_mounts=$(awk \'$3 == "drvfs" || $3 == "9p" || $3 == "virtiofs" { print $2 }\' /proc/mounts 2>/dev/null)'
      ]
    : []
  const skipMountComponent = options.skipWindowsMountDirs
    ? [
        '      for _manta_win_mount in $_manta_win_mounts; do',
        '        case "$_manta_lookup_component/" in',
        '          "$_manta_win_mount"/*) _manta_lookup_component= ;;',
        '        esac',
        '      done',
        '      if [ -z "$_manta_lookup_component" ]; then',
        '        [ -n "$_manta_lookup_has_more" ] || break',
        '        continue',
        '      fi'
      ]
    : []
  // Shell command resolution can be masked by aliases, functions, and builtins, so inspect PATH.
  return [
    `_manta_lookup_command=${commandAssignment}`,
    'resolved=',
    ...mountPrelude,
    'case "$_manta_lookup_command" in',
    '  */*)',
    '    case "$_manta_lookup_command" in',
    '      /*) _manta_lookup_candidate=$_manta_lookup_command ;;',
    '      *) _manta_lookup_candidate=${PWD%/}/$_manta_lookup_command ;;',
    '    esac',
    '    if [ -x "$_manta_lookup_candidate" ] && [ ! -d "$_manta_lookup_candidate" ]; then',
    '      resolved=$_manta_lookup_candidate',
    '    fi',
    '    ;;',
    '  *)',
    '    _manta_lookup_remaining=${PATH-}',
    '    while :; do',
    '      case "$_manta_lookup_remaining" in',
    '        *:*)',
    '          _manta_lookup_component=${_manta_lookup_remaining%%:*}',
    '          _manta_lookup_remaining=${_manta_lookup_remaining#*:}',
    '          _manta_lookup_has_more=1',
    '          ;;',
    '        *)',
    '          _manta_lookup_component=$_manta_lookup_remaining',
    '          _manta_lookup_has_more=',
    '          ;;',
    '      esac',
    ...skipMountComponent,
    '      [ -n "$_manta_lookup_component" ] || _manta_lookup_component=.',
    '      case "$_manta_lookup_component" in',
    '        /*) _manta_lookup_candidate=$_manta_lookup_component/$_manta_lookup_command ;;',
    '        *) _manta_lookup_candidate=${PWD%/}/$_manta_lookup_component/$_manta_lookup_command ;;',
    '      esac',
    '      if [ -x "$_manta_lookup_candidate" ] && [ ! -d "$_manta_lookup_candidate" ]; then',
    '        resolved=$_manta_lookup_candidate',
    '        break',
    '      fi',
    '      [ -n "$_manta_lookup_has_more" ] || break',
    '    done',
    '    ;;',
    'esac'
  ].join('\n')
}

function buildCommandAssignment(target: PosixCommandPathLookupTarget): string {
  if (target.kind === 'literal') {
    return shellQuote(target.value)
  }
  if (!SHELL_VARIABLE_NAME_PATTERN.test(target.name)) {
    throw new Error(`Invalid shell variable name: ${target.name}`)
  }
  return `\${${target.name}-}`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}
