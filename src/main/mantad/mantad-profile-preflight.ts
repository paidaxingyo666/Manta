import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { preflightProfileStateRuntime } from '../persistence/profile-state/profile-state-runtime-preflight'
import {
  ORCAD_STARTUP_PREFLIGHT_FLAG,
  ORCAD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseOrcadProfilePreflight,
  orcadProfilePreflightResponseSchema,
  type OrcadProfilePreflightResponse
} from '../../shared/mantad-profile-preflight'
import { readOrcadArtifactIdentity } from './mantad-artifact-identity'
import { MANTAD_VERSION_FILENAME } from '../../shared/mantad-artifacts'
import { ORCAD_NODE_RUNTIME_IDENTITY } from '../../shared/orcad-node-runtime-identity'
import { runProcess } from '../../shared/child-process/run-process'
import { preflightOrcadNativeRuntime } from './orcad-runtime-native-preflight'
import {
  isRunningAsBundledOrcadRuntime,
  OrcadBundledRuntimeError,
  resolveBundledOrcadSlot
} from './mantad-bundled-runtime'

/** Check every packaged start before a profile index, data-root lock or import is touched. */
export async function preflightBundledOrcadStartup(): Promise<void> {
  const directory = resolveBundledOrcadSlot()
  if (!isRunningAsBundledOrcadRuntime(directory)) {
    return
  }
  const identity = await readInstalledVersion(directory)
  const nonce = randomUUID()
  // Keep disposable SQLite ownership and native state out of the serving process.
  const result = await runProcess({
    program: process.execPath,
    args: [join(directory, 'mantad.js'), ORCAD_STARTUP_PREFLIGHT_FLAG, nonce],
    env: { ...process.env, MANTA_BACKGROUND_LAUNCH: '1' },
    timeoutMs: ORCAD_PROFILE_PREFLIGHT_TIMEOUT_MS,
    maxOutputBytes: 64 * 1024,
    terminationBarrier: true
  })
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    const Failure = result.code === 78 ? OrcadBundledRuntimeError : Error
    throw new Failure(`The bundled Manta runtime failed readiness: ${result.stderr}`)
  }
  try {
    parseOrcadProfilePreflight(result.stdout, nonce, ORCAD_NODE_RUNTIME_IDENTITY, identity)
  } catch (cause) {
    throw new OrcadBundledRuntimeError('The bundled runtime returned invalid readiness identity', {
      cause
    })
  }
}

/** Only disposable state is opened; no server, profile index or host adapters are installed. */
export async function runOrcadProfilePreflight(
  nonce: string | undefined,
  options: { nativeFeatures?: boolean } = {}
): Promise<void> {
  const checkedNonce = z.string().uuid().parse(nonce)
  const directory = resolveBundledOrcadSlot()
  let artifactVersion: string
  try {
    artifactVersion = await readOrcadArtifactIdentity(directory)
  } catch (cause) {
    throw new OrcadBundledRuntimeError('The bundled Manta artifacts are incomplete or altered', {
      cause
    })
  }
  const result = await preflightProfileStateRuntime()
  // Why only inside the pinned runtime: a host Node rollback launcher never serves this slot.
  if (isRunningAsBundledOrcadRuntime(directory)) {
    await preflightOrcadNativeRuntime(options)
  }
  const response: OrcadProfilePreflightResponse = {
    type: 'manta_profile_state_ready',
    nonce: checkedNonce,
    runtime: 'node',
    runtimeVersion: process.versions.node,
    artifactVersion,
    ...result
  }
  console.log(JSON.stringify(response))
}

async function readInstalledVersion(directory: string): Promise<string> {
  try {
    return orcadProfilePreflightResponseSchema.shape.artifactVersion.parse(
      (await readFile(join(directory, MANTAD_VERSION_FILENAME), 'utf8')).trim()
    )
  } catch (cause) {
    throw new OrcadBundledRuntimeError(
      'The installed Manta artifact version is missing or invalid',
      {
        cause
      }
    )
  }
}
