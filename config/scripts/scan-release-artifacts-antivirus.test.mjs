import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatArtifactReport,
  hasAnyDetection,
  hashFile,
  summarizeEngineVerdicts
} from './scan-release-artifacts-antivirus.mjs'

describe('antivirus detection report', () => {
  it('hashes an artifact with the same digest the issue reports quote', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orca-av-scan-'))
    try {
      const artifact = join(directory, 'manta-windows-setup.exe')
      await writeFile(artifact, 'manta', 'utf8')
      // Lowercase hex sha256, so a reporter's `shasum -a 256` output and ours
      // compare directly — that comparison is what makes a submission credible.
      expect(await hashFile(artifact)).toBe(
        '54141373db1eee06498327304ecf6eaa85a0a06f0b0f36990a4e1427fa833247'
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('counts only malicious and suspicious categories as verdicts', () => {
    const { scanned, flagged } = summarizeEngineVerdicts({
      Microsoft: { category: 'malicious', result: 'Trojan:Win32/Wacatac.B!ml' },
      Bitdefender: { category: 'suspicious', result: 'Gen:Variant.MSILHeracles' },
      Kaspersky: { category: 'undetected', result: null },
      ESET: { category: 'type-unsupported', result: null },
      Avast: { category: 'timeout', result: null }
    })

    expect(scanned).toBe(5)
    expect(flagged).toEqual([
      { engine: 'Bitdefender', category: 'suspicious', detection: 'Gen:Variant.MSILHeracles' },
      { engine: 'Microsoft', category: 'malicious', detection: 'Trojan:Win32/Wacatac.B!ml' }
    ])
  })

  it('treats a missing results payload as nothing scanned rather than clean', () => {
    expect(summarizeEngineVerdicts(undefined)).toEqual({ scanned: 0, flagged: [] })
    expect(summarizeEngineVerdicts(null)).toEqual({ scanned: 0, flagged: [] })
  })

  it('names an unnamed detection instead of printing undefined', () => {
    const { flagged } = summarizeEngineVerdicts({ Sophos: { category: 'malicious' } })
    expect(flagged[0].detection).toBe('<unnamed>')
  })

  it('distinguishes an unscanned build from a clean one', () => {
    const unscanned = formatArtifactReport({
      name: 'manta-windows-setup.exe',
      sha256: 'a'.repeat(64),
      known: false,
      scanned: 0,
      flagged: []
    })
    expect(unscanned).toContain('never been scanned')

    const clean = formatArtifactReport({
      name: 'manta-windows-setup.exe',
      sha256: 'a'.repeat(64),
      known: true,
      scanned: 70,
      flagged: []
    })
    expect(clean).toContain('clean across 70 engines')
  })

  it('reports every flagging engine and its detection name', () => {
    const report = formatArtifactReport({
      name: 'manta.exe',
      sha256: 'b'.repeat(64),
      known: true,
      scanned: 70,
      flagged: [
        { engine: 'TrendMicro', category: 'malicious', detection: 'Trojan.MSIL.MSILHERACLES' }
      ]
    })

    expect(report).toContain('1 of 70 engines flag this build')
    expect(report).toContain('TrendMicro: Trojan.MSIL.MSILHERACLES')
  })

  it('flags the release when any single artifact carries a verdict', () => {
    const clean = { flagged: [] }
    const flagged = { flagged: [{ engine: 'Microsoft' }] }

    expect(hasAnyDetection([clean, clean])).toBe(false)
    expect(hasAnyDetection([clean, flagged])).toBe(true)
  })
})
