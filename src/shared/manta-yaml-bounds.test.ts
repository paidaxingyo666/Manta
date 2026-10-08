import { afterEach, describe, expect, it, vi } from 'vitest'
import { Document, stringify } from 'yaml'
import {
  MAX_MANTA_YAML_ALIAS_COUNT,
  MAX_MANTA_YAML_BYTES,
  MAX_MANTA_YAML_COLLECTION_ENTRIES,
  MAX_MANTA_YAML_FIELD_BYTES,
  MAX_MANTA_YAML_FIELD_CODE_UNITS
} from './manta-yaml-file-limit'
import { parseMantaYaml } from './manta-yaml'

afterEach(() => vi.restoreAllMocks())

describe('manta.yaml parse bounds', () => {
  it('admits the exact UTF-8 input boundary and rejects +1 before conversion', () => {
    const toJS = vi.spyOn(Document.prototype, 'toJS')
    const prefix = 'scripts:\n  setup: pnpm install\n#'
    const exact = prefix + ' '.repeat(MAX_MANTA_YAML_BYTES - prefix.length)
    expect(parseMantaYaml(exact)).toMatchObject({ scripts: { setup: 'pnpm install' } })
    expect(toJS).toHaveBeenCalledOnce()
    toJS.mockClear()
    expect(parseMantaYaml(`${exact} `)).toBeNull()
    expect(toJS).not.toHaveBeenCalled()
  })

  it('rejects a multibyte input over the byte cap before conversion', () => {
    const toJS = vi.spyOn(Document.prototype, 'toJS')
    expect(parseMantaYaml('é'.repeat(MAX_MANTA_YAML_BYTES / 2 + 1))).toBeNull()
    expect(toJS).not.toHaveBeenCalled()
  })

  it('passes an explicit alias expansion cap to YAML conversion', () => {
    const toJS = vi.spyOn(Document.prototype, 'toJS')
    expect(parseMantaYaml('scripts:\n  setup: pnpm install')).not.toBeNull()
    expect(toJS).toHaveBeenCalledWith({ maxAliasCount: MAX_MANTA_YAML_ALIAS_COUNT })
  })

  it('preserves exact-size fields and drops a field at +1 code unit', () => {
    const exact = 'x'.repeat(MAX_MANTA_YAML_FIELD_CODE_UNITS)
    expect(parseMantaYaml(stringify({ scripts: { setup: exact } }))).toMatchObject({
      scripts: { setup: exact }
    })
    expect(parseMantaYaml(stringify({ scripts: { setup: `${exact}x` } }))).toBeNull()
    const exactUtf8 = 'é'.repeat(MAX_MANTA_YAML_FIELD_BYTES / 2)
    expect(parseMantaYaml(stringify({ scripts: { setup: exactUtf8 } }))).toMatchObject({
      scripts: { setup: exactUtf8 }
    })
    expect(parseMantaYaml(stringify({ scripts: { setup: `${exactUtf8}é` } }))).toBeNull()
  })

  it('admits the exact collection boundary and rejects +1 entries', () => {
    const tabs = Array.from({ length: MAX_MANTA_YAML_COLLECTION_ENTRIES }, (_, index) => ({
      title: `tab-${index}`
    }))
    expect(parseMantaYaml(stringify({ defaultTabs: tabs }))?.defaultTabs).toHaveLength(
      MAX_MANTA_YAML_COLLECTION_ENTRIES
    )
    expect(parseMantaYaml(stringify({ defaultTabs: [...tabs, { title: 'overflow' }] }))).toBeNull()
  })
})
