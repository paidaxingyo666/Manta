import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  prunePackagedLinearSdkSourceMaps,
  prunePackagedRuntimeNodeModules
} = require('../packaged-runtime-node-modules.cjs')

async function createLinearSdkFixture(resourcesDir) {
  const packageDir = join(resourcesDir, 'node_modules', '@linear', 'sdk')
  const distDir = join(packageDir, 'dist')
  const webhooksDir = join(packageDir, 'webhooks')
  const unrelatedPackageDir = join(resourcesDir, 'node_modules', 'unrelated-package')
  await mkdir(distDir, { recursive: true })
  await mkdir(webhooksDir, { recursive: true })
  await mkdir(unrelatedPackageDir, { recursive: true })
  await writeFile(
    join(packageDir, 'package.json'),
    '{"name":"@linear/sdk","type":"module","main":"./dist/index.cjs","exports":{".":{"require":"./dist/index.cjs","import":"./dist/index.mjs"}}}',
    'utf8'
  )
  await writeFile(join(packageDir, 'README.md'), 'SDK documentation', 'utf8')
  await writeFile(join(packageDir, 'metadata.json.map'), '{"keep":true}', 'utf8')
  await writeFile(
    join(distDir, 'index.cjs'),
    "module.exports = require('./runtime-helper.cjs')",
    'utf8'
  )
  await writeFile(
    join(distDir, 'runtime-helper.cjs'),
    'exports.LinearClient = class LinearClient {}',
    'utf8'
  )
  await writeFile(join(distDir, 'index.mjs'), 'export {}', 'utf8')
  await writeFile(join(distDir, 'index.cjs.map'), '{}', 'utf8')
  await writeFile(join(distDir, 'index.mjs.map'), '{}', 'utf8')
  await writeFile(join(webhooksDir, 'index.cjs'), 'module.exports = {}', 'utf8')
  await writeFile(join(webhooksDir, 'index.cjs.map'), '{}', 'utf8')
  await writeFile(join(unrelatedPackageDir, 'index.js.map'), '{}', 'utf8')
  return { packageDir, distDir, webhooksDir, unrelatedPackageDir }
}

describe('packaged @linear/sdk pruning', () => {
  it('removes source maps while preserving SDK runtime files, metadata, and unrelated maps', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-linear-sdk-prune-'))
    try {
      const { packageDir, distDir, webhooksDir, unrelatedPackageDir } =
        await createLinearSdkFixture(resourcesDir)

      prunePackagedLinearSdkSourceMaps(resourcesDir)

      await expect(readdir(distDir).then((entries) => entries.sort())).resolves.toEqual([
        'index.cjs',
        'index.mjs',
        'runtime-helper.cjs'
      ])
      await expect(readdir(webhooksDir)).resolves.toEqual(['index.cjs'])
      await expect(readFile(join(packageDir, 'package.json'), 'utf8')).resolves.toBe(
        '{"name":"@linear/sdk","type":"module","main":"./dist/index.cjs","exports":{".":{"require":"./dist/index.cjs","import":"./dist/index.mjs"}}}'
      )
      await expect(readFile(join(packageDir, 'README.md'), 'utf8')).resolves.toBe(
        'SDK documentation'
      )
      await expect(readFile(join(packageDir, 'metadata.json.map'), 'utf8')).resolves.toBe(
        '{"keep":true}'
      )
      await expect(readFile(join(unrelatedPackageDir, 'index.js.map'), 'utf8')).resolves.toBe('{}')
      const sdk = createRequire(join(resourcesDir, 'consumer.cjs'))('@linear/sdk')
      expect(typeof sdk.LinearClient).toBe('function')
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  it('runs the SDK source-map prune through aggregate runtime cleanup', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-linear-sdk-aggregate-prune-'))
    try {
      const { distDir } = await createLinearSdkFixture(resourcesDir)
      prunePackagedRuntimeNodeModules(resourcesDir, 'darwin', 'arm64')

      await expect(readdir(distDir).then((entries) => entries.sort())).resolves.toEqual([
        'index.cjs',
        'index.mjs',
        'runtime-helper.cjs'
      ])
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })
})
