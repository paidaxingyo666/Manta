import { beforeEach, describe, expect, it, vi } from 'vitest'

const parseDocumentMock = vi.hoisted(() => vi.fn())

vi.mock('yaml', () => ({
  parseDocument: parseDocumentMock
}))

import {
  MAX_MANTA_YAML_ALIAS_COUNT,
  MAX_MANTA_YAML_BYTES,
  MAX_MANTA_YAML_COLLECTION_ENTRIES,
  MAX_MANTA_YAML_FIELD_BYTES,
  MAX_MANTA_YAML_FIELD_CODE_UNITS
} from './manta-yaml-file-limit'
import { parseMantaYaml } from './manta-yaml'

function returnYamlRoot(root: unknown): void {
  parseDocumentMock.mockReturnValue({
    errors: [],
    toJS: vi.fn(() => root)
  })
}

describe('manta.yaml parse bounds', () => {
  beforeEach(() => {
    parseDocumentMock.mockReset()
    returnYamlRoot({ scripts: { setup: 'pnpm install' } })
  })

  it('admits the exact UTF-8 input boundary and rejects +1 before YAML parsing', () => {
    expect(parseMantaYaml(' '.repeat(MAX_MANTA_YAML_BYTES))).toMatchObject({
      scripts: { setup: 'pnpm install' }
    })
    expect(parseDocumentMock).toHaveBeenCalledOnce()

    parseDocumentMock.mockClear()
    expect(parseMantaYaml(' '.repeat(MAX_MANTA_YAML_BYTES + 1))).toBeNull()
    expect(parseDocumentMock).not.toHaveBeenCalled()
  })

  it('rejects a multibyte input over the byte cap before YAML parsing', () => {
    const content = 'é'.repeat(MAX_MANTA_YAML_BYTES / 2 + 1)

    expect(parseMantaYaml(content)).toBeNull()
    expect(parseDocumentMock).not.toHaveBeenCalled()
  })

  it('passes an explicit alias expansion cap to YAML conversion', () => {
    const toJS = vi.fn(() => ({ scripts: { setup: 'pnpm install' } }))
    parseDocumentMock.mockReturnValue({ errors: [], toJS })

    expect(parseMantaYaml('scripts: {}')).not.toBeNull()
    expect(toJS).toHaveBeenCalledWith({ maxAliasCount: MAX_MANTA_YAML_ALIAS_COUNT })
  })

  it('preserves exact-size fields and drops a field at +1 code unit', () => {
    const exact = 'x'.repeat(MAX_MANTA_YAML_FIELD_CODE_UNITS)
    returnYamlRoot({ scripts: { setup: exact } })
    expect(parseMantaYaml('exact')).toMatchObject({ scripts: { setup: exact } })

    returnYamlRoot({ scripts: { setup: `${exact}x` } })
    expect(parseMantaYaml('overflow')).toBeNull()

    const exactUtf8 = 'é'.repeat(MAX_MANTA_YAML_FIELD_BYTES / 2)
    returnYamlRoot({ scripts: { setup: exactUtf8 } })
    expect(parseMantaYaml('exact-utf8')).toMatchObject({ scripts: { setup: exactUtf8 } })

    returnYamlRoot({ scripts: { setup: `${exactUtf8}é` } })
    expect(parseMantaYaml('overflow-utf8')).toBeNull()
  })

  it('admits the exact collection boundary and rejects +1 entries', () => {
    const tabs = Array.from({ length: MAX_MANTA_YAML_COLLECTION_ENTRIES }, (_, index) => ({
      title: `tab-${index}`
    }))
    returnYamlRoot({ defaultTabs: tabs })
    expect(parseMantaYaml('exact')?.defaultTabs).toHaveLength(MAX_MANTA_YAML_COLLECTION_ENTRIES)

    returnYamlRoot({ defaultTabs: [...tabs, { title: 'overflow' }] })
    expect(parseMantaYaml('overflow')).toBeNull()
  })
})
