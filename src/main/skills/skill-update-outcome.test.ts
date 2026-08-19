import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  SkillFreshnessInstallation,
  SkillFreshnessStatus,
  SkillInstallationTopology
} from '../../shared/skill-freshness'
import { inventorySkillFreshness } from './skill-freshness-inventory'
import { observeSkillPackage } from './skill-package-identity'
import { readGloballyUpdatableSkillLocks } from './skill-update-registration'
import { skillUpdateFailedNames } from './skill-update-outcome'

const noLocks = new Map<string, string>()

function placement(
  name: string,
  status: SkillFreshnessStatus,
  topology: SkillInstallationTopology = 'canonical-copy',
  observedGitTreeSha: string | null = null
): SkillFreshnessInstallation {
  return {
    id: `${name}-${topology}-${status}`,
    name,
    rootId: 'home-agents',
    providers: ['agent-skills'],
    sourceKind: 'home',
    sourceLabel: 'Agent skills home',
    unresolvedPath: `/home/.agents/skills/${name}`,
    resolvedPath: `/home/.agents/skills/${name}`,
    physicalIdentity: `physical-${name}`,
    topology,
    status,
    installedReleaseRevision: 2,
    installedAppVersion: '2.0.0',
    currentReleaseRevision: 2,
    currentPackageDigest: 'current',
    currentAppVersion: '2.0.0',
    observedPackageDigest: 'current',
    observedGitTreeSha,
    errorCategory: null
  }
}

describe('skillUpdateFailedNames', () => {
  it('treats a convergent copy that is now current as landed', () => {
    expect(
      skillUpdateFailedNames(['manta-cli'], [placement('manta-cli', 'current')], noLocks)
    ).toEqual([])
  })

  it('reports a copy the run left outdated', () => {
    expect(
      skillUpdateFailedNames(['manta-cli'], [placement('manta-cli', 'outdated')], noLocks)
    ).toEqual(['manta-cli'])
  })

  it('reports a half-written bundle instead of reading it as success', () => {
    // The old "still eligible?" test passed here: an unrecognized copy is not
    // eligible either, so a corrupt write looked identical to a clean update.
    expect(
      skillUpdateFailedNames(['manta-cli'], [placement('manta-cli', 'unrecognized')], noLocks)
    ).toEqual(['manta-cli'])
  })

  it('reports an unreadable copy', () => {
    expect(
      skillUpdateFailedNames(['manta-cli'], [placement('manta-cli', 'inaccessible')], noLocks)
    ).toEqual(['manta-cli'])
  })

  it('reports a skill the run removed outright', () => {
    expect(skillUpdateFailedNames(['manta-cli'], [], noLocks)).toEqual(['manta-cli'])
  })

  it('accepts a revision newer than this build ships', () => {
    // The CLI pulls from the source repo, which runs ahead of the bundled manifest.
    expect(
      skillUpdateFailedNames(['manta-cli'], [placement('manta-cli', 'newer-known')], noLocks)
    ).toEqual([])
  })

  it('ignores placements the update command never writes to', () => {
    expect(
      skillUpdateFailedNames(
        ['manta-cli'],
        [placement('manta-cli', 'current'), placement('manta-cli', 'outdated', 'plugin-cache')],
        noLocks
      )
    ).toEqual([])
  })

  it('fails the name when any convergent alias was left behind', () => {
    expect(
      skillUpdateFailedNames(
        ['manta-cli'],
        [placement('manta-cli', 'current'), placement('manta-cli', 'outdated', 'provider-alias')],
        noLocks
      )
    ).toEqual(['manta-cli'])
  })

  it('judges each requested name independently', () => {
    expect(
      skillUpdateFailedNames(
        ['manta-cli', 'orchestration'],
        [placement('manta-cli', 'current'), placement('orchestration', 'outdated')],
        noLocks
      )
    ).toEqual(['orchestration'])
  })

  it('treats unrecognized content whose tree sha matches the lock as landed', () => {
    // Source-repo HEAD routinely runs ahead of the bundled registry; the lock is
    // the CLI's own record of what it wrote.
    expect(
      skillUpdateFailedNames(
        ['manta-cli'],
        [placement('manta-cli', 'unrecognized', 'canonical-copy', 'ahead-of-bundle')],
        new Map([['manta-cli', 'ahead-of-bundle']])
      )
    ).toEqual([])
  })

  it('still reports unrecognized content whose bytes do not match the lock', () => {
    expect(
      skillUpdateFailedNames(
        ['manta-cli'],
        [placement('manta-cli', 'unrecognized', 'canonical-copy', 'half-written-bytes')],
        new Map([['manta-cli', 'ahead-of-bundle']])
      )
    ).toEqual(['manta-cli'])
  })

  it('still reports unrecognized content when the skill has no lock entry', () => {
    expect(
      skillUpdateFailedNames(
        ['manta-cli'],
        [placement('manta-cli', 'unrecognized', 'canonical-copy', 'ahead-of-bundle')],
        noLocks
      )
    ).toEqual(['manta-cli'])
  })

  it('never forgives an outdated copy, even at the lock hash', () => {
    // Lock == disk on an outdated copy means the command provably wrote nothing.
    expect(
      skillUpdateFailedNames(
        ['manta-cli'],
        [placement('manta-cli', 'outdated', 'canonical-copy', 'locked-revision')],
        new Map([['manta-cli', 'locked-revision']])
      )
    ).toEqual(['manta-cli'])
  })

  it('does not let a lock-matching canonical copy excuse a degraded alias', () => {
    expect(
      skillUpdateFailedNames(
        ['manta-cli'],
        [
          placement('manta-cli', 'unrecognized', 'canonical-copy', 'ahead-of-bundle'),
          placement('manta-cli', 'inaccessible', 'provider-alias')
        ],
        new Map([['manta-cli', 'ahead-of-bundle']])
      )
    ).toEqual(['manta-cli'])
  })
})

describe('skillUpdateFailedNames over a real inventory', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..')
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
    )
  })

  async function postCutFixture(): Promise<{ homeDir: string; installedTreeSha: string }> {
    const root = await mkdtemp(join(tmpdir(), 'manta-skill-outcome-'))
    temporaryDirectories.push(root)
    const homeDir = join(root, 'home')
    const skillDir = join(homeDir, '.agents', 'skills', 'manta-cli')
    await mkdir(skillDir, { recursive: true })
    // Current bytes plus one upstream edit: content no snapshot in this build's
    // registry has ever seen, exactly what `skills update` installs after the
    // source repo moves past the release cut.
    const current = await readFile(join(repoRoot, 'skills', 'manta-cli', 'SKILL.md'))
    await writeFile(
      join(skillDir, 'SKILL.md'),
      Buffer.concat([current, Buffer.from('\nUpstream edit published after this build.\n')])
    )
    return { homeDir, installedTreeSha: (await observeSkillPackage(skillDir)).observedGitTreeSha }
  }

  async function writeLock(homeDir: string, skillFolderHash: string): Promise<void> {
    await writeFile(
      join(homeDir, '.agents', '.skill-lock.json'),
      JSON.stringify({
        version: 3,
        skills: {
          'manta-cli': {
            skillFolderHash,
            skillPath: 'skills/manta-cli',
            source: 'github.com/stablyai/manta'
          }
        }
      })
    )
  }

  it('accepts post-cut source content when the lock records exactly those bytes', async () => {
    const { homeDir, installedTreeSha } = await postCutFixture()
    await writeLock(homeDir, installedTreeSha)

    const inventory = await inventorySkillFreshness({
      currentAppVersion: 'test',
      homeDir,
      resourceRoot: join(repoRoot, 'resources'),
      repos: []
    })
    const locks = await readGloballyUpdatableSkillLocks({ homeDir })

    // Guard the premise: no snapshot knows these bytes, so recognition can only
    // come from the lock — the scan now reclassifies that match to 'newer-known'
    // (the #11220 scan half), and the verdict accepts it either way.
    const canonical = inventory.installations.filter(
      (entry) => entry.name === 'manta-cli' && entry.topology === 'canonical-copy'
    )
    expect(canonical).toHaveLength(1)
    expect(canonical[0].status).toBe('newer-known')
    expect(canonical[0].installedReleaseRevision).toBeNull()

    expect(skillUpdateFailedNames(['manta-cli'], inventory.installations, locks)).toEqual([])
  })

  it('keeps failing the same content when the lock names different bytes', async () => {
    const { homeDir } = await postCutFixture()
    await writeLock(homeDir, 'f'.repeat(40))

    const inventory = await inventorySkillFreshness({
      currentAppVersion: 'test',
      homeDir,
      resourceRoot: join(repoRoot, 'resources'),
      repos: []
    })
    const locks = await readGloballyUpdatableSkillLocks({ homeDir })

    expect(skillUpdateFailedNames(['manta-cli'], inventory.installations, locks)).toEqual([
      'manta-cli'
    ])
  })
})
