import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  ORCAD_BUILD_TARGET_FILENAME,
  MANTAD_VERSION,
  mantadArtifactFilenames,
  mantadArtifactHashPrefix
} from '../../shared/mantad-artifacts'
import { SERVER_TARGETS } from '../../shared/node-runtime-pin'
import { mantadAgentBrowserNativeName } from '../../shared/mantad-agent-browser-name'

/** Hash installed bytes in the build's order; a version marker is not proof of delivery. */
export async function readOrcadArtifactIdentity(directory: string): Promise<string> {
  const target = z
    .enum(SERVER_TARGETS)
    .parse((await readFile(join(directory, ORCAD_BUILD_TARGET_FILENAME), 'utf8')).trim())
  const platform = target.startsWith('win32-')
    ? 'win32'
    : target.startsWith('darwin-')
      ? 'darwin'
      : 'linux'
  const browser = mantadAgentBrowserNativeName(
    platform,
    target.split('-')[1] ?? '',
    target.endsWith('-musl') ? 'musl' : 'glibc'
  )
  const filenames = mantadArtifactFilenames(target)
  if (existsSync(join(directory, browser))) {
    filenames.push(browser)
  }
  const hash = createHash('sha256').update(mantadArtifactHashPrefix(target))
  for (const filename of filenames) {
    for await (const chunk of createReadStream(join(directory, filename))) {
      hash.update(chunk)
    }
  }
  return `${MANTAD_VERSION}+${hash.digest('hex').slice(0, 12)}`
}
