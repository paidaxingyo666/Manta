import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  ORCAD_NODE_RUNTIME_MARKER_FILENAME,
  ORCAD_SERVER_TARGET_FILENAME,
  ORCAD_TEMPLATE_MANIFEST_FILENAME,
  ORCAD_TEMPLATE_TARGETS_DIR,
  orcadTemplateCommonFilenames,
  orcadTemplateTargetFilenames
} from '../../src/shared/mantad-artifacts.ts'
import { NODE_RUNTIME_ASSETS, ORCAD_TEMPLATE_TARGETS } from '../../src/shared/node-runtime-pin.ts'

async function write(path, contents) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
  return createHash('sha256').update(contents).digest('hex')
}

function targetFileContents(target, filename) {
  if (filename === ORCAD_SERVER_TARGET_FILENAME) {
    return `${target}\n`
  }
  if (filename === ORCAD_NODE_RUNTIME_MARKER_FILENAME) {
    return `${NODE_RUNTIME_ASSETS[target].executableSha256}\n`
  }
  return `${target}:${filename}`
}

export async function writeOrcadTemplateTestFixture(resourcesDir) {
  const templateDir = join(resourcesDir, 'mantad-template')
  const commonSha256 = {}
  for (const filename of orcadTemplateCommonFilenames()) {
    commonSha256[filename] = await write(
      join(templateDir, ...filename.split('/')),
      Buffer.from(`common:${filename}`)
    )
  }
  const targets = {}
  for (const target of ORCAD_TEMPLATE_TARGETS) {
    const targetDir = join(templateDir, ORCAD_TEMPLATE_TARGETS_DIR, target)
    const files = {}
    for (const filename of orcadTemplateTargetFilenames(target)) {
      files[filename] = await write(
        join(targetDir, ...filename.split('/')),
        targetFileContents(target, filename)
      )
    }
    targets[target] = { files }
  }
  const browserName = 'agent-browser-linux-x64'
  targets['linux-x64-glibc'] = {
    ...targets['linux-x64-glibc'],
    browserName,
    browserSha256: await write(
      join(templateDir, ORCAD_TEMPLATE_TARGETS_DIR, 'linux-x64-glibc', browserName),
      'browser'
    )
  }
  await writeFile(
    join(templateDir, ORCAD_TEMPLATE_MANIFEST_FILENAME),
    JSON.stringify({ schemaVersion: 3, commonSha256, targets })
  )
  return templateDir
}
