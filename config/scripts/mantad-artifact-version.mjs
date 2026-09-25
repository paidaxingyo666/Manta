import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MANTAD_VERSION, mantadArtifactFilenames } from '../../src/shared/mantad-artifacts.ts'

export function computeOrcadFullVersion(artifactDir) {
  const hash = createHash('sha256')
  for (const filename of mantadArtifactFilenames()) {
    const artifactPath = join(artifactDir, filename)
    if (!existsSync(artifactPath)) {
      throw new Error(
        `mantad declares ${filename} in MANTAD_ARTIFACTS but never emitted it. Add the build ` +
          'step, or drop it from src/shared/mantad-artifacts.ts.'
      )
    }
    hash.update(readFileSync(artifactPath))
  }
  return `${MANTAD_VERSION}+${hash.digest('hex').slice(0, 12)}`
}
