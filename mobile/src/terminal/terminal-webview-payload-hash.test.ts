import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { XTERM_HTML } from './terminal-webview-html'

// Why: every other WebView test exercises one slice of the document, so an edit to an
// uncovered region ships silently. A diff here means the emitted WebView source changed —
// update these values only when that change is deliberate, and only after checking the
// document still runs. Refactors that merely move slice boundaries must leave them alone.
// This fork's values, not upstream's: the document names the product twice, and
// "manta" is one byte longer than "orca". A sync that moves these by exactly
// the brand delta is the rename; anything else is a real change to the WebView.
const EXPECTED_SHA256 = 'e301ca0090cde377a7e64739d795cdb17b7fbec13b1f139a0a2b5d7af837dd8c'
const EXPECTED_LENGTH = 730_474

describe('terminal WebView payload', () => {
  it('composes the expected document', () => {
    expect(XTERM_HTML.length).toBe(EXPECTED_LENGTH)
    expect(createHash('sha256').update(XTERM_HTML, 'utf8').digest('hex')).toBe(EXPECTED_SHA256)
  })
})
