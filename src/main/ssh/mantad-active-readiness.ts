/** Proving that the mantad an activation record names is the one actually serving. */
import { evaluateOrcadActivation, type OrcadActivationExpectation } from './mantad-activation-gate'
import {
  orcadLivenessProbeCommand,
  parseOrcadLiveness,
  parseOrcadReadinessOutput,
  readOrcadReadinessCommand,
  type OrcadLaunchSpec,
  type OrcadReadinessParse
} from './mantad-remote-launch'
import {
  execOrcadRemote,
  launchOrcadAndAwaitReadiness,
  type OrcadRemoteExecTarget
} from './mantad-remote-runtime-control'
import type { ServeReadiness } from '../server/serve-readiness'

/** `exited` is proven absence; `unverifiable` means the host could not say, which is not death. */
export type OrcadReadinessFailureVerdict = 'exited' | 'unverifiable' | 'rejected'

export class OrcadActiveReadinessError extends Error {
  constructor(
    readonly verdict: OrcadReadinessFailureVerdict,
    message: string
  ) {
    super(message)
    this.name = 'OrcadActiveReadinessError'
  }
}

function gatedReadiness(
  parsed: OrcadReadinessParse,
  expectation: OrcadActivationExpectation,
  label: string
): ServeReadiness {
  const readiness = parsed.state === 'ready' ? parsed.readiness : null
  const verdict = evaluateOrcadActivation(readiness, expectation)
  if (verdict.decision === 'reject') {
    throw new OrcadActiveReadinessError(
      'rejected',
      `${label} failed its readiness check: ${verdict.reason}`
    )
  }
  if (!readiness) {
    throw new OrcadActiveReadinessError(
      'rejected',
      `${label} passed activation without a readiness payload.`
    )
  }
  return readiness
}

/** Checks a recorded-active slot without starting anything. */
export async function probeActiveOrcadReadiness(
  target: OrcadRemoteExecTarget & { remoteInstallDir: string },
  expectation: OrcadActivationExpectation
): Promise<ServeReadiness> {
  const liveness = parseOrcadLiveness(
    await execOrcadRemote(target, orcadLivenessProbeCommand(target.host, target.remoteInstallDir))
  )
  if (liveness === 'DEAD') {
    throw new OrcadActiveReadinessError(
      'exited',
      `mantad ${expectation.fullVersion} is recorded active but its process has exited.`
    )
  }
  if (liveness !== 'LIVE') {
    throw new OrcadActiveReadinessError(
      'unverifiable',
      `mantad ${expectation.fullVersion} process state is unverifiable.`
    )
  }
  const parsed = parseOrcadReadinessOutput(
    await execOrcadRemote(target, readOrcadReadinessCommand(target.host, target.remoteInstallDir))
  )
  return gatedReadiness(parsed, expectation, 'The active mantad')
}

/** Starts a slot (recovery or rollback) and accepts it only if it proves the expected build. */
export async function launchOrcadSlotAndAwaitReadiness(
  target: OrcadRemoteExecTarget & {
    readinessTimeoutMs?: number
    sleep?: (ms: number) => Promise<void>
  },
  spec: OrcadLaunchSpec,
  expectation: OrcadActivationExpectation
): Promise<ServeReadiness> {
  const parsed = await launchOrcadAndAwaitReadiness(target, spec)
  return gatedReadiness(parsed, expectation, `mantad ${spec.fullVersion}`)
}
