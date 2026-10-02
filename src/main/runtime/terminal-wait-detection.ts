import { isQoderComposerReady } from './qoder-terminal-readiness'
import { memoizeTitleClassification } from '../../shared/terminal-title-classification-memo'
import {
  detectAgentStatusFromTitle,
  isOpenCodeNativeTitle,
  type AgentStatus
} from '../../shared/agent-detection'
import type { RuntimeTerminalWaitBlockedReason } from '../../shared/runtime-types'
import type { TuiAgent } from '../../shared/tui-agent'
import {
  evaluateAgentStateRules,
  type AgentStateVerdict
} from './agent-state-rules/agent-state-rules-engine'
import { findPromptAnchorIndexes } from './agent-state-rules/agent-state-text-anchors'
import { findTerminalWaitBlockedSignal } from './agent-state-rules/blocked-text-layer'
import {
  findCodexHeaderIndex,
  findCodexScreenReadyPromptIndex,
  isCodexComposerReadyScreen,
  isCodexProvisionalStartupText
} from './codex-terminal-readiness'

const EXPLICIT_IDLE_TITLE_RE = /(^|\s)(ready|idle|done)(\s|$|[.!?])/i
const CLAUDE_IDLE_PREFIX = '\u2733'
const GEMINI_IDLE_PREFIX = '\u25c7'
const PI_IDLE_PREFIX = '\u03c0 - '

function computeExplicitIdleStatusFromTitle(title: string): AgentStatus | null {
  const status = detectAgentStatusFromTitle(title)
  if (status !== 'idle') {
    return null
  }
  // Why: launch titles like "Codex YOLO" contain an agent name but aren't readiness signals; terminal.wait needs explicit idle evidence.
  if (
    EXPLICIT_IDLE_TITLE_RE.test(title) ||
    // Why: unblock hookless remote waits; guarded writes corroborate this marker.
    isOpenCodeNativeTitle(title) ||
    title.startsWith(CLAUDE_IDLE_PREFIX) ||
    title.startsWith('* ') ||
    title.includes(GEMINI_IDLE_PREFIX) ||
    title.startsWith(PI_IDLE_PREFIX)
  ) {
    return 'idle'
  }
  return null
}

/**
 * Pure in `title`, so it is memoized on the title string like the status classifier it
 * wraps: the wait path re-asks for the same unchanged title on every poll tick and every
 * repaint frame, and the marker scan below is a regex sweep each time (~72ns vs ~7ns).
 */
export const detectExplicitIdleStatusFromTitle: (title: string) => AgentStatus | null =
  memoizeTitleClassification(computeExplicitIdleStatusFromTitle)

export function isKnownReadyPromptPreview(preview: string): boolean {
  const normalized = preview.toLowerCase()
  return isReadyPromptUnblocked(normalized, findKnownReadyPromptIndex(normalized))
}

/**
 * The ready-prompt text rules for a pane about to take input. Unlike isKnownReadyPromptPreview
 * (agent presence), Codex's provisional startup header does not count: 0.157 discards input typed
 * behind it while its daemon starts.
 */
export function isKnownReadyPromptSettled(preview: string): boolean {
  const normalized = preview.toLowerCase()
  return isReadyPromptSettled(normalized, findKnownReadyPromptIndex(normalized))
}

function isReadyPromptSettled(normalized: string, readyIndex: number | null): boolean {
  return (
    isReadyPromptUnblocked(normalized, readyIndex) && !isCodexProvisionalStartupText(normalized)
  )
}

/**
 * Tier 1 body evidence for every tui-idle site. `readScreenLines` yields the live emulator's
 * visible grid, or null when the runtime has no trustworthy one.
 *
 * Why not for a clocked Codex or screen-ruled pane: its header or composer is also painted
 * mid-turn, so isQuietReadyScreenBody holds it to quiescence instead.
 * Why a clockless pane keeps it: quiescence needs an output clock, which a restored pane lacks.
 */
export function isKnownReadyPromptBody(
  waitText: string,
  agent: TuiAgent | null,
  readScreenLines: () => readonly string[] | null,
  hasOutputClock: boolean
): boolean {
  if (agent === 'qoder') {
    return isQoderComposerReady(readScreenLines())
  }
  const ruled = evaluateAgentStateRules(agent, { readScreenLines })
  if (ruled !== null) {
    return isStrongIdle(ruled) && (!ruled.requiresQuiet || !hasOutputClock)
  }
  if (agent === 'codex' && hasOutputClock) {
    return false
  }
  if (isKnownReadyPromptSettled(waitText)) {
    return true
  }
  // Why the agent gate: another agent's screen can merely mention "OpenAI Codex".
  if (agent !== null && agent !== 'codex') {
    return false
  }
  const screen = readScreen(readScreenLines)
  return screen !== null && isCodexScreenHeaderReady(screen)
}

/**
 * Tier 1b body evidence: a ready screen from an agent with no title rest signal. Unlike tier 1
 * it only proves the TUI is up, so the ranking holds it to quiescence.
 * Why identified panes only: a `cat`ed transcript or pager in an unknown pane can show the composer.
 */
export function isQuietReadyScreenBody(
  waitText: string,
  agent: TuiAgent | null,
  readScreenLines: () => readonly string[] | null
): boolean {
  if (agent === 'codex') {
    const screen = readScreen(readScreenLines)
    if (
      screen !== null &&
      (isCodexComposerReadyScreen(screen) || isCodexScreenHeaderReady(screen))
    ) {
      return true
    }
    // Why the provisional veto here too: a daemon start can stay quiet past the quiescence window.
    const normalized = waitText.toLowerCase()
    return isReadyPromptSettled(normalized, findCodexReadyPromptIndex(normalized))
  }
  const ruled = evaluateAgentStateRules(agent, { readScreenLines })
  if (ruled !== null && isStrongIdle(ruled) && ruled.requiresQuiet) {
    return true
  }
  return (agent === null || agent === 'muse') && isMuseReadyPromptPreview(waitText)
}

function isStrongIdle(
  verdict: AgentStateVerdict
): verdict is Extract<AgentStateVerdict, { state: 'idle' }> {
  return verdict.state === 'idle' && verdict.strength === 'strong'
}

/**
 * Why the screen: Codex repaints its 0.150-0.157 header by cell diff (`ESC[5;3Hdir
 * ESC[5;7Hctory:`), which only a grid reassembles — the line-folded wait text reads `dirctory:`.
 * Why it can only add readiness: a grid out of step with the PTY (size mismatch, resize
 * mid-paint) garbles the header, so the text rule keeps every verdict it gives on its own.
 */
function isCodexScreenHeaderReady(screen: string): boolean {
  return isReadyPromptUnblocked(screen, findCodexScreenReadyPromptIndex(screen))
}

function readScreen(readScreenLines: () => readonly string[] | null): string | null {
  return readScreenLines()?.join('\n').toLowerCase() ?? null
}

function isReadyPromptUnblocked(normalized: string, readyIndex: number | null): boolean {
  if (readyIndex === null) {
    return false
  }
  const blockedSignal = findTerminalWaitBlockedSignal(normalized)
  return blockedSignal === null || blockedSignal.index <= readyIndex
}

export function isMuseReadyPromptPreview(preview: string): boolean {
  const normalized = preview.toLowerCase()
  return isReadyPromptUnblocked(normalized, findMuseReadyPromptIndex(normalized))
}

export function detectTerminalWaitBlockedReason(
  preview: string
): RuntimeTerminalWaitBlockedReason | null {
  const normalized = preview.toLowerCase()
  return findActionableTerminalWaitBlockedSignal(normalized)?.reason ?? null
}

export function findActionableTerminalWaitBlockedSignal(
  normalized: string
): { reason: RuntimeTerminalWaitBlockedReason; index: number } | null {
  const blockedSignal = findTerminalWaitBlockedSignal(normalized)
  if (blockedSignal === null) {
    return null
  }
  const dismissedModalIndex = findDismissedStartupModalIndex(normalized)
  // Why: a live prompt after the modal means it was dismissed → signal no longer actionable, even mid-run (Cursor never reports idle via OSC title).
  return dismissedModalIndex !== null && dismissedModalIndex > blockedSignal.index
    ? null
    : blockedSignal
}

// Why: a live prompt (idle OR busy) proves the startup modal was dismissed, so a mid-run Cursor lane stops reporting stale trust hits.
// Why rule-file anchors beside Codex and Muse: those two have not moved to agent-state-rules/ yet.
function findDismissedStartupModalIndex(normalized: string): number | null {
  return latestIndex([
    findCodexReadyPromptIndex(normalized),
    findCodexHeaderIndex(normalized),
    findPromptAnchorIndexes(normalized).live,
    findMuseReadyPromptIndex(normalized)
  ])
}

function findKnownReadyPromptIndex(normalized: string): number | null {
  return latestIndex([
    findCodexReadyPromptIndex(normalized),
    findPromptAnchorIndexes(normalized).ready
  ])
}

function latestIndex(indexes: readonly (number | null)[]): number | null {
  const found = indexes.filter((index): index is number => index !== null)
  return found.length > 0 ? Math.max(...found) : null
}

// Why: Muse titles its OSC with the bare cwd and never updates it, so only the body can
// prove the TUI is up. The voice-input composer is present even without loaded skills.
function findMuseReadyPromptIndex(normalized: string): number | null {
  const headerIndex = normalized.lastIndexOf('muse code')
  if (headerIndex === -1) {
    return null
  }
  const segment = normalized.slice(headerIndex)
  return segment.includes('voice') && segment.includes('input') && segment.includes('❯')
    ? headerIndex
    : null
}

function findCodexReadyPromptIndex(normalized: string): number | null {
  const headerIndex = normalized.lastIndexOf('openai codex')
  if (headerIndex === -1) {
    return null
  }
  const readySegment = normalized.slice(headerIndex)
  // Why: Codex prints permissions only in YOLO mode; the stable ready header is OpenAI Codex + model + directory.
  return readySegment.includes('model:') && readySegment.includes('directory:') ? headerIndex : null
}
