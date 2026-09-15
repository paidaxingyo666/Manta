import type { AgentStatus } from './agent-title-core'

/**
 * Pi/OMP title-state markers. OMP 17.2.12 replaced animated WSL/ConPTY frames;
 * every consumer uses this table so protocol updates stay atomic (#13890, #8014).
 */
const PI_STATE_MARKER_STATUS = {
  ':': 'working',
  '!': 'permission',
  '>': 'idle'
} as const satisfies Record<string, AgentStatus>

export type PiStateMarker = keyof typeof PI_STATE_MARKER_STATUS

export const PI_STATE_MARKERS = Object.keys(PI_STATE_MARKER_STATUS) as PiStateMarker[]

/** Marker a stale working title is rewritten to; see {@link clearPiStateWorkingMarker}. */
const PI_IDLE_MARKER = '>' satisfies PiStateMarker

function escapeForCharacterClass(marker: string): string {
  return marker.replace(/[\\\]^-]/g, '\\$&')
}

// Brand at a token boundary plus whitespace: wrappers (`zsh | OMP : cwd`) work, legacy `π: cwd` stays idle.
const PI_STATE_TITLE_RE = new RegExp(
  `(?:^|[\\s|])(π|Pi|OMP)[ \\t]+([${PI_STATE_MARKERS.map(escapeForCharacterClass).join('')}])(?=\\s|$)`,
  'u'
)

type PiStateTitleMatch = {
  brand: string
  brandIndex: number
  marker: PiStateMarker
  markerIndex: number
}

/** The leftmost marker wins because the remaining label may contain marker-like text. */
function matchPiStateTitle(title: string): PiStateTitleMatch | null {
  const match = PI_STATE_TITLE_RE.exec(title)
  if (!match) {
    return null
  }
  const marker = match[2]
  if (marker !== ':' && marker !== '!' && marker !== '>') {
    return null
  }
  return {
    brand: match[1],
    brandIndex: match.index + match[0].indexOf(match[1]),
    marker,
    markerIndex: match.index + match[0].length - 1
  }
}

/** Status a Pi/OMP native state title asserts, or null when the title carries no marker. */
export function getPiStateTitleStatus(title: string): AgentStatus | null {
  const match = matchPiStateTitle(title)
  return match ? PI_STATE_MARKER_STATUS[match.marker] : null
}

/** Rewrites working to idle; null lets callers apply their remaining strip passes. */
export function clearPiStateWorkingMarker(title: string): string | null {
  const match = matchPiStateTitle(title)
  if (!match || PI_STATE_MARKER_STATUS[match.marker] !== 'working') {
    return null
  }
  return `${title.slice(0, match.markerIndex)}${PI_IDLE_MARKER}${title.slice(match.markerIndex + 1)}`
}

/** The state marker owns identity too; its label may mention another agent. */
export function getPiStateTitleBrand(title: string): 'Pi' | 'OMP' | null {
  const match = matchPiStateTitle(title)
  return match ? (match.brand === 'OMP' ? 'OMP' : 'Pi') : null
}

/** Rebrand only the protocol prefix, preserving wrappers and the opaque session label. */
export function rebrandPiStateTitle(title: string, brand: string): string | null {
  const match = matchPiStateTitle(title)
  if (!match) {
    return null
  }
  return (
    title.slice(0, match.brandIndex) + brand + title.slice(match.brandIndex + match.brand.length)
  )
}
