import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function createLocalBuildVersion(baseVersion, timestamp, commit) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(baseVersion)) {
    throw new Error(`Package version is not valid semver: ${baseVersion}`)
  }
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error('Local build timestamp is invalid.')
  }
  const sanitizedCommit = commit.replace(/[^0-9A-Za-z-]/g, '').slice(0, 12)
  if (!sanitizedCommit) {
    throw new Error('Git commit identity is empty.')
  }
  const suffix = `local.${timestamp}.${sanitizedCommit}`
  return baseVersion.includes('-') ? `${baseVersion}.${suffix}` : `${baseVersion}-${suffix}`
}

export function getLocalBuildIdentity() {
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  const commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    encoding: 'utf8'
  }).trim()
  return {
    commit,
    version: createLocalBuildVersion(packageJson.version, Date.now(), commit)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const identity = getLocalBuildIdentity()
  const localArch = process.arch === 'x64' ? 'x64' : 'arm64'
  console.log(`[build:mac] local update version ${identity.version} (${localArch} only)`)
  execFileSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    // Why arch-suffixed targets rather than a bare --mac: the config ships x64
    // and arm64 for release, and a bare --mac here would build both — half an
    // hour and 1.4GB for a slice no local check ever opens, plus a second
    // Manta.app one directory over that runs under Rosetta if opened by
    // mistake. A CLI target carrying an `:arch` suffix replaces the config's
    // arch list outright, so this stays one arch without the release config
    // knowing anything about it.
    [
      'exec',
      'electron-builder',
      '--config',
      'config/electron-builder.config.cjs',
      '--mac',
      `dmg:${localArch}`,
      `zip:${localArch}`
    ],
    {
      env: {
        ...process.env,
        MANTA_BUILD_COMMIT: identity.commit,
        MANTA_LOCAL_BUILD_VERSION: identity.version
      },
      stdio: 'inherit'
    }
  )
}
