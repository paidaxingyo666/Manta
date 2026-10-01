import { basename, dirname } from 'node:path'
import process from 'node:process'
import type { RelayRuntimeKind } from '../shared/relay-runtime-self-test-report'

/**
 * Which runtime is executing this relay: Manta's pinned Node lives at
 * `runtimes/node-<sha256>/bin/node` (design D5); any other path is a host Node.
 */
export function describeRelayRuntime(execPath: string = process.execPath): {
  kind: RelayRuntimeKind
  version: string
} {
  const runtimeDir = dirname(dirname(execPath))
  const pinned =
    basename(dirname(execPath)) === 'bin' &&
    /^node-[0-9a-f]{64}$/.test(basename(runtimeDir)) &&
    basename(dirname(runtimeDir)) === 'runtimes'
  return { kind: pinned ? 'pinned-node' : 'host-node', version: process.versions.node }
}
