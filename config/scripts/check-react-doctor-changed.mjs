import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { resolvePullRequestDiffBase } from './git-pull-request-diff-base.mjs'
import {
  partitionByAuthor,
  upstreamRefIsAvailable
} from './react-doctor-upstream-line-attribution.mjs'

const requestedBase =
  process.argv.slice(2).find((argument) => argument !== '--') ??
  process.env.MANTA_CODE_QUALITY_BASE ??
  'origin/main'
const base = resolvePullRequestDiffBase(process.cwd(), requestedBase)
const upstreamRef = process.env.MANTA_UPSTREAM_REF ?? 'upstream/main'
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

// Why the fork owns everything when upstream is out of reach: a missing remote
// must not quietly relax the gate. Without attribution this behaves exactly as
// it did before the filter existed.
const canAttribute = upstreamRefIsAvailable(upstreamRef)

const reportDir = mkdtempSync(join(tmpdir(), 'manta-react-doctor-'))
const reportPath = join(reportDir, 'report.json')
const args = [
  'dlx',
  'react-doctor@0.9.1',
  '.',
  '--yes',
  '--scope',
  'lines',
  '--base',
  base,
  '--include-untracked',
  '--no-dead-code',
  '--no-supply-chain',
  '--no-telemetry',
  '--blocking',
  'error'
]

// Reported through JSON only when attribution can actually run; otherwise keep
// react-doctor's own output and exit code, which is the better failure message.
if (!canAttribute) {
  console.warn(
    `react-doctor: ${upstreamRef} is not available, so every finding is attributed to this fork.`
  )
  const passthrough = spawnSync(pnpm, args, { stdio: 'inherit' })
  if (passthrough.error) {
    throw passthrough.error
  }
  rmSync(reportDir, { recursive: true, force: true })
  process.exit(passthrough.status ?? 1)
}

const result = spawnSync(pnpm, [...args.slice(0, -1), 'none', '--json', '--json-out', reportPath], {
  stdio: 'inherit'
})
if (result.error) {
  throw result.error
}

let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} finally {
  rmSync(reportDir, { recursive: true, force: true })
}

const errors = (report.diagnostics ?? []).filter((diagnostic) => diagnostic.severity === 'error')
const { ours, upstream } = partitionByAuthor(errors, upstreamRef)

// Never silent: a gate that drops findings without saying so reads as "clean".
if (upstream.length > 0) {
  const files = [...new Set(upstream.map((diagnostic) => diagnostic.filePath))].sort()
  console.log(
    `\nreact-doctor: ${upstream.length} error(s) left to upstream — the exact line ` +
      `also exists in ${upstreamRef}, so this fork did not write them:`
  )
  for (const file of files) {
    const lines = upstream
      .filter((diagnostic) => diagnostic.filePath === file)
      .map((diagnostic) => diagnostic.line)
      .join(', ')
    console.log(`  ${file}:${lines}`)
  }
}

if (ours.length > 0) {
  console.error(`\nreact-doctor: ${ours.length} error(s) in lines this fork wrote:`)
  for (const diagnostic of ours) {
    console.error(
      `::error file=${diagnostic.filePath},line=${diagnostic.line},title=${diagnostic.rule}::${diagnostic.title} — ${diagnostic.message}`
    )
    console.error(`  ${diagnostic.filePath}:${diagnostic.line} ${diagnostic.rule}`)
  }
  process.exit(1)
}

console.log(`\nreact-doctor: no errors in lines this fork wrote (base ${base}).`)
process.exit(0)
