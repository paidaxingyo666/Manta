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
const EXPECTED_SHA256 = 'c79a04aa3605c30af226b7c3073e9ca295150e4fdc6d61afdf22860ff8fefb7b'
const EXPECTED_LENGTH = 729778

describe('terminal WebView payload', () => {
  it('composes the expected document', () => {
    expect(XTERM_HTML.length).toBe(EXPECTED_LENGTH)
    expect(createHash('sha256').update(XTERM_HTML, 'utf8').digest('hex')).toBe(EXPECTED_SHA256)
  })
})
