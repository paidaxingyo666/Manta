import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { lock } from 'proper-lockfile'
import { APPIMAGE_EXTRACTION_TIMEOUT_MS } from './appimage-extraction-pruning'

const LOCK_TARGET_NAME = '.cli-registration'
const LOCK_STALE_MS = APPIMAGE_EXTRACTION_TIMEOUT_MS * 3
const LOCK_RETRIES = {
  retries: 1_000,
  factor: 1.2,
  minTimeout: 25,
  maxTimeout: 1_000,
  randomize: true
}

export async function withAppImageRegistrationLock<T>(
  cacheRootPath: string,
  operation: () => Promise<T>
): Promise<T> {
  await mkdir(cacheRootPath, { recursive: true, mode: 0o700 })
  const release = await lock(join(cacheRootPath, LOCK_TARGET_NAME), {
    realpath: false,
    retries: LOCK_RETRIES,
    stale: LOCK_STALE_MS,
    update: APPIMAGE_EXTRACTION_TIMEOUT_MS / 10
  })
  try {
    return await operation()
  } finally {
    await release()
  }
}
