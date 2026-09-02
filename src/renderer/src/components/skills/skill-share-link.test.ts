import { describe, expect, it } from 'vitest'
import { parseSkillShareId } from './skill-share-link'

describe('parseSkillShareId', () => {
  it('accepts durable Manta links and bare identifiers', () => {
    expect(parseSkillShareId('share_123')).toBe('share_123')
    expect(parseSkillShareId('https://share.manta.sh.cn/skills/share/share_123/')).toBe('share_123')
    expect(parseSkillShareId('manta://skills/share/share_123')).toBe('share_123')
  })

  // The host used to have to be one of two hardcoded names, one of which this
  // fork does not even own. Only the id survives this function and the fetch
  // origin is pinned elsewhere, so the host was never provenance.
  it('accepts a link from a host the operator runs themselves', () => {
    expect(parseSkillShareId('https://skills.example.com/skills/share/share_123')).toBe('share_123')
  })

  it('rejects lookalike paths and non-https schemes', () => {
    expect(parseSkillShareId('https://skills.example.com/skills/share/share_123/more')).toBeNull()
    expect(parseSkillShareId('javascript:share_123')).toBeNull()
    expect(parseSkillShareId('file:///skills/share/share_123')).toBeNull()
    expect(parseSkillShareId('http://skills.example.com/skills/share/share_123')).toBeNull()
  })

  it('still allows loopback HTTP for local development', () => {
    expect(parseSkillShareId('http://127.0.0.1:5173/skills/share/share_123')).toBe('share_123')
    expect(parseSkillShareId('http://localhost:5173/skills/share/share_123')).toBe('share_123')
  })

  // `https://share.manta.sh.cn@attacker.test/...` reads as a Manta link to a
  // person and resolves to attacker.test. Nothing downstream is fooled, but the
  // link input echoes it back, so it should not parse.
  it('rejects a URL carrying credentials', () => {
    expect(
      parseSkillShareId('https://share.manta.sh.cn@attacker.test/skills/share/share_123')
    ).toBeNull()
  })
})
