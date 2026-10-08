import { describe, expect, it } from 'vitest'
import { isUpstreamAuthored, isUpstreamFinding } from './react-doctor-upstream-line-attribution.mjs'

function upstreamOf(text) {
  // upstreamFileLines stores lines brand-normalized; mirror that here.
  const lines = text.split('\n').map((line) => line.split('Orca').join('Manta').trim())
  return { lines, set: new Set(lines) }
}

const UPSTREAM = upstreamOf(`function store() {
  return {
    settings: NATIVE_CHAT_SETTINGS,
    repos: []
  } as unknown as OrcaRouteStore
}`)

describe('isUpstreamAuthored', () => {
  it('matches an identifying line through the brand rename', () => {
    const source = ['  } as unknown as MantaRouteStore']
    expect(isUpstreamAuthored(source, 0, UPSTREAM)).toBe(true)
  })

  it('attributes a generic opening line by the block through the next identifying line', () => {
    const source = ['  return {', '    settings: NATIVE_CHAT_SETTINGS,']
    expect(isUpstreamAuthored(source, 0, UPSTREAM)).toBe(true)
  })

  it('keeps a generic opening line when the block after it is not upstream', () => {
    const source = ['  return {', '    settings: FORK_ONLY_SETTINGS,']
    expect(isUpstreamAuthored(source, 0, UPSTREAM)).toBe(false)
  })

  it('keeps a generic line with nothing identifying after it', () => {
    expect(isUpstreamAuthored(['  return {', '  }'], 0, UPSTREAM)).toBe(false)
  })
})

describe('isUpstreamFinding', () => {
  const maxLines = { rule: 'max-lines', line: 6 }

  it('attributes max-lines to upstream when its copy is at least as long', () => {
    const source = UPSTREAM.lines.map((line) => line.split('Orca').join('Manta'))
    expect(isUpstreamFinding(maxLines, source, UPSTREAM)).toBe(true)
  })

  it('keeps max-lines when this fork made the file longer', () => {
    const source = [...UPSTREAM.lines, '  forkOnly()']
    expect(isUpstreamFinding({ ...maxLines, line: 7 }, source, UPSTREAM)).toBe(false)
  })
})
