import { z } from 'zod'
import {
  isAgentLaunchResult,
  type AgentLaunchResult
} from '../../../src/shared/agent-launch-intent'
import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'
import { rpcUncheckedPayloadReader } from '../transport/rpc-reader-payload'

// Legacy readers preserve their existing validation; the replay-required route validates receipts.

/**
 * worktree.create. A lost reply is *unknown*, never failed — `worktree-create-retry.ts` replays on
 * the same clientMutationId — so this operation never interprets a transport rejection: `request`
 * hands back the transport promise itself and the delivery-unknown mark reaches the retry loop on
 * the original rejection object.
 */
export const worktreeCreateRun = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'worktree.create',
    method: 'worktree.create',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('created-worktree')
  })
)

/**
 * agent.launch carrying a create payload: the host settles whether the agent lands in a structured
 * session or a terminal. Same reply discipline as worktreeCreateRun, and for the same reason — the
 * two share one clientMutationId, so the retry loop must see an unlost reply either way.
 */
export const agentLaunchRun = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'agent.launch',
    method: 'agent.launch',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('agent-launch-receipt')
  })
)

export const agentLaunchReplayRun = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'agent.launch-replay',
    method: 'agent.launchReplay',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('agent-launch-receipt', z.custom<AgentLaunchResult>(isAgentLaunchResult))
  })
)

/**
 * The start point for a workspace created from a linked pull request. Refusal throws the host's
 * message; an accepted reply can still carry a soft `{ error }` the caller raises itself.
 */
export const worktreePrBaseResolve = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'worktree.resolve-pr-base',
    method: 'worktree.resolvePrBase',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('pr-start-point')
  })
)

/** The GitLab merge-request equivalent; same acceptance, same soft-error convention. */
export const worktreeMrBaseResolve = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'worktree.resolve-mr-base',
    method: 'worktree.resolveMrBase',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('mr-start-point')
  })
)

/**
 * status.get read for create-time capabilities, with its own policy on that method.
 *
 * Separately named because the callers disagree about what a refused status means: the
 * Tasks screen cannot hydrate without it and surfaces the host's message (`taskRuntimeStatusRead`),
 * while create-time capability probing degrades to "no capabilities" and creates anyway, so here a
 * refusal is a skip. One reader serves both — the payload is unchecked in each.
 */
export const worktreeCreateCapabilityRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'status.create-capabilities-or-skip',
    method: 'status.get',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('runtime-status')
  })
)
