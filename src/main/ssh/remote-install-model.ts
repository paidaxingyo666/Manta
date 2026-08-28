/**
 * The two things Manta installs into `~/.manta-remote/`, and the rules that keep them from
 * touching each other.
 *
 * `docs/design/shipping-orcad.html` §06 settles that on-disk coexistence is permanent: the
 * relay is the dumb execution host for SSH-target users, mantad is the peer for paired
 * environments, and no plan item retires either. So `relay-<version>/` and `mantad-<version>/`
 * sit side by side forever, and the namespace has to be a parameter rather than a literal.
 *
 * GC ownership is the trap that parameterization creates. Each model garbage-collects ONLY
 * its own directories — see `remoteInstallDirOwner`. Relay's regex happened to be narrow
 * enough already; making the prefix a parameter is exactly what could have widened it into
 * deleting a live mantad tree, so the ownership rule is asserted here rather than left to
 * whichever regex a caller passes.
 */
import {
  relayArtifactFilenames,
  RELAY_INSTALL_COMPLETE_FILENAME,
  RELAY_VERSION_FILENAME
} from '../../shared/relay-artifacts'
import {
  mantadArtifactFilenames,
  MANTAD_INSTALL_COMPLETE_FILENAME,
  MANTAD_VERSION_FILENAME
} from '../../shared/mantad-artifacts'

export type RemoteInstallModelId = 'relay' | 'mantad'

export type RemoteInstallModel = {
  readonly id: RemoteInstallModelId
  /** Leading segment of every version dir: `<dirPrefix>-<fullVersion>`. */
  readonly dirPrefix: string
  /** npm package name written into the remote `package.json` for native deps. */
  readonly nativeDepsPackageName: string
  readonly versionFilename: string
  readonly installCompleteFilename: string
  /** Files whose absence means a torn install, so the probe forces a re-deploy. */
  requiredArtifacts(isWindows: boolean): string[]
}

export const RELAY_INSTALL_MODEL: RemoteInstallModel = {
  id: 'relay',
  dirPrefix: 'relay',
  nativeDepsPackageName: 'manta-relay',
  versionFilename: RELAY_VERSION_FILENAME,
  installCompleteFilename: RELAY_INSTALL_COMPLETE_FILENAME,
  requiredArtifacts: (isWindows) => relayArtifactFilenames(isWindows)
}

export const MANTAD_INSTALL_MODEL: RemoteInstallModel = {
  id: 'mantad',
  dirPrefix: 'mantad',
  nativeDepsPackageName: 'manta-mantad',
  versionFilename: MANTAD_VERSION_FILENAME,
  installCompleteFilename: MANTAD_INSTALL_COMPLETE_FILENAME,
  // Why the parameter is ignored: mantad's forked children are the same three .js files on
  // every host. The Windows-only console-list agent patch is a relay/node-pty concern.
  requiredArtifacts: () => mantadArtifactFilenames()
}

export const REMOTE_INSTALL_MODELS: readonly RemoteInstallModel[] = [
  RELAY_INSTALL_MODEL,
  MANTAD_INSTALL_MODEL
]

/**
 * The version half of a directory name, shared by both models.
 *
 * Why `[0-9]` and not `\d`: this exact source string is also embedded in an awk ERE and a
 * PowerShell `-match` on the remote host. Those three dialects agree on `[0-9]`, `\.` and
 * `\+`; only JavaScript understands `\d`.
 */
const VERSION_PATTERN = String.raw`v?[0-9]+\.[0-9]+\.[0-9]+(\+[0-9a-f]+)?`

/** Suffix GC leaves behind mid-delete; the listing must surface these so they can be swept. */
const TOMBSTONE_PATTERN = String.raw`\.gc-tombstone\.[0-9]+\.[0-9]+`

/**
 * Why validated and not merely typed: the prefix is interpolated into a remote `find -name`
 * glob, an awk regex and a single-quoted PowerShell literal. A quote or a metacharacter
 * here would be a remote-shell injection on the client's own connection.
 */
function assertSafeDirPrefix(dirPrefix: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(dirPrefix)) {
    throw new Error(`Unsafe remote install dir prefix: ${JSON.stringify(dirPrefix)}`)
  }
}

export function remoteInstallDirName(model: RemoteInstallModel, fullVersion: string): string {
  assertSafeDirPrefix(model.dirPrefix)
  return `${model.dirPrefix}-${fullVersion}`
}

/** Matches a live version dir for exactly one model — never a tombstone, never a sibling model. */
export function remoteInstallVersionDirRegex(model: RemoteInstallModel): RegExp {
  assertSafeDirPrefix(model.dirPrefix)
  return new RegExp(`^${model.dirPrefix}-(${VERSION_PATTERN})$`)
}

/** What the remote listing is allowed to return: live dirs plus their tombstones. */
export function remoteInstallListingRegexSource(model: RemoteInstallModel): string {
  assertSafeDirPrefix(model.dirPrefix)
  return `^${model.dirPrefix}-(${VERSION_PATTERN})(${TOMBSTONE_PATTERN})?$`
}

/**
 * Which model owns a directory found in `~/.manta-remote/`, or null for anything neither
 * model created.
 *
 * This is the answer to §06 falsifier 1's first half: **the model that created a directory
 * owns it, and nothing else may delete it.** A relay GC pass that saw `mantad-0.1.0+abc`
 * would be looking at the live install of a peer whose lifecycle it has no view into — the
 * SSH-execution-boundary collapse in directory form.
 */
export function remoteInstallDirOwner(dirName: string): RemoteInstallModelId | null {
  for (const model of REMOTE_INSTALL_MODELS) {
    if (new RegExp(remoteInstallListingRegexSource(model)).test(dirName)) {
      return model.id
    }
  }
  return null
}

/** True when `model` is allowed to garbage-collect `dirName`. */
export function remoteInstallGcPermits(model: RemoteInstallModel, dirName: string): boolean {
  return remoteInstallDirOwner(dirName) === model.id
}

export type RemoteInstallInventory = Record<RemoteInstallModelId | 'unknown', string[]>

/** Group a raw `~/.manta-remote/` listing by owning model, for diagnostics and the client's choice. */
export function inventoryRemoteInstallDirs(dirNames: readonly string[]): RemoteInstallInventory {
  const inventory: RemoteInstallInventory = { relay: [], mantad: [], unknown: [] }
  for (const name of dirNames) {
    const owner = remoteInstallDirOwner(name)
    if (owner) {
      inventory[owner].push(name)
    } else {
      inventory.unknown.push(name)
    }
  }
  return inventory
}
