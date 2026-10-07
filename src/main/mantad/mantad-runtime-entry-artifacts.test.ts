// Every separately built entry mantad starts by filename (a worker thread or a forked child) must
// ship in its slot: the bundle names it, the runtime looks for it beside mantad.js, and a missing
// file only shows up on a host as a feature that never starts.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, expect, it } from 'vitest'
import { runProcessSync } from '../../shared/child-process/run-process'
import { mantadArtifactFilenames } from '../../shared/mantad-artifacts'

const REPO_ROOT = join(__dirname, '..', '..', '..')
// The desktop's built entries follow this naming; mantad resolves them by these literal names.
const RUNTIME_ENTRY_FILENAME = /[A-Za-z0-9_.-]+-(?:entry|worker)\.c?js/g
/**
 * Named in mantad's bundle but not shipped yet. Each is a known gap, not an exemption: shipping
 * one removes it here, and this list may only shrink.
 */
const KNOWN_UNSHIPPED_ENTRIES = new Set([
  'session-scanner-service-entry.js',
  'wsl-transcript-fs-process-entry.js'
])
const directory = mkdtempSync(join(tmpdir(), 'orcad-runtime-entries-'))

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

/** mantad.js and every child it ships, built as build-mantad.mjs builds them. */
function buildOrcadBundles(): string[] {
  const builder = pathToFileURL(join(REPO_ROOT, 'config/scripts/mantad-entry-build.mjs')).href
  const script = `
    import { build } from 'esbuild'
    import { basename, join } from 'node:path'
    import * as entries from ${JSON.stringify(builder)}
    const out = ${JSON.stringify(directory)}
    await entries.buildOrcadEntry(join(out, 'mantad.js'))
    await Promise.all(Object.values(entries.ORCAD_CHILD_ENTRY_POINTS).map((entry) => build({
      entryPoints: [entry], bundle: true, platform: 'node', target: 'node18', format: 'cjs',
      outfile: join(out, basename(entry).replace(/\\.ts$/, '.js')),
      external: entries.ORCAD_EXTERNAL_MODULES, plugins: [entries.externalNativeAddons],
      logLevel: 'error'
    })))`
  const built = runProcessSync({
    program: process.execPath,
    args: ['--input-type=module', '-e', script],
    cwd: REPO_ROOT,
    env: { ...process.env, MANTA_BACKGROUND_LAUNCH: '1' },
    timeoutMs: 120_000
  })
  expect(built.code, built.stderr.slice(0, 2_000)).toBe(0)
  return readdirSync(directory).map((file) => readFileSync(join(directory, file), 'utf8'))
}

it('ships every worker and child entry mantad loads at runtime', () => {
  const named = new Set(
    buildOrcadBundles().flatMap((text) => text.match(RUNTIME_ENTRY_FILENAME) ?? [])
  )
  const shipped = new Set(mantadArtifactFilenames('linux-x64-glibc'))
  const missing = [...named].filter(
    (filename) => !shipped.has(filename) && !KNOWN_UNSHIPPED_ENTRIES.has(filename)
  )
  expect(missing, 'add these to MANTAD_ARTIFACTS and build them in build-mantad.mjs').toEqual([])
  // A gap that ships, or that mantad stops naming, must leave the known list.
  for (const filename of KNOWN_UNSHIPPED_ENTRIES) {
    expect(named.has(filename) && !shipped.has(filename), filename).toBe(true)
  }
})
