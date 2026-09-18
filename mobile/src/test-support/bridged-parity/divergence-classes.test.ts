import { describe, expect, it } from 'vitest'
import {
  classifyBridgedParity,
  BRIDGED_PARITY_FLAG,
  type BridgedParityEvidence
} from './divergence-classes'

const base: BridgedParityEvidence = {
  fixedByReplyMeta: false,
  threwWhileRecording: false,
  divergingFields: [],
  scriptsAbsentResultReply: false,
  sendsUndefinedValuedParam: false
}

describe('the bridged-parity flag', () => {
  it('is the name the suite, the pin and the CI job all spell', () => {
    expect(BRIDGED_PARITY_FLAG).toBe('RPC_FOUNDATION_BRIDGE')
  })
})

describe('classifying one diverging golden', () => {
  it('names the missing field first, but only where supplying it was enough', () => {
    const absent = {
      ...base,
      scriptsAbsentResultReply: true,
      divergingFields: ['sender[0].settlement']
    }
    expect(classifyBridgedParity({ ...absent, fixedByReplyMeta: true })).toBe('reply-meta-required')
    expect(classifyBridgedParity(absent)).toBe('result-absent-settlement')
  })

  it('splits the absent-result partition by what moved first', () => {
    const absent = { ...base, scriptsAbsentResultReply: true }
    expect(
      classifyBridgedParity({ ...absent, divergingFields: ['sender[0].settlement', 'effects'] })
    ).toBe('result-absent-settlement')
    expect(classifyBridgedParity({ ...absent, divergingFields: ['effects'] })).toBe(
      'result-absent-observation'
    )
    expect(classifyBridgedParity({ ...absent, divergingFields: ['checkpoints'] })).toBe(
      'result-absent-observation'
    )
  })

  it('names a throw only when the scenario sends a key valued `undefined`', () => {
    expect(
      classifyBridgedParity({ ...base, threwWhileRecording: true, sendsUndefinedValuedParam: true })
    ).toBe('params-undefined')
    expect(classifyBridgedParity({ ...base, threwWhileRecording: true })).toBe('unclassified')
  })

  it('names the ordinal class ahead of the partition a matrix golden also carries', () => {
    expect(classifyBridgedParity({ ...base, divergingFields: ['sender[0].ordinal'] })).toBe(
      'write-ordinal'
    )
    expect(
      classifyBridgedParity({
        ...base,
        scriptsAbsentResultReply: true,
        divergingFields: ['payloads[0].ordinal', 'effects']
      })
    ).toBe('write-ordinal')
  })

  it('refuses to name a golden that diverged in no field at all', () => {
    expect(classifyBridgedParity(base)).toBe('unclassified')
  })
})
