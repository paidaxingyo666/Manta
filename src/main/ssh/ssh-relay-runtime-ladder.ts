/**
 * The design D6 fallback ladder for the relay runtime, as data plus a pure step function:
 *
 *   A  Manta's pinned Node + slot prebuilds
 *   B  a compat pinned Node + compat addons (chosen only when a compat runtime exists)
 *   C  the host's Node >= 18 + Manta's N-API prebuilds, no npm
 *   legacy  the host's Node + npm install (kept until the default flips)
 *   D  nothing runs: fail the connect with the classified reason
 *
 * The ladder steps down only on a classified refusal (a `PinnedRelayFallbackError`); an
 * unverifiable probe or self-test throws and the next connect retries the same rung.
 */
import type { ServerTarget } from '../../shared/node-runtime-pin'
import type { SshRemoteRuntime, SshRemoteRuntimeRung } from '../../shared/ssh-types'
import type { GlibcVersion } from './mantad-deployment-target'
import { isGlibcBelow, type RelayRuntimeFallbackReason } from './ssh-relay-pinned-node'

export type RelayRuntimeStep = SshRemoteRuntimeRung

export type CompatRelayRuntime = {
  id: string
  /** The host target this runtime serves, e.g. linux-x64-glibc for a glibc 2.17 build. */
  hostTarget: ServerTarget
  /** Null for a musl or darwin target, which has no glibc to compare. */
  glibcFloor: GlibcVersion | null
}

/** Empty until a compat runtime ships; rung B is then chosen from this list alone. */
export const COMPAT_RELAY_RUNTIMES: readonly CompatRelayRuntime[] = []

export function relayRuntimeLadder(runtime: SshRemoteRuntime): readonly RelayRuntimeStep[] {
  return runtime === 'pinned-node' ? ['A', 'B', 'C', 'legacy', 'D'] : ['legacy']
}

export function compatRelayRuntimeFor(
  facts: { target: ServerTarget; glibc: GlibcVersion | null },
  catalog: readonly CompatRelayRuntime[] = COMPAT_RELAY_RUNTIMES
): CompatRelayRuntime | null {
  return (
    catalog.find(
      (runtime) =>
        runtime.hostTarget === facts.target &&
        (runtime.glibcFloor === null ||
          (facts.glibc !== null && !isGlibcBelow(facts.glibc, runtime.glibcFloor)))
    ) ?? null
  )
}

/** Why a rung could not run; the refusal classes plus reasons found before anything ran. */
export type RelayRuntimeStepReason = RelayRuntimeFallbackReason

/**
 * noexec defeats every rung, because each loads addons from the same `~/.manta-remote` tree;
 * no host Node rules out the npm path too, since it needs a host Node as well. A remembered
 * refusal only skips its own rung: the mount may have changed since it was proved.
 */
export function nextRelayRuntimeStep(
  ladder: readonly RelayRuntimeStep[],
  current: RelayRuntimeStep,
  reason: RelayRuntimeStepReason,
  remembered = false
): RelayRuntimeStep {
  if ((reason === 'noexec' && !remembered) || (current === 'C' && reason === 'host_node_missing')) {
    return 'D'
  }
  const index = ladder.indexOf(current)
  return ladder[index + 1] ?? 'D'
}

/** The machine-readable part of a rung D failure; the message is what the user reads. */
export const REMOTE_RUNTIME_UNAVAILABLE_REASONS = ['home_noexec', 'no_runtime'] as const
export type RemoteRuntimeUnavailableReason = (typeof REMOTE_RUNTIME_UNAVAILABLE_REASONS)[number]

export function remoteRuntimeUnavailableReason(
  lastReason: RelayRuntimeStepReason | null
): RemoteRuntimeUnavailableReason {
  return lastReason === 'noexec' ? 'home_noexec' : 'no_runtime'
}

const REMOTE_RUNTIME_UNAVAILABLE_MESSAGES: Record<RemoteRuntimeUnavailableReason, string> = {
  home_noexec:
    "Manta can't run its remote runtime on this host: the home directory is mounted noexec, so " +
    'nothing under ~/.manta-remote may execute. Remote terminals and file browsing are ' +
    'unavailable until an administrator allows exec there.',
  no_runtime:
    "Manta can't run its remote runtime on this host: its bundled Node.js was refused and no " +
    'Node.js 18 or newer was found on the host. Install Node.js 18+ on the host, then reconnect.'
}

export function remoteRuntimeUnavailableMessage(
  reason: RemoteRuntimeUnavailableReason,
  refusal: RelayRuntimeStepReason | null
): string {
  const base = REMOTE_RUNTIME_UNAVAILABLE_MESSAGES[reason]
  return refusal && reason !== 'home_noexec' ? `${base} (Manta's Node: ${refusal})` : base
}
