/**
 * Make pnpm-lock.yaml's patch hashes match the patch files on disk.
 *
 * pnpm records a sha256 of every file in `patchedDependencies` — and repeats it
 * inside every resolution key that depends on the patched package. A sync that
 * brings a changed patch leaves both stale, and `--frozen-lockfile` refuses the
 * tree. Recomputing beats re-resolving: resolution can fail for reasons
 * unrelated to the sync (a pin unpublished from the registry, a supply-chain
 * policy), and the dependency graph has not changed — only the bytes of a patch
 * the graph already references.
 *
 * The rewrite is `regenerate-xterm-patches.mjs`'s own, reused rather than
 * reimplemented: a first version here updated `patchedDependencies` alone and
 * left the resolution keys behind, which installs on a warm store and fails on
 * a cold one — which is CI.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  lockfileHasPatchEntry,
  lockfilePatchHashIsStale,
  updateLockfilePatchHash
} from '../../../config/scripts/regenerate-xterm-patches.mjs'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const workspacePath = path.join(root, 'pnpm-workspace.yaml')
const lockPath = path.join(root, 'pnpm-lock.yaml')
if (!existsSync(workspacePath) || !existsSync(lockPath)) {
  process.exit(0)
}

const section = /^patchedDependencies:\n((?:[ \t]+.*\n)+)/m.exec(readFileSync(workspacePath, 'utf8'))
if (!section) {
  console.log('no patchedDependencies')
  process.exit(0)
}
const patches = [...section[1].matchAll(/^\s+'?([^':]+(?::[^']*)?)'?:\s*(\S+)\s*$/gm)].map(
  ([, key, file]) => [key.replace(/^'|'$/g, ''), file]
)

let lockfile = readFileSync(lockPath, 'utf8')
const refreshed = []
for (const [packageKey, relativePath] of patches) {
  const patchPath = path.join(root, relativePath)
  if (!existsSync(patchPath)) {
    console.log(`! ${packageKey}: ${relativePath} missing`)
    continue
  }
  if (!lockfileHasPatchEntry(lockfile, packageKey)) {
    continue
  }
  const hash = createHash('sha256').update(readFileSync(patchPath)).digest('hex')
  if (!lockfilePatchHashIsStale(lockfile, packageKey, hash)) {
    continue
  }
  lockfile = updateLockfilePatchHash(lockfile, packageKey, hash)
  refreshed.push(packageKey)
}
if (refreshed.length > 0) {
  writeFileSync(lockPath, lockfile)
  console.log(`refreshed ${refreshed.length}: ${refreshed.join(', ')}`)
} else {
  console.log('all patch hashes already match')
}
