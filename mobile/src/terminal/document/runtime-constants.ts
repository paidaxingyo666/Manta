import { scope } from './document-scope'

/**
 * The first declarations inside the document's IIFE.
 *
 * All eight are read by other parts of the script, so all eight are scope fields; the document
 * shell opens the function they live in and `document-close.ts` closes it.
 */
scope.surface = document.getElementById('terminal-surface')
scope.ESC = String.fromCharCode(27)
scope.C1_CSI = String.fromCharCode(155)
scope.CLAUDE_STATUS_DOT = String.fromCharCode(0x23fa)
scope.TEXT_PRESENTATION_SELECTOR = String.fromCharCode(0xfe0e)
scope.EMOJI_PRESENTATION_SELECTOR = String.fromCharCode(0xfe0f)
scope.CLAUDE_STATUS_DOT_PATTERN = new RegExp(
  scope.CLAUDE_STATUS_DOT +
    '[' +
    scope.TEXT_PRESENTATION_SELECTOR +
    scope.EMOJI_PRESENTATION_SELECTOR +
    ']*',
  'g'
)
scope.statusDotPendingSelector = false
