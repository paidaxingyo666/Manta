import { measureUtf8ByteLength } from './utf8-byte-limits'

export const MAX_MANTA_YAML_BYTES = 256 * 1024
export const MAX_MANTA_YAML_CODE_UNITS = 256 * 1024
export const MAX_MANTA_YAML_FIELD_BYTES = 64 * 1024
export const MAX_MANTA_YAML_FIELD_CODE_UNITS = 64 * 1024
export const MAX_MANTA_YAML_COLLECTION_ENTRIES = 256
// Keep ordinary anchor reuse; map merge conversion has a separate work budget.
export const MAX_MANTA_YAML_ALIAS_COUNT = 100

export function isMantaYamlTextWithinLimit(content: string): boolean {
  return (
    content.length <= MAX_MANTA_YAML_CODE_UNITS &&
    !measureUtf8ByteLength(content, { stopAfterBytes: MAX_MANTA_YAML_BYTES }).exceededLimit
  )
}

export function isMantaYamlFieldWithinLimit(value: string): boolean {
  return (
    value.length <= MAX_MANTA_YAML_FIELD_CODE_UNITS &&
    !measureUtf8ByteLength(value, { stopAfterBytes: MAX_MANTA_YAML_FIELD_BYTES }).exceededLimit
  )
}
