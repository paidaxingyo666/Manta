#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  ORCAD_TEMPLATE_MANIFEST_FILENAME,
  ORCAD_TEMPLATE_TARGETS_DIR,
  orcadTemplateCommonFilenames,
  orcadTemplateTargetFilenames
} from '../../src/shared/mantad-artifacts.ts'
import { mantadAgentBrowserNativeName } from '../../src/shared/mantad-agent-browser-name.ts'
import { ORCAD_TEMPLATE_TARGETS } from '../../src/shared/node-runtime-pin.ts'
import { runProcessSync } from './script-child-process.mjs'
import { verifyPackagedOrcadTemplate } from './verify-packaged-mantad-template.cjs'

const root = resolve(import.meta.dirname, '../..')
const outputDir = join(root, 'out', 'mantad-template')
const buildDir = join(root, 'out', '.mantad-template-build')
const commonArtifacts = orcadTemplateCommonFilenames()

function isExecutable(filename) {
  return /(?:^|\/)(?:rg|spawn-helper)$/.test(filename)
}

function copy(source, destination, executable = false) {
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
  if (executable && process.platform !== 'win32') {
    chmodSync(destination, 0o755)
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** One full package per target; each needs that target's node-pty slot in out/mantad-prebuilds. */
function buildTargetPackage(target) {
  const packageDir = join(buildDir, target, 'mantad')
  const result = runProcessSync({
    program: process.execPath,
    args: [
      join(root, 'config/scripts/build-orcad-node.mjs'),
      '--target',
      target,
      '--out-dir',
      packageDir
    ],
    cwd: root,
    stdio: 'inherit',
    timeoutMs: null
  })
  if (result.code !== 0) {
    throw new Error(`mantad ${target} package build failed with exit ${result.code ?? 'unknown'}`)
  }
  return packageDir
}

function stageTarget(target, packageDir) {
  const destination = join(outputDir, ORCAD_TEMPLATE_TARGETS_DIR, target)
  const files = {}
  for (const filename of orcadTemplateTargetFilenames(target)) {
    const staged = join(destination, ...filename.split('/'))
    copy(join(packageDir, ...filename.split('/')), staged, isExecutable(filename))
    files[filename] = sha256(staged)
  }
  const browserName = mantadAgentBrowserNativeName(
    target.split('-')[0],
    target.split('-')[1],
    target.endsWith('-musl') ? 'musl' : 'glibc'
  )
  const browserSource = join(packageDir, browserName)
  if (!existsSync(browserSource)) {
    return { files }
  }
  const browserDestination = join(destination, browserName)
  copy(browserSource, browserDestination, true)
  return { files, browserName, browserSha256: sha256(browserDestination) }
}

function sameBytes(left, right) {
  return sha256(left) === sha256(right)
}

async function main() {
  rmSync(buildDir, { recursive: true, force: true })
  const packages = Object.fromEntries(
    ORCAD_TEMPLATE_TARGETS.map((target) => [target, buildTargetPackage(target)])
  )
  rmSync(outputDir, { recursive: true, force: true })
  mkdirSync(outputDir, { recursive: true })
  const [firstTarget] = ORCAD_TEMPLATE_TARGETS
  for (const filename of commonArtifacts) {
    const source = join(packages[firstTarget], ...filename.split('/'))
    // Why check every target: the template keeps one copy, so a per-target difference would ship wrong bytes.
    for (const target of ORCAD_TEMPLATE_TARGETS) {
      if (!sameBytes(source, join(packages[target], ...filename.split('/')))) {
        throw new Error(`${filename} differs between ${firstTarget} and ${target} packages`)
      }
    }
    copy(source, join(outputDir, ...filename.split('/')), isExecutable(filename))
  }
  const targets = Object.fromEntries(
    ORCAD_TEMPLATE_TARGETS.map((target) => [target, stageTarget(target, packages[target])])
  )
  const commonSha256 = Object.fromEntries(
    commonArtifacts.map((filename) => [filename, sha256(join(outputDir, filename))])
  )
  writeFileSync(
    join(outputDir, ORCAD_TEMPLATE_MANIFEST_FILENAME),
    `${JSON.stringify({ schemaVersion: 3, commonSha256, targets }, null, 2)}\n`
  )
  verifyPackagedOrcadTemplate(join(root, 'out'))
  rmSync(buildDir, { recursive: true, force: true })
  process.stdout.write(`[build-mantad-template] ok — ${ORCAD_TEMPLATE_TARGETS.length} targets\n`)
}

await main()
