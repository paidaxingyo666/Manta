import { readBridgeHostMessage } from '../../mobile-web-shell/bridge/bridge-envelope'
import { firstDifference } from '../rpc-recording/golden-recording'
import { canonicalJson, OBSERVATION_FIELDS } from '../rpc-recording/golden-value-pool'
import type { Observation, Recording, RecordingScenario } from '../rpc-recording/recording-scenario'
import type { RecordedValue } from '../rpc-recording/recording-values'

/**
 * The facts a divergence is named from, each read off the run rather than off its message.
 *
 * Outside the recorder's directory for the reason `divergence-classes.ts` gives: none of this can
 * change what a recording records, so none of it belongs in the digest that says what can.
 */

/** Frames the shell posted that the page's own reader drops. Read back through that same reader. */
export function refusedFrames(posted: readonly string[]): string[] {
  return posted.filter((json) => !readBridgeHostMessage(json).ok)
}

/**
 * The same frame with a `_meta` on its reply payload, which is the one field the page's reader
 * demands and the wire the page stands in for does not. Anything that is not a reply comes back
 * untouched, so this can sit on a whole lane. The type is what decides that and not the presence of
 * a `payload`: an `event` carries one too, and the page reads it as `z.unknown()`, so stamping it
 * would put a key in a subscription's bytes that no reader asked for and none would refuse.
 */
export function withReplyMeta(json: string): string {
  const frame: unknown = JSON.parse(json)
  if (typeof frame !== 'object' || frame === null || !('payload' in frame)) {
    return json
  }
  if (!('type' in frame) || frame.type !== 'reply') {
    return json
  }
  const payload = frame.payload
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return json
  }
  return JSON.stringify({
    ...frame,
    payload: { ...payload, _meta: { runtimeId: 'counterfactual-runtime' } }
  })
}

/**
 * Every `_meta` the counterfactual added, gone again.
 *
 * A reply the page accepted resolves to the caller whole, `_meta` included, so a run that was given
 * the field records it where the faithful run records nothing. Removing it is what makes the two
 * runs comparable; it is a key the recorder never sees on this corpus, so nothing else is lost.
 */
export function withoutRpcMeta(value: RecordedValue): RecordedValue {
  if (Array.isArray(value)) {
    return value.map(withoutRpcMeta)
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '_meta')
      .map(([key, entry]) => [key, withoutRpcMeta(entry)])
  )
}

/** A recording with the counterfactual's fingerprints removed, ready to diff against a golden. */
export function recordingWithoutRpcMeta(recording: Recording): Recording {
  return {
    scenario: recording.scenario,
    checkpoints: recording.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: `withoutRpcMeta` preserves shape, so an observation maps to an observation.
      observation: withoutRpcMeta(checkpoint.observation) as Observation
    }))
  }
}

/**
 * Every field path that differs, in the vocabulary `compareGolden` prints, and `checkpoints` when
 * the two runs did not even reach the same checkpoints. All of them, not the first: a rule that
 * needs to know whether *every* field that moved is an ordinal cannot be given only one.
 */
export function divergingFields(expected: Recording, actual: Recording): string[] {
  const expectedIds = expected.checkpoints.map((checkpoint) => checkpoint.id)
  const actualIds = actual.checkpoints.map((checkpoint) => checkpoint.id)
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
    return ['checkpoints']
  }
  const fields: string[] = []
  for (const [index, checkpoint] of expected.checkpoints.entries()) {
    const found = actual.checkpoints[index]
    if (found === undefined) {
      return ['checkpoints']
    }
    for (const field of OBSERVATION_FIELDS) {
      const mine = checkpoint.observation[field]
      const theirs = found.observation[field]
      if (canonicalJson(mine) === canonicalJson(theirs)) {
        continue
      }
      fields.push(`${field}${firstDifference(mine, theirs).path}`)
    }
  }
  return fields
}

/** A reply shape the wire itself drops: `ok` with no `result` key at all. */
export function scriptsAbsentResultReply(scenario: RecordingScenario): boolean {
  return scenario.steps.some((step) => {
    if (!('reply' in step) || typeof step.reply !== 'object' || step.reply === null) {
      return false
    }
    return 'ok' in step.reply && step.reply.ok === true && !('result' in step.reply)
  })
}

function undefinedValuedKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(undefinedValuedKey)
  }
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return Object.values(value).some((entry) => entry === undefined || undefinedValuedKey(entry))
}

/** The key JSON drops on the way across, so the shell projects params that never had it. */
export function sendsUndefinedValuedParam(scenario: RecordingScenario): boolean {
  return scenario.steps.some((step) => 'params' in step && undefinedValuedKey(step.params))
}
