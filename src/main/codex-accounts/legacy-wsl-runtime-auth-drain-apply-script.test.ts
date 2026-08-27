import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { _internals } from './legacy-wsl-runtime-auth-drain'

const isWindows = process.platform === 'win32'

const SOURCE_AUTH = '{"tokens":{"expires_at":2000}}\n'
const TARGET_AUTH = '{"tokens":{"expires_at":1000}}\n'
const NEWER_AUTH = '{"tokens":{"expires_at":3000}}\n'
// Codex truncates before it writes, so a read landing mid-rotation sees this.
const TORN_AUTH = '{"tokens":{"exp'
const SOURCE_CREDENTIALS = '{"server":{"access_token":"source"}}\n'
const TORN_CREDENTIALS = '{"server":'

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex')
}

/**
 * Runs the real guest script under `sh`, with `sha256sum` shimmed so a chosen
 * hash call can rewrite the source underneath the script. That is the only way
 * to land Codex's in-place rotation inside the window the script itself opens.
 */
function runApplyScript(
  options: {
    rewriteSourceAfterHashCall?: number
    rewriteBytes?: string
    rewriteTarget?: 'source-auth' | 'source-credentials' | 'target-auth'
    sourceCredentials?: string
  } = {}
): {
  legacyAuth: string
  status: number
  targetAuth: string
  targetCredentials: string | null
} {
  const root = mkdtempSync(join(tmpdir(), 'orca-drain-apply-'))
  const legacyHome = join(root, 'legacy')
  const targetHome = join(root, 'account')
  const binDir = join(root, 'bin')
  for (const dir of [legacyHome, targetHome, binDir]) {
    mkdirSync(dir, { recursive: true })
  }
  const legacyAuthPath = join(legacyHome, 'auth.json')
  const targetAuthPath = join(targetHome, 'auth.json')
  const legacyCredentialsPath = join(legacyHome, '.credentials.json')
  const targetCredentialsPath = join(targetHome, '.credentials.json')
  writeFileSync(legacyAuthPath, SOURCE_AUTH)
  writeFileSync(targetAuthPath, TARGET_AUTH)
  if (options.sourceCredentials !== undefined) {
    writeFileSync(legacyCredentialsPath, options.sourceCredentials)
  }

  const counterPath = join(root, 'hash-calls')
  writeFileSync(counterPath, '0')
  const shimPath = join(binDir, 'sha256sum')
  writeFileSync(
    shimPath,
    `#!/usr/bin/env node
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const file = process.argv[process.argv.length - 1]
process.stdout.write(
  createHash('sha256').update(fs.readFileSync(file)).digest('hex') + '  ' + file + '\\n'
)
const calls = Number(fs.readFileSync(process.env.HASH_COUNTER, 'utf8')) + 1
fs.writeFileSync(process.env.HASH_COUNTER, String(calls))
if (process.env.REWRITE_AFTER && calls === Number(process.env.REWRITE_AFTER)) {
  fs.writeFileSync(process.env.REWRITE_TARGET, process.env.REWRITE_BYTES)
}
`
  )
  chmodSync(shimPath, 0o755)

  let status = 0
  try {
    execFileSync(
      '/bin/sh',
      [
        '-c',
        _internals.applyLegacyAuthScript,
        'sh',
        legacyHome,
        join(root, 'absent-active-home'),
        join(root, 'absent-marker.json'),
        targetHome,
        sha256(SOURCE_AUTH),
        sha256(TARGET_AUTH),
        '1',
        '0',
        options.sourceCredentials === undefined ? 'missing' : sha256(options.sourceCredentials)
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          HASH_COUNTER: counterPath,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          REWRITE_AFTER: options.rewriteSourceAfterHashCall
            ? String(options.rewriteSourceAfterHashCall)
            : '',
          REWRITE_BYTES: options.rewriteBytes ?? TORN_AUTH,
          REWRITE_TARGET:
            options.rewriteTarget === 'source-credentials'
              ? legacyCredentialsPath
              : options.rewriteTarget === 'target-auth'
                ? targetAuthPath
                : legacyAuthPath
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20_000
      }
    )
  } catch (error) {
    status = (error as { status?: number }).status ?? -1
  }
  return {
    legacyAuth: readFileSync(legacyAuthPath, 'utf8'),
    status,
    targetAuth: readFileSync(targetAuthPath, 'utf8'),
    targetCredentials: existsSync(targetCredentialsPath)
      ? readFileSync(targetCredentialsPath, 'utf8')
      : null
  }
}

describe.skipIf(isWindows)('legacy WSL auth drain apply script', () => {
  it('promotes the validated source into the account home', () => {
    const outcome = runApplyScript()
    expect(outcome.targetAuth).toBe(SOURCE_AUTH)
  })

  it('leaves the legacy home untouched while promoting', () => {
    // One-directional: the promote step must never write back to the old home.
    expect(runApplyScript().legacyAuth).toBe(SOURCE_AUTH)
  })

  it('refuses torn bytes and leaves the account home intact', () => {
    // Hash call 1 is the source pre-check; rotating right after it means `cp`
    // reads bytes freshness never judged. Pre-guard, those reached the target.
    const outcome = runApplyScript({ rewriteSourceAfterHashCall: 1 })
    expect(outcome.status).toBe(42)
    expect(outcome.targetAuth).toBe(TARGET_AUTH)
  })

  it('refuses MCP credentials that changed after host validation', () => {
    const outcome = runApplyScript({
      rewriteSourceAfterHashCall: 2,
      rewriteBytes: TORN_CREDENTIALS,
      rewriteTarget: 'source-credentials',
      sourceCredentials: SOURCE_CREDENTIALS
    })
    expect(outcome.status).toBe(43)
    expect(outcome.targetCredentials).toBeNull()
  })

  it('does not overwrite auth changed after the destination hash check', () => {
    const outcome = runApplyScript({
      rewriteBytes: NEWER_AUTH,
      rewriteSourceAfterHashCall: 4,
      rewriteTarget: 'target-auth'
    })
    expect(outcome.status).toBe(39)
    expect(outcome.targetAuth).toBe(NEWER_AUTH)
  })
})
