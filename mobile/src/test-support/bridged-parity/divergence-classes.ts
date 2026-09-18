/**
 * What a bridged-replay divergence is called, decided by a rule rather than by reading a message.
 *
 * Beside the recorder rather than inside it. Reading a failure cannot change what a recording
 * records, so `recorderSha256` must not cover this: a tightened rule would otherwise re-record 787
 * headers to say nothing. The recorder's own directory is digested whole, which is why this lives
 * one level up in `test-support`.
 */

/** Named once so the suite, its pin and the CI job cannot drift apart. */
export const BRIDGED_PARITY_FLAG = 'RPC_FOUNDATION_BRIDGE'

export type BridgedParityClass =
  | 'reply-meta-required'
  | 'result-absent-settlement'
  | 'result-absent-observation'
  | 'params-undefined'
  | 'write-ordinal'
  | 'unclassified'

export type BridgedParityEvidence = {
  /**
   * The same replay, with `_meta` supplied on every reply the shell posted, came out byte-identical
   * once that field is discounted. Measured rather than inferred: a golden can be refused a reply
   * for the missing field and still diverge for a second reason, and only the counterfactual run
   * separates the two.
   */
  fixedByReplyMeta: boolean
  /** The run threw before there was a recording to compare. */
  threwWhileRecording: boolean
  /**
   * Field paths that differ, in the order `compareGolden` walks them, or `checkpoints` when the
   * checkpoint lists themselves do. Only the first names the golden: it is the divergence that
   * takes the replay off course, and everything after it is a consequence of a run that is already
   * somewhere else. The rest is kept because a failure that has to be read wants all of it.
   */
  divergingFields: readonly string[]
  /** The scenario scripts a reply that is `ok` and carries no `result` key. */
  scriptsAbsentResultReply: boolean
  /** The scenario sends an own param key whose value is `undefined`. */
  sendsUndefinedValuedParam: boolean
}

function settlementField(path: string): boolean {
  return path.endsWith('.settlement') || path.includes('.settlement.')
}

function ordinalField(path: string): boolean {
  return path.endsWith('.ordinal')
}

/**
 * Exactly one name per diverging golden, in this order and no other.
 *
 * The first arm is the only one that needs a second run, and it has to come first because it is the
 * only one that is a cause rather than a symptom: nearly every golden here is refused some reply
 * for the missing field, and only the run that supplies it says which of them the field explains.
 * Everything below is a property of the scenario or of the fields that moved, never the text of an
 * error, so the counts move when the bridge does and not when a message is reworded.
 */
export function classifyBridgedParity(evidence: BridgedParityEvidence): BridgedParityClass {
  if (evidence.fixedByReplyMeta) {
    return 'reply-meta-required'
  }
  if (evidence.threwWhileRecording) {
    return evidence.sendsUndefinedValuedParam ? 'params-undefined' : 'unclassified'
  }
  const [first] = evidence.divergingFields
  if (first === undefined) {
    return 'unclassified'
  }
  // Before the partition below, not after: a reply shape the page drops cannot move a write
  // ordinal, so an ordinal that moved first is the bridge's hop and not the partition's doing. Most
  // of the matrix carries an absent-result reply somewhere, and testing that first would swallow
  // every ordinal finding in the corpus.
  if (ordinalField(first)) {
    return 'write-ordinal'
  }
  if (evidence.scriptsAbsentResultReply) {
    return settlementField(first) ? 'result-absent-settlement' : 'result-absent-observation'
  }
  return 'unclassified'
}

/**
 * What this tree measures, per class, over all 787 goldens.
 *
 * A ratchet, not a description: the flagged run fails when a class grows, when anything lands in
 * `unclassified`, or when fewer goldens replay byte-identically than this says. Since the total is
 * fixed at the size of the corpus, those three together pin every number here exactly.
 */
export const BRIDGED_PARITY_BASELINE: Readonly<Record<BridgedParityClass | 'identical', number>> = {
  identical: 24,
  'reply-meta-required': 372,
  'result-absent-settlement': 338,
  'result-absent-observation': 7,
  'params-undefined': 33,
  'write-ordinal': 13,
  unclassified: 0
}
