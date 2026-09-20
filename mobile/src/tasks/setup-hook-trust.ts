import type { PersistedTrustedMantaHooks } from '../../../src/shared/manta-yaml-hook-types'
import type { RpcClient } from '../transport/rpc-client'
import { taskUiStateWrite } from './mobile-task-runtime-operations'

export type SetupHookTrust = {
  contentHash: string
  scriptContent: string
}

export function isSetupHookTrusted(
  trust: PersistedTrustedMantaHooks,
  repoId: string,
  contentHash: string
): boolean {
  const repoTrust = trust[repoId]
  return Boolean(repoTrust?.all || repoTrust?.setup?.contentHash === contentHash)
}

export function wasSetupHookPreviouslyApproved(
  trust: PersistedTrustedMantaHooks,
  repoId: string
): boolean {
  return Boolean(trust[repoId]?.setup?.contentHash)
}

export function trustedMantaHooksWithSetupApproval(args: {
  trust: PersistedTrustedMantaHooks
  repoId: string
  contentHash: string
  alwaysTrust: boolean
  approvedAt?: number
}): PersistedTrustedMantaHooks {
  const approvedAt = args.approvedAt ?? Date.now()
  const existing = args.trust[args.repoId]
  const nextRepo = args.alwaysTrust
    ? { ...existing, all: { approvedAt } }
    : { ...existing, setup: { contentHash: args.contentHash, approvedAt } }
  return { ...args.trust, [args.repoId]: nextRepo }
}

export async function persistSetupHookTrustApproval(args: {
  client: RpcClient
  trust: PersistedTrustedMantaHooks
  repoId: string
  contentHash: string
  alwaysTrust: boolean
}): Promise<PersistedTrustedMantaHooks> {
  const next = trustedMantaHooksWithSetupApproval(args)
  taskUiStateWrite.interpret(
    await taskUiStateWrite.request(args.client, { trustedMantaHooks: next })
  )
  return next
}

// Takes a partial record because a checked `repo.hooks` reader requires neither member: the
// recorded reply carries a hooks payload with no setupTrust at all, so the pair is proven here
// rather than declared upstream. The spread keeps whatever else the host sent on the record.
export function normalizeSetupHookTrust(
  setupTrust: { contentHash?: string; scriptContent?: string } | null | undefined
): SetupHookTrust | null {
  const contentHash = setupTrust?.contentHash
  const scriptContent = setupTrust?.scriptContent
  if (!contentHash || !scriptContent) {
    return null
  }
  return { ...setupTrust, contentHash, scriptContent }
}
