import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readBridgeHostMessage } from '../../mobile-web-shell/bridge/bridge-envelope'
import {
  createBridgePortPair,
  type BridgePortPair
} from '../../mobile-web-shell/bridge/bridge-port-pair-test-harness'
import type { RpcClient } from '../../transport/rpc-client'
import {
  BRIDGED_PARITY_BASELINE,
  BRIDGED_PARITY_FLAG,
  classifyBridgedParity,
  type BridgedParityClass,
  type BridgedParityEvidence
} from '../bridged-parity/divergence-classes'
import {
  divergingFields,
  recordingWithoutRpcMeta,
  refusedFrames,
  scriptsAbsentResultReply,
  sendsUndefinedValuedParam,
  withReplyMeta
} from '../bridged-parity/divergence-evidence'
import { familyGoldens, pilotGoldens } from './derived-goldens'
import { compareGolden, readGolden } from './golden-recording'
import { pilotMountAdapters } from './pilot-mount-adapters'
import type { Recording, RecordingScenario } from './recording-scenario'
import { readScenarios } from './scenario-input'
import type { ScriptedClientWrapper } from './scripted-rpc-transport'
import { runRecording } from './run-recording'
import { vitestRecordingScheduler } from './vitest-recording-scheduler'

/**
 * Every golden, recorded again with the page bridge between the operation and the scripted
 * transport, and compared body for body against the committed file.
 *
 * The claim it is built to certify is the one C1 needs before a screen moves to the web: a screen
 * driven through `BridgeRpcClient` observes what it observes on the native client, down to the
 * byte. Headers are excluded because they are provenance of the committed recording, not of this
 * run. This suite writes nothing, and it is not in `RECORDING_DRIVERS`, so `recorderSha256` does
 * not pin it — a suite that cannot put an observation in a recorded file is not provenance for one.
 *
 * ## What it asserts today
 *
 * Byte-identical replay where it holds, and the named shape of every divergence where it does not.
 * A golden that matches is compared in full; one that does not is classified by
 * `classifyBridgedParity`, which reads the frames and the scenario rather than the failure's text,
 * and the run fails if any class grows past `BRIDGED_PARITY_BASELINE` or if a single golden lands
 * in `unclassified`. The corpus is a fixed size, so those two together pin every count exactly.
 *
 * Five classes over the 787, none of them a reason to re-record anything, and 24 goldens that
 * replay byte for byte: 372 / 338 / 7 / 33 / 13.
 *
 * 1. **reply-meta-required, 372.** `BridgeReplyPayloadSchema` requires `_meta` on both arms. The native
 *    client's own acceptance predicate for a reply off the wire, `transport/rpc-response-shape.ts`,
 *    requires none, and `src/shared/runtime-rpc-envelope.ts` — the envelope clients and runtimes
 *    share — makes `_meta` optional on a failure and its `runtimeId` nullable. The page's reader is
 *    strictly narrower than the transport it stands in for, so replies the phone accepts today are
 *    refused, dropped with a diagnostic, and settle nothing. This is the class the second replay
 *    names, the one `withReplyMeta` supplies the field on: a golden that comes out byte-identical
 *    once the page is given `_meta` had no other reason to diverge.
 * 2. **result-absent-settlement, 338** and **3. result-absent-observation, 7.** `{ ok: true }` with no
 *    `result` key is refused by the page's reader and by `isRpcResponse` alike, so this one is not
 *    a bridge defect: the recorder injects that partition at the scripted sender port, below the
 *    frame validation both sides do, which is what the README means by not claiming malformed-frame
 *    coverage. A reply shape the wire itself drops cannot cross a real frame boundary, so
 *    byte-identical replay is not available for it at any bridge. The two classes are the same
 *    cause seen twice. In 338 the first thing that differs is a settlement that never arrives. In
 *    the other seven the listener got far enough to act, so what differs first is downstream of the
 *    reply rather than the reply itself: three relay and pairing matrix goldens reach a different
 *    set of checkpoints, and four notification and chat ones lose an effect, either the
 *    stream-listener crash a `TypeError` on the absent result used to raise or a dismissal write
 *    that no longer happens. The suite names all seven in its output for as long as the class is
 *    small enough to name.
 * 4. **params-undefined, 33.** An own property whose value is `undefined` does not survive JSON. The
 *    wire frame is serialized either way, so the desktop sees the same bytes; what changes is that
 *    `projectMobileRpcRequestParams` runs shell-side on params that have already lost the key.
 * 5. **write-ordinal, 13.** Not a reorder on the wire: the page posts its frames in the order the
 *    operation made them and the payloads publish below the bridge in that same order. What moves
 *    is every write the operation makes *above* the bridge, the logical `sendRequest` stamp and
 *    each device effect, because those happen at the call while a same-turn `subscribe` payload is
 *    published a delivery later. `write-ordinal.ts` counts both into one sequence.
 *
 * ## What C1.6 owns and what it does not
 *
 * C1.6 closes the first class and nothing else. The ordinal class is excluded from it by the
 * predicate above: it is an artefact of where the recorder stamps, not of the bridge, and the only
 * recorder change that would close it — a logical `subscribe` stamp taken above the wrapper — moves
 * golden bodies, so no recorder engine change lands here beyond the seam itself. The two
 * `result-absent` classes are a bound on the claim rather than a bug, and `params-undefined` is a
 * shell-side projection question for whoever moves that screen.
 */

const root = resolve(import.meta.dirname, '../../../..')
const input = readScenarios(
  process.env.RPC_FOUNDATION_SCENARIOS ??
    resolve(root, 'mobile/rpc-foundation/pilot-scenarios.json')
)
const directory =
  process.env.RPC_FOUNDATION_GOLDENS ?? resolve(root, 'mobile/rpc-foundation/goldens')

/** One document's turn at the bridge is the whole recording, so both are constants. */
const SESSION_ID = 'recording-session'
const BUILD_ID = 'recording-build'
/** `ready` out, `init` back: two deliveries, and a round to see that the session landed. */
const HANDSHAKE_ROUNDS = 4

type Replay = {
  recording: Recording | null
  thrown: unknown
  pairs: BridgePortPair<RpcClient>[]
}

const counts: Record<BridgedParityClass, number> = {
  'reply-meta-required': 0,
  'result-absent-settlement': 0,
  'result-absent-observation': 0,
  'params-undefined': 0,
  'write-ordinal': 0,
  unclassified: 0
}
let identical = 0
const members = new Map<BridgedParityClass, string[]>()
const samples = new Map<BridgedParityClass, string>()
/** Small enough that naming every member beats naming a count. */
const NAMEABLE = 8

/**
 * The page's client over the shared port pair, holding the recorder's scripted client shell-side.
 *
 * The handshake is delivered in place because `BridgeRpcClient` refuses every member until `init`
 * has landed and its getters are what a screen reads during its first render, so a mount that raced
 * it would record a different first render. Nothing else has been queued at this point, so draining
 * here cannot reorder anything.
 */
function throughBridge(
  keep: (pair: BridgePortPair<RpcClient>) => void,
  rewriteToPage?: (json: string) => string
): ScriptedClientWrapper {
  return (client) => {
    const pair = createBridgePortPair({
      rpc: client,
      sessionId: SESSION_ID,
      buildId: BUILD_ID,
      rewriteToPage
    })
    keep(pair)
    for (let round = 0; round < HANDSHAKE_ROUNDS; round += 1) {
      if (pair.client.getShellSession() !== null) {
        return pair.client
      }
      pair.drainNow()
    }
    throw new Error('the page never received `init` from the bridge host')
  }
}

async function replay(
  id: string,
  scenarios: readonly RecordingScenario[],
  rewriteToPage?: (json: string) => string
): Promise<Replay> {
  const pairs: BridgePortPair<RpcClient>[] = []
  const checkpoints: Recording['checkpoints'] = []
  const named = scenarios.length > 1
  try {
    for (const scenario of scenarios) {
      const { adapters } = pilotMountAdapters(root, { device: scenario })
      const recording = await runRecording(
        scenario,
        adapters[scenario.operation],
        vitestRecordingScheduler(),
        throughBridge((pair) => pairs.push(pair), rewriteToPage)
      )
      for (const checkpoint of recording.checkpoints) {
        checkpoints.push(
          named ? { ...checkpoint, id: `${scenario.id}:${checkpoint.id}` } : checkpoint
        )
      }
    }
    return { recording: { scenario: id, checkpoints }, thrown: null, pairs }
  } catch (error) {
    return { recording: null, thrown: error, pairs }
  }
}

/** Everything the run knows about why it diverged, so a new class arrives readable, not as a stall. */
function explain(fields: readonly string[], run: Replay): string {
  const refused = refusedFrames(run.pairs.flatMap((pair) => pair.toPage))
  const [refusal] = refused
  const read = refusal === undefined ? null : readBridgeHostMessage(refusal)
  const kinds = run.pairs.flatMap((pair) => pair.diagnostics).map((diagnostic) => diagnostic.kind)
  return [
    `  fields    ${fields.slice(0, 4).join(', ') || '(none)'}`,
    `  threw     ${run.thrown instanceof Error ? run.thrown.message : '(nothing)'}`,
    `  refused   ${refused.length} frame(s)${
      read !== null && !read.ok ? `, first "${read.refusal}" on ${refusal?.slice(0, 200)}` : ''
    }`,
    `  page saw  ${kinds.join(', ') || '(no diagnostics)'}`
  ].join('\n')
}

/**
 * The verdict on one golden, and where it diverged, the counterfactual that says why.
 *
 * The second replay runs only for a golden that already diverged, and it is the one question the
 * page cannot be asked any other way: the reader wants a `_meta` the wire it stands in for does not
 * send, so a run where the lane supplies it separates what that costs from what the payload itself
 * does. Its own `_meta` comes back off before the diff, because a reply the page accepts resolves
 * to the caller whole.
 */
async function verdict(
  id: string,
  scenarios: readonly RecordingScenario[],
  run: Replay
): Promise<void> {
  const expected = readGolden(directory, id)
  const fields = run.recording === null ? [] : divergingFields(expected.recording, run.recording)
  if (run.recording !== null && fields.length === 0) {
    // Not redundant with the field walk: this one also pins the encoding and the header.
    compareGolden(expected, { ...expected, recording: run.recording })
    identical += 1
    return
  }
  const asIf = await replay(id, scenarios, withReplyMeta)
  const asIfFields =
    asIf.recording === null
      ? []
      : divergingFields(expected.recording, recordingWithoutRpcMeta(asIf.recording))
  const evidence: BridgedParityEvidence = {
    fixedByReplyMeta: asIf.recording !== null && asIfFields.length === 0,
    threwWhileRecording: asIf.recording === null,
    divergingFields: asIfFields,
    scriptsAbsentResultReply: scenarios.some(scriptsAbsentResultReply),
    sendsUndefinedValuedParam: scenarios.some(sendsUndefinedValuedParam)
  }
  const name = classifyBridgedParity(evidence)
  counts[name] += 1
  if (name === 'unclassified') {
    throw new Error(
      `Unclassified bridged divergence: ${id}\n${explain(fields, run)}\nwith \`_meta\` supplied:\n${explain(asIfFields, asIf)}`
    )
  }
  members.set(name, [...(members.get(name) ?? []), id])
  if (!samples.has(name)) {
    samples.set(name, `${id}\n${explain(fields, run)}`)
  }
}

describe.runIf(process.env[BRIDGED_PARITY_FLAG] === '1')(
  'every golden replays through the page bridge, byte-identically or in a named class',
  () => {
    for (const pilot of pilotGoldens(input.scenarios)) {
      it(`${pilot.id}: bridged parity`, async () => {
        await verdict(pilot.id, [pilot.scenario], await replay(pilot.id, [pilot.scenario]))
      })
    }
    for (const golden of familyGoldens(input.scenarios)) {
      it(
        `${golden.id}: bridged parity`,
        async () => {
          const scenarios = [...golden.scenarios()]
          await verdict(golden.id, scenarios, await replay(golden.id, scenarios))
        },
        golden.timeoutMs
      )
    }
    it('partitions every divergence into the classes the pin names', () => {
      const table = [
        `identical ${identical}`,
        ...Object.entries(counts).map(([name, count]) => {
          const named = members.get(asClass(name)) ?? []
          return count > 0 && count <= NAMEABLE
            ? `${name} ${count}: ${named.join(', ')}`
            : `${name} ${count}`
        })
      ].join('\n')
      process.stdout.write(`\nbridged parity over ${identical + total(counts)} goldens\n${table}\n`)
      for (const [name, sample] of samples) {
        process.stdout.write(`\n${name} sample\n${sample}\n`)
      }
      expect(counts.unclassified).toBe(0)
      for (const [name, count] of Object.entries(counts)) {
        expect({ [name]: count }).toEqual({
          [name]: Math.min(count, BRIDGED_PARITY_BASELINE[asClass(name)])
        })
      }
      expect(identical).toBeGreaterThanOrEqual(BRIDGED_PARITY_BASELINE.identical)
    })
  }
)

function total(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, count) => sum + count, 0)
}

/** The keys are this union by construction; the lookup below is what needs to say so. */
function asClass(name: string): BridgedParityClass {
  if (!(name in counts)) {
    throw new Error(`Not a bridged parity class: ${name}`)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: `name in counts` was just checked, and `counts` has exactly the union's keys.
  return name as BridgedParityClass
}
