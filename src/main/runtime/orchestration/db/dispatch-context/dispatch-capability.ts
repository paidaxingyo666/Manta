import { randomBytes } from 'node:crypto'
import { OrchestrationError } from '../../orchestration-error'
import { hashDispatchCapability } from '../dispatch-capability-hash'
import type { OrchestrationDb } from '../orchestration-db'

export function mintDispatchCapability(
  this: OrchestrationDb,
  params: {
    dispatchId: string
    paneKey: string
    processIncarnation: string
  }
): string {
  const dispatch = this.getDispatchContextById(params.dispatchId)
  if (!dispatch || (dispatch.status !== 'pending' && dispatch.status !== 'dispatched')) {
    throw new OrchestrationError(
      'dispatch_inactive',
      `Dispatch ${params.dispatchId} is not active.`
    )
  }
  const capability = `dcap_${randomBytes(32).toString('base64url')}`
  // Why: re-pointing the Dispatch at a pane/process must fence the prior consumer's Delivery in
  // the same transaction, or both processes keep acking one outstanding Delivery.
  this.db.exec('BEGIN IMMEDIATE')
  try {
    this.db
      .prepare(
        `UPDATE dispatch_contexts
         SET capability_hash = ?, assignee_pane_key = ?, process_incarnation = ?,
             capability_revoked_at = NULL,
             consumer_generation = consumer_generation + 1
         WHERE id = ?`
      )
      .run(
        hashDispatchCapability(capability),
        params.paneKey,
        params.processIncarnation,
        params.dispatchId
      )
    this.fenceUnacknowledgedMailboxDeliveries(`dispatch:${params.dispatchId}`)
    this.db.exec('COMMIT')
  } catch (error) {
    this.db.exec('ROLLBACK')
    throw error
  }
  return capability
}

export function revokeDispatchCapability(this: OrchestrationDb, dispatchId: string): void {
  this.db
    .prepare(
      `UPDATE dispatch_contexts
       SET capability_revoked_at = COALESCE(capability_revoked_at, datetime('now'))
       WHERE id = ?`
    )
    .run(dispatchId)
}

export type DispatchCapabilityMethods = {
  mintDispatchCapability: typeof mintDispatchCapability
  revokeDispatchCapability: typeof revokeDispatchCapability
}

export function attachDispatchCapability(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    mintDispatchCapability,
    revokeDispatchCapability
  })
}
