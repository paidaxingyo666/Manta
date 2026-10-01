/**
 * Collects the shared `~/.manta-remote/runtimes/node-<sha256>/` store (design D5 GC).
 *
 * A runtime is deleted only when all of these hold: no retained directory references it
 * (`.runtime-node` or `.runtime-ref-node-<sha>`), it is neither a pin this client runs nor the
 * newest other verified runtime (keep two), and a process check ran and found nothing executing
 * from it. Process evidence can only add holds; a scan that could not run keeps everything.
 *
 * Legacy `relay-*` / `mantad-*` directories are read for references and reported as
 * diagnostics, never deleted here (design D10 two-step hand-over).
 */
import { randomInt } from 'node:crypto'
import { ORCAD_RUNTIMES_DIRNAME } from '../../shared/mantad-artifacts'
import type { SshConnection } from './ssh-connection'
import { RELAY_REMOTE_DIR } from './relay-protocol'
import { inventoryRemoteInstallDirs } from './remote-install-model'
import {
  parseRuntimeStoreInventory,
  RUNTIME_STORE_ENTRY_NAME,
  RUNTIME_STORE_TOMBSTONE_NAME,
  RUNTIME_STORE_TOMBSTONE_PREFIX,
  runtimeStoreInventoryCommand,
  type RuntimeStoreInventory
} from './remote-node-runtime-store-inventory'
import { execCommand } from './ssh-relay-deploy-helpers'
import { isUnconfirmedSshCommandTermination } from './ssh-relay-exec-command'
import {
  moveRemoteTreeCommand,
  removeRemoteTreeCommand,
  restoreRemoteTreeCommand
} from './ssh-remote-commands'
import { isWindowsRemoteHost, joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'

const MAX_REMOVALS_PER_PASS = 8
const ABANDONED_TOMBSTONE_MS = 30 * 60_000

export type RuntimeStoreGcPlan = {
  /** `node-<sha>` entries to rename away and delete. */
  remove: string[]
  /** Abandoned tombstones whose runtime is still unwanted. */
  purgeTombstones: string[]
  kept: string[]
}

/** Why a sha must stay, or null when nothing holds it. */
function holdReason(
  sha: string,
  inventory: RuntimeStoreInventory,
  pins: ReadonlySet<string>
): string | null {
  if (!inventory.processCheckRan) {
    return 'process check unavailable'
  }
  if (pins.has(sha)) {
    return 'pinned'
  }
  if (inventory.referenced.has(sha)) {
    return 'referenced'
  }
  if (inventory.held.has(sha)) {
    return 'in use by a process'
  }
  return null
}

export function planRuntimeStoreGc(
  inventory: RuntimeStoreInventory,
  currentPins: readonly string[],
  now: number = Date.now()
): RuntimeStoreGcPlan {
  const pins = new Set(currentPins)
  // Keep two: the pin this client runs and the newest other verified runtime (the previous pin).
  const previous = inventory.verifiedNewestFirst
    .map((name) => RUNTIME_STORE_ENTRY_NAME.exec(name)?.[1])
    .find((sha): sha is string => !!sha && !pins.has(sha))
  if (previous) {
    pins.add(previous)
  }
  const verified = new Set(inventory.verifiedNewestFirst)
  const plan: RuntimeStoreGcPlan = { remove: [], purgeTombstones: [], kept: [] }
  for (const name of inventory.entries) {
    const entry = RUNTIME_STORE_ENTRY_NAME.exec(name)
    if (entry) {
      // Unverified means mid-promotion or torn; the installer, not GC, owns that state.
      const idle = verified.has(name) && holdReason(entry[1], inventory, pins) === null
      if (idle && plan.remove.length < MAX_REMOVALS_PER_PASS) {
        plan.remove.push(name)
      } else {
        plan.kept.push(name)
      }
      continue
    }
    const tombstone = RUNTIME_STORE_TOMBSTONE_NAME.exec(name)
    if (
      tombstone &&
      now - Number(tombstone[2]) >= ABANDONED_TOMBSTONE_MS &&
      holdReason(tombstone[1], inventory, pins) === null
    ) {
      plan.purgeTombstones.push(name)
    }
  }
  return plan
}

export type RuntimeStoreGcResult =
  | { state: 'skipped'; reason: string }
  | { state: 'collected'; removed: string[]; kept: string[]; legacyDirs: string[] }

function exec(conn: SshConnection, command: string, signal?: AbortSignal): Promise<string> {
  return execCommand(conn, command, { wrapCommand: true, signal })
}

async function readInventory(
  conn: SshConnection,
  host: RemoteHostPlatform,
  remoteHome: string,
  signal?: AbortSignal
): Promise<RuntimeStoreInventory | null> {
  try {
    return parseRuntimeStoreInventory(
      await exec(conn, runtimeStoreInventoryCommand(host, remoteHome), signal)
    )
  } catch (err) {
    if (isUnconfirmedSshCommandTermination(err)) {
      throw err
    }
    return null
  }
}

/**
 * One pass over the runtime store. Confirmed failures keep the runtime and end quietly; an
 * unconfirmed SSH termination is rethrown so the caller stops its cleanup chain.
 */
export async function gcRemoteNodeRuntimeStore(
  conn: SshConnection,
  host: RemoteHostPlatform,
  remoteHome: string,
  options: { currentPins: readonly string[]; signal?: AbortSignal }
): Promise<RuntimeStoreGcResult> {
  if (isWindowsRemoteHost(host)) {
    return { state: 'skipped', reason: 'Windows hosts have no managed runtime store yet' }
  }
  const inventory = await readInventory(conn, host, remoteHome, options.signal)
  if (!inventory) {
    return { state: 'skipped', reason: 'runtime store inventory was unverifiable' }
  }
  const legacy = inventoryRemoteInstallDirs(inventory.dirNames)
  const legacyDirs = [...legacy.relay, ...legacy.mantad]
  const plan = planRuntimeStoreGc(inventory, options.currentPins)
  const store = joinRemotePath(host, remoteHome, RELAY_REMOTE_DIR, ORCAD_RUNTIMES_DIRNAME)
  const removed: string[] = []
  const kept = [...plan.kept]
  for (const name of plan.purgeTombstones) {
    if (await removeTree(conn, host, joinRemotePath(host, store, name), options.signal)) {
      removed.push(name)
    }
  }
  for (const name of plan.remove) {
    const sha = RUNTIME_STORE_ENTRY_NAME.exec(name)?.[1] ?? ''
    const entryDir = joinRemotePath(host, store, name)
    const tombstone = joinRemotePath(
      host,
      store,
      `${RUNTIME_STORE_TOMBSTONE_PREFIX}${name}.${randomInt(1, 2 ** 47)}.${Date.now()}`
    )
    if (!(await moveTree(conn, host, entryDir, tombstone, options.signal))) {
      kept.push(name)
      continue
    }
    // Why recheck after the rename: an installer that saw this runtime present may be writing
    // its reference now; restoring is the only outcome that leaves its slot launchable.
    const recheck = await readInventory(conn, host, remoteHome, options.signal).catch(
      async (err: unknown) => {
        await restoreTree(conn, host, tombstone, entryDir, options.signal).catch(() => {})
        throw err
      }
    )
    if (!recheck || holdReason(sha, recheck, new Set(options.currentPins)) !== null) {
      await restoreTree(conn, host, tombstone, entryDir, options.signal)
      kept.push(name)
      continue
    }
    if (await removeTree(conn, host, tombstone, options.signal)) {
      removed.push(name)
    } else {
      kept.push(name)
    }
  }
  if (removed.length > 0) {
    const legacyNote =
      legacyDirs.length > 0
        ? `; legacy install dirs left for the migration sweep: ${legacyDirs.join(', ')}`
        : ''
    console.log(`[runtime-store] GC: removed ${removed.join(', ')}${legacyNote}`)
  }
  return { state: 'collected', removed, kept, legacyDirs }
}

async function moveTree(
  conn: SshConnection,
  host: RemoteHostPlatform,
  source: string,
  destination: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    return (
      (await exec(conn, moveRemoteTreeCommand(host, source, destination), signal)).trim() ===
      'MOVED'
    )
  } catch (err) {
    if (isUnconfirmedSshCommandTermination(err)) {
      throw err
    }
    return false
  }
}

async function restoreTree(
  conn: SshConnection,
  host: RemoteHostPlatform,
  tombstone: string,
  entryDir: string,
  signal?: AbortSignal
): Promise<void> {
  await exec(conn, restoreRemoteTreeCommand(host, tombstone, entryDir), signal).catch((err) => {
    if (isUnconfirmedSshCommandTermination(err)) {
      throw err
    }
  })
}

async function removeTree(
  conn: SshConnection,
  host: RemoteHostPlatform,
  path: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    await exec(conn, removeRemoteTreeCommand(host, path), signal)
    return true
  } catch (err) {
    if (isUnconfirmedSshCommandTermination(err)) {
      throw err
    }
    return false
  }
}
