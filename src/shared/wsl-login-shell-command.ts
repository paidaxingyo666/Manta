export function quotePosixShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export function escapeWslShCommandForWindows(command: string): string {
  // WSL preprocesses unescaped $ in Windows argv before the WSL-side shell
  // sees it, even when the POSIX script text would single-quote the dollar.
  let escaped = ''
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (char === '$' && command[index - 1] !== '\\') {
      escaped += '\\$'
      continue
    }
    escaped += char
  }
  return escaped
}

export function buildWslLoginShellCommand(command: string): string {
  const quotedCommand = quotePosixShell(command)
  return [
    '_manta_wsl_shell=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7)',
    'if [ -z "$_manta_wsl_shell" ] || [ ! -x "$_manta_wsl_shell" ]; then',
    '  _manta_wsl_shell="${SHELL:-/bin/bash}"',
    'fi',
    'if [ -z "$_manta_wsl_shell" ] || [ ! -x "$_manta_wsl_shell" ]; then',
    '  _manta_wsl_shell=/bin/sh',
    'fi',
    '_manta_wsl_shell_name=$(basename "$_manta_wsl_shell" | tr "[:upper:]" "[:lower:]")',
    'case "$_manta_wsl_shell_name" in',
    `  sh|dash) exec "$_manta_wsl_shell" -lc ${quotedCommand} ;;`,
    `  bash|zsh|ksh|mksh|ash) exec "$_manta_wsl_shell" -ilc ${quotedCommand} ;;`,
    `  *) exec /bin/sh -lc ${quotedCommand} ;;`,
    'esac'
  ].join('\n')
}

export function buildWslInteractiveLoginShellCommand(): string {
  return [
    '_manta_wsl_shell=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7)',
    'if [ -z "$_manta_wsl_shell" ] || [ ! -x "$_manta_wsl_shell" ]; then',
    '  _manta_wsl_shell="${SHELL:-/bin/bash}"',
    'fi',
    'if [ -z "$_manta_wsl_shell" ] || [ ! -x "$_manta_wsl_shell" ]; then',
    '  _manta_wsl_shell=/bin/sh',
    'fi',
    '_manta_shell_ready_root=""',
    'if [ -n "${MANTA_USER_DATA_PATH:-}" ]; then',
    '  _manta_shell_ready_root="${MANTA_USER_DATA_PATH%/}/shell-ready"',
    'fi',
    '_manta_wsl_shell_name=$(basename "$_manta_wsl_shell" | tr "[:upper:]" "[:lower:]")',
    'case "$_manta_wsl_shell_name" in',
    '  bash)',
    '    if [ -n "${_manta_shell_ready_root:-}" ] && [ -f "${_manta_shell_ready_root}/bash/rcfile" ]; then',
    '      exec "$_manta_wsl_shell" --rcfile "${_manta_shell_ready_root}/bash/rcfile"',
    '    fi',
    '    ;;',
    '  zsh)',
    '    if [ -n "${_manta_shell_ready_root:-}" ] && [ -d "${_manta_shell_ready_root}/zsh" ]; then',
    '      export ZDOTDIR="${_manta_shell_ready_root}/zsh"',
    '    fi',
    '    ;;',
    'esac',
    'exec "$_manta_wsl_shell" -l'
  ].join('\n')
}
