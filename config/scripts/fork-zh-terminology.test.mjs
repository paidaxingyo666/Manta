import { describe, expect, it } from 'vitest'

import { isAgentString } from './fork-zh-terminology.mjs'

/**
 * The rule exists because `.gitattributes` keeps the locale catalogs on the
 * keepupstream driver, so every sync reverts this fork's Chinese wording. What
 * it must never do is "fix" a string that was correct: 代理 is also proxy.
 */
describe('fork Chinese terminology', () => {
  it('rewrites a string the English calls an agent', () => {
    expect(isAgentString('No enabled AI agents were detected on this host.')).toBe(true)
    expect(isAgentString('Agent skills setup')).toBe(true)
  })

  it('leaves a proxy alone', () => {
    // 代理 is the right word here; upstream is not wrong, and rewriting it would
    // mistranslate a network setting as an AI agent.
    expect(isAgentString('App-level network routing for proxies and corporate environments.')).toBe(
      false
    )
    expect(
      isAgentString('Use it for corporate VPNs or proxies that reject HTTP/2 update downloads.')
    ).toBe(false)
  })

  it('leaves a string that mentions both alone', () => {
    // Ambiguous is not worth guessing at: a wrong rewrite is silent and shipped.
    expect(isAgentString('Route the agent through a proxy')).toBe(false)
  })

  it('says no when there is no English entry to read', () => {
    expect(isAgentString(undefined)).toBe(false)
    expect(isAgentString(null)).toBe(false)
  })
})
