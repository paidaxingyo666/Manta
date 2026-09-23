// jcode paints `<emoji> jcode <session-name>[ · +N -M][ · work|last ~<dur>]` about
// once a second (crates/jcode-tui/src/tui/app/terminal_title.rs). Everything after
// the first ` · ` is live metrics, and the head is jcode's identity plus the
// codename it generates per session ("Puppy", "Tigress") — a label, never a
// conversation name. Captured titles are in docs/reference/jcode-hook-events.md.
const JCODE_TITLE_METRICS_RE = /\s+·\s+(?:\+\d+\s+-\d+|(?:work|last)\s+~\S+)(?=\s+·\s+|$)/gu
// jcode picks a per-session emoji (🐍 Snake, 🐕 Puppy) and swaps it for a status one
// mid-turn, so it identifies nothing stable. It is not in the shared decoration
// stripper because that list is a fixed set of agent status glyphs, not open-ended.
const JCODE_TITLE_LEADING_EMOJI_RE = /^(?:\p{Extended_Pictographic}|\uFE0F|\u200D)+\s*/u

/** The jcode title with its leading emoji and live diff/duration segments removed. */
export function stripJcodeTitleMetrics(title: string): string {
  return title.replace(JCODE_TITLE_LEADING_EMOJI_RE, '').replace(JCODE_TITLE_METRICS_RE, '').trim()
}

// `jcode` alone, `jcode Puppy`, and `jcode/creek Puppy` (the self-dev variant) are
// all identity; anything the user could recognise as their own work has more to it.
const JCODE_IDENTITY_TITLE_RE = /^jcode(?:\/[^\s·]+)?(?:\s+[^\s·]+)?$/iu

/** True when a jcode title says only which jcode session this is, not what it is doing. */
export function isJcodeIdentityTerminalTitle(title: string | null | undefined): boolean {
  if (!title) {
    return false
  }
  return JCODE_IDENTITY_TITLE_RE.test(stripJcodeTitleMetrics(title))
}
