import { createHash } from 'node:crypto'
import { posix as pathPosix } from 'node:path'
import { WSL_CODEX_RUNTIME_HOME_SEGMENTS } from '../pty/codex-home-wsl-env'
import { runWslProcess } from '../wsl/wsl-runner'
import { compareCodexAuthFreshness, codexAuthIsFresher } from './codex-auth-identity'
import { decodeWslBase64Payload } from './wsl-codex-auth-batch-reader'

const DRAIN_MARKER_NAME = 'direct-home-auth-drain-v1.json'
const MARKER_PRESENT_EXIT = 20
const SOURCE_AUTH_ABSENT_EXIT = 21

export type LegacyWslRuntimeAuthDestination = {
  authContents: string
  linuxHomePath: string
}

type LegacyWslRuntimeInspection = {
  authContents: string
  credentials: { kind: 'missing' } | { kind: 'present'; contents: string }
}

type LegacyWslRuntimeAuthDrainOptions = {
  distro: string
  guestHomeLinuxPath: string
  legacyPanePresent: boolean
  resolveDestination: (
    runtimeAuthContents: string
  ) => LegacyWslRuntimeAuthDestination | null | Promise<LegacyWslRuntimeAuthDestination | null>
}

const drainQueueByDistro = new Map<string, Promise<void>>()
const completedDistroKeys = new Set<string>()

export function startLegacyWslRuntimeAuthDrain(
  options: LegacyWslRuntimeAuthDrainOptions
): Promise<void> {
  const key = options.distro.trim().toLowerCase()
  if (completedDistroKeys.has(key)) {
    return Promise.resolve()
  }
  // Coalesce launch/rate-limit callers while a drain is in flight. Queuing a
  // new pass for every poll can otherwise build an unbounded promise chain
  // while a legacy pane keeps the migration pending.
  const inFlight = drainQueueByDistro.get(key)
  if (inFlight) {
    return inFlight
  }
  const next = drainLegacyWslRuntimeAuth(options)
    .then((status) => {
      if (status === 'complete') {
        completedDistroKeys.add(key)
      }
    })
    .catch((error) => {
      console.warn('[codex-wsl-auth-drain] Failed to drain legacy runtime auth:', error)
    })
  drainQueueByDistro.set(key, next)
  void next.finally(() => {
    if (drainQueueByDistro.get(key) === next) {
      drainQueueByDistro.delete(key)
    }
  })
  return next
}

export async function drainLegacyWslRuntimeAuth(
  options: LegacyWslRuntimeAuthDrainOptions
): Promise<'complete' | 'pending'> {
  const paths = resolveLegacyRuntimePaths(options.guestHomeLinuxPath)
  const inspection = await runWslProcess({
    distro: options.distro,
    loginPath: 'none',
    script: INSPECT_LEGACY_AUTH_SCRIPT,
    args: [paths.runtimeHome, paths.activeHome, paths.marker],
    timeoutMs: 5_000,
    maxOutputBytes: 2 * 1024 * 1024
  })
  if (inspection.code === MARKER_PRESENT_EXIT) {
    return 'complete'
  }
  if (inspection.code === SOURCE_AUTH_ABSENT_EXIT) {
    if (!options.legacyPanePresent) {
      await finalizeAbsentLegacyAuth(options.distro, paths)
      return 'complete'
    }
    return 'pending'
  }
  assertSuccessfulDrainStep('inspect', inspection)

  const inspected = parseLegacyRuntimeInspection(inspection.stdout)
  if (!inspected) {
    return 'pending'
  }
  const destination = await options.resolveDestination(inspected.authContents)
  if (!destination) {
    return 'pending'
  }
  const freshness = compareCodexAuthFreshness(inspected.authContents, destination.authContents)
  if (freshness === null) {
    return 'pending'
  }
  const promoteAuth = codexAuthIsFresher(inspected.authContents, destination.authContents)
  const result = await runWslProcess({
    distro: options.distro,
    loginPath: 'none',
    script: APPLY_LEGACY_AUTH_SCRIPT,
    args: [
      paths.runtimeHome,
      paths.activeHome,
      paths.marker,
      destination.linuxHomePath,
      sha256(inspected.authContents),
      sha256(destination.authContents),
      promoteAuth ? '1' : '0',
      options.legacyPanePresent ? '0' : '1',
      inspected.credentials.kind === 'present' ? sha256(inspected.credentials.contents) : 'missing'
    ],
    timeoutMs: 5_000,
    maxOutputBytes: 16 * 1024
  })
  assertSuccessfulDrainStep('apply', result)
  return options.legacyPanePresent ? 'pending' : 'complete'
}

function parseLegacyRuntimeInspection(stdout: string): LegacyWslRuntimeInspection | null {
  const [authBase64, credentialsKind, credentialsBase64] = stdout.split('\n')
  const authContents = decodeWslBase64Payload(authBase64 ?? '')
  if (authContents === null) {
    return null
  }
  if (credentialsKind === 'missing') {
    return { authContents, credentials: { kind: 'missing' } }
  }
  if (credentialsKind !== 'present') {
    return null
  }
  const credentialsContents = decodeWslBase64Payload(credentialsBase64 ?? '')
  if (!credentialsContents || !isJsonObject(credentialsContents)) {
    return null
  }
  return { authContents, credentials: { kind: 'present', contents: credentialsContents } }
}

function isJsonObject(contents: string): boolean {
  try {
    const value = JSON.parse(contents) as unknown
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  } catch {
    return false
  }
}

function resolveLegacyRuntimePaths(guestHomeLinuxPath: string): {
  activeHome: string
  marker: string
  runtimeHome: string
} {
  const runtimeHome = pathPosix.join(guestHomeLinuxPath, ...WSL_CODEX_RUNTIME_HOME_SEGMENTS)
  const runtimeRoot = pathPosix.dirname(runtimeHome)
  return {
    activeHome: pathPosix.join(runtimeRoot, 'active', 'wsl', 'home'),
    marker: pathPosix.join(runtimeRoot, DRAIN_MARKER_NAME),
    runtimeHome
  }
}

async function finalizeAbsentLegacyAuth(
  distro: string,
  paths: ReturnType<typeof resolveLegacyRuntimePaths>
): Promise<void> {
  const result = await runWslProcess({
    distro,
    loginPath: 'none',
    script: FINALIZE_ABSENT_AUTH_SCRIPT,
    args: [paths.runtimeHome, paths.activeHome, paths.marker],
    timeoutMs: 5_000,
    maxOutputBytes: 16 * 1024
  })
  assertSuccessfulDrainStep('finalize', result)
}

function assertSuccessfulDrainStep(
  step: string,
  result: { code: number | null; stderr: string; timedOut: boolean }
): void {
  if (result.code === 0 && !result.timedOut) {
    return
  }
  const detail = result.stderr.trim()
  throw new Error(
    `Legacy WSL auth drain ${step} failed (${result.timedOut ? 'timeout' : `exit ${result.code}`})${detail ? `: ${detail}` : ''}`
  )
}

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex')
}

const RESOLVE_LEGACY_HOME_SCRIPT = `
legacy_home="$1"
legacy_home_resolved=0
if [ -e "$1" ] || [ -L "$1" ]; then
  legacy_home=$(readlink -f -- "$1") || exit 30
  legacy_home_resolved=1
fi
if [ -e "$2" ] || [ -L "$2" ]; then
  active_home=$(readlink -f -- "$2") || exit 31
  if [ "$legacy_home_resolved" = 1 ]; then
    [ "$active_home" = "$legacy_home" ] || exit 32
  else
    legacy_home="$active_home"
  fi
fi
`

const INSPECT_LEGACY_AUTH_SCRIPT = `
set -eu
[ ! -f "$3" ] || exit ${MARKER_PRESENT_EXIT}
${RESOLVE_LEGACY_HOME_SCRIPT}
source_auth="$legacy_home/auth.json"
[ -f "$source_auth" ] || exit ${SOURCE_AUTH_ABSENT_EXIT}
encode_file() {
  encoded=$(base64 < "$1") || return 1
  printf '%s' "$encoded" | tr -d '\n'
}
encode_file "$source_auth"
printf '\n'
source_credentials="$legacy_home/.credentials.json"
if [ -f "$source_credentials" ]; then
  printf 'present\n'
  encode_file "$source_credentials"
  printf '\n'
elif [ ! -e "$source_credentials" ] && [ ! -L "$source_credentials" ]; then
  printf 'missing\n\n'
else
  exit 44
fi
`

const APPLY_LEGACY_AUTH_SCRIPT = `
set -eu
[ ! -f "$3" ] || exit 0
${RESOLVE_LEGACY_HOME_SCRIPT}
target_home=$(readlink -f -- "$4") || exit 33
[ "$legacy_home" != "$target_home" ] || exit 34
source_auth="$legacy_home/auth.json"
target_auth="$target_home/auth.json"
[ -f "$source_auth" ] || exit 35
[ -f "$target_auth" ] || exit 36
hash_file() { sha256sum -- "$1" | cut -d ' ' -f 1; }
[ "$(hash_file "$source_auth")" = "$5" ] || exit 37
[ "$(hash_file "$target_auth")" = "$6" ] || exit 38
umask 077
temporary_auth="$target_auth.orca-drain-$$"
temporary_credentials="$target_home/.credentials.json.orca-drain-$$"
temporary_previous_auth="$target_auth.orca-drain-previous-$$"
temporary_marker="$3.orca-drain-$$"
cleanup() { rm -f -- "$temporary_auth" "$temporary_credentials" "$temporary_previous_auth" "$temporary_marker"; }
trap cleanup EXIT HUP INT TERM
source_credentials="$legacy_home/.credentials.json"
target_credentials="$target_home/.credentials.json"
if [ -f "$source_credentials" ] && [ ! -e "$target_credentials" ] && [ ! -L "$target_credentials" ]; then
  [ "$9" != missing ] || exit 43
  [ "$(hash_file "$source_credentials")" = "$9" ] || exit 43
  cp -- "$source_credentials" "$temporary_credentials"
  chmod 600 "$temporary_credentials"
  [ "$(hash_file "$temporary_credentials")" = "$9" ] || exit 43
  [ "$(hash_file "$source_credentials")" = "$9" ] || exit 43
  mv -n -- "$temporary_credentials" "$target_credentials"
elif [ "$9" = missing ] && [ ! -e "$target_credentials" ] && [ ! -L "$target_credentials" ]; then
  [ ! -e "$source_credentials" ] && [ ! -L "$source_credentials" ] || exit 43
fi
if [ "$7" = 1 ]; then
  cp -- "$source_auth" "$temporary_auth"
  chmod 600 "$temporary_auth"
  # Codex rewrites auth.json in place, so this copy is a second read: verify the
  # bytes being promoted, not the ones freshness was judged on.
  [ "$(hash_file "$temporary_auth")" = "$5" ] || exit 42
  [ "$(hash_file "$target_auth")" = "$6" ] || exit 39
  # The hard link keeps the destination inode observable without creating a
  # missing-path crash window. In-place writers update both names.
  ln -- "$target_auth" "$temporary_previous_auth"
  [ "$(hash_file "$temporary_previous_auth")" = "$6" ] || exit 39
  mv -f -- "$temporary_auth" "$target_auth"
  if [ "$(hash_file "$temporary_previous_auth")" != "$6" ]; then
    mv -f -- "$temporary_previous_auth" "$target_auth"
    exit 39
  fi
  rm -- "$temporary_previous_auth"
fi
if [ "$8" = 1 ]; then
  [ "$(hash_file "$source_auth")" = "$5" ] || exit 40
  rm -- "$source_auth"
  printf '%s\n' '{"completed":true}' > "$temporary_marker"
  chmod 600 "$temporary_marker"
  mv -f -- "$temporary_marker" "$3"
fi
`

const FINALIZE_ABSENT_AUTH_SCRIPT = `
set -eu
[ ! -f "$3" ] || exit 0
${RESOLVE_LEGACY_HOME_SCRIPT}
[ ! -e "$legacy_home/auth.json" ] && [ ! -L "$legacy_home/auth.json" ] || exit 41
umask 077
temporary_marker="$3.orca-drain-$$"
trap 'rm -f -- "$temporary_marker"' EXIT HUP INT TERM
printf '%s\n' '{"completed":true}' > "$temporary_marker"
chmod 600 "$temporary_marker"
mv -f -- "$temporary_marker" "$3"
`

export const _internals = {
  applyLegacyAuthScript: APPLY_LEGACY_AUTH_SCRIPT,
  resetDrainQueue: (): void => {
    drainQueueByDistro.clear()
    completedDistroKeys.clear()
  }
}
