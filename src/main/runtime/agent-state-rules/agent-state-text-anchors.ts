import type { RuntimeTerminalWaitBlockedReason } from '../../../shared/runtime-types'
import { startOfLastLines } from '../terminal-wait-tail-window'
import { compileTextTest, type TextMatcher } from './agent-state-rule-matchers'
import { BUNDLED_AGENT_STATE_RULE_FILES } from './agent-state-rules-catalog'
import type { AgentStateRulesFile, NamedTextAnchor, TextAnchor } from './agent-state-rules-schema'
import { findAntigravityComposerIndex } from './antigravity-text-composer'

export type BlockedTextSignal = { reason: RuntimeTerminalWaitBlockedReason; index: number }

type TextAnchorHit = { answer: TextAnchor['answer']; index: number }

const NAMED_TEXT_ANCHOR_FINDERS: Record<NamedTextAnchor, (normalized: string) => number | null> = {
  'antigravity-text-composer': findAntigravityComposerIndex
}

function compileFind(find: TextAnchor['when']['find']): (text: string) => number | null {
  if ('predicate' in find) {
    return NAMED_TEXT_ANCHOR_FINDERS[find.predicate]
  }
  return (text) => {
    const index = text.lastIndexOf(find.lastOf)
    return index === -1 ? null : index
  }
}

function compileLineCount(lines: NonNullable<TextAnchor['when']['lines']>): TextMatcher {
  const test = compileTextTest(lines.test)
  return (text) => {
    const rows = text.split('\n')
    while (rows.length > 0 && rows.at(-1)?.trim() === '') {
      rows.pop()
    }
    return (
      rows.filter(test).length >= lines.atLeast && (!lines.includingLast || test(rows.at(-1) ?? ''))
    )
  }
}

function compileTextAnchor(anchor: TextAnchor): (text: string) => TextAnchorHit | null {
  const { withinLastLines } = anchor.when
  const find = compileFind(anchor.when.find)
  const after = anchor.when.after ? compileTextTest(anchor.when.after) : null
  const lines = anchor.when.lines ? compileLineCount(anchor.when.lines) : null
  return (text) => {
    const start = withinLastLines ? startOfLastLines(text, withinLastLines) : 0
    const region = text.slice(start)
    const index = find(region)
    if (index === null || (after && !after(region.slice(index))) || (lines && !lines(region))) {
      return null
    }
    return { answer: anchor.answer, index: start + index }
  }
}

export function compileTextAnchors(files: readonly AgentStateRulesFile[]): {
  blocked: ((window: string) => TextAnchorHit | null)[]
  prompts: ((normalized: string) => TextAnchorHit | null)[]
  blockedLiterals: string[]
  screenProbeBanners: string[]
} {
  const anchors = files.flatMap((file) => file.textAnchors)
  const blocked = anchors.filter((anchor) => anchor.answer.state === 'blocked')
  return {
    blocked: blocked.map(compileTextAnchor),
    prompts: anchors.filter((anchor) => anchor.answer.state !== 'blocked').map(compileTextAnchor),
    blockedLiterals: blocked.flatMap((anchor) =>
      'lastOf' in anchor.when.find ? [anchor.when.find.lastOf] : []
    ),
    screenProbeBanners: files.flatMap((file) => file.profile?.screenProbeBanner ?? [])
  }
}

const TEXT_ANCHORS = compileTextAnchors(BUNDLED_AGENT_STATE_RULE_FILES)

/** The literal every blocked anchor needs, for the blocked layer's one-pass prefilter. */
export const BLOCKED_ANCHOR_LITERALS: readonly string[] = TEXT_ANCHORS.blockedLiterals

/** Every rule file's blocked anchor found in the blocked layer's live window. */
export function findBlockedAnchorSignals(window: string): BlockedTextSignal[] {
  return TEXT_ANCHORS.blocked.flatMap((find) => {
    const hit = find(window)
    return hit?.answer.state === 'blocked' ? [{ reason: hit.answer.reason, index: hit.index }] : []
  })
}

/**
 * The latest live prompt (`live`, idle or working: it proves an earlier startup dialog was
 * answered) and the latest idle one (`ready`) that any rule file's anchors find in the text tail.
 */
export function findPromptAnchorIndexes(normalized: string): {
  live: number | null
  ready: number | null
} {
  let live: number | null = null
  let ready: number | null = null
  for (const find of TEXT_ANCHORS.prompts) {
    const hit = find(normalized)
    if (hit === null) {
      continue
    }
    live = Math.max(live ?? -1, hit.index)
    if (hit.answer.state === 'idle') {
      ready = Math.max(ready ?? -1, hit.index)
    }
  }
  return { live, ready }
}

export function showsScreenProbeBanner(text: string): boolean {
  const normalized = text.toLowerCase()
  return TEXT_ANCHORS.screenProbeBanners.some((banner) => normalized.includes(banner))
}
