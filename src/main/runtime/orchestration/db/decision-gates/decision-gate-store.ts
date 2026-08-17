import type { GateStatus, DecisionGateRow } from '../../types'
import { LEGACY_RUN_ID } from '../contract-constants'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'

// ── Decision Gates ──

export function createGate(
  this: OrchestrationDb,
  gate: { taskId: string; question: string; options?: string[] }
): DecisionGateRow {
  const id = generateId('gate')
  const optionsJson = JSON.stringify(gate.options ?? [])
  this.db
    .prepare(
      'INSERT INTO decision_gates (id, run_id, task_id, question, options) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      id,
      this.getTask(gate.taskId)?.run_id ?? LEGACY_RUN_ID,
      gate.taskId,
      gate.question,
      optionsJson
    )

  this.completeActiveDispatchForTask(gate.taskId)
  this.db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(gate.taskId)

  return this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(id) as DecisionGateRow
}

export function resolveGate(
  this: OrchestrationDb,
  gateId: string,
  resolution: string
): DecisionGateRow | undefined {
  const gate = this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(gateId) as
    | DecisionGateRow
    | undefined
  if (!gate) {
    return undefined
  }

  this.db
    .prepare(
      "UPDATE decision_gates SET status = 'resolved', resolution = ?, resolved_at = datetime('now') WHERE id = ?"
    )
    .run(resolution, gateId)

  // Why: set to 'ready' (not the previous status) so the coordinator re-dispatches the worker with the resolution context.
  this.db.prepare("UPDATE tasks SET status = 'ready' WHERE id = ?").run(gate.task_id)

  return this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(gateId) as
    | DecisionGateRow
    | undefined
}

export function timeoutGate(this: OrchestrationDb, gateId: string): DecisionGateRow | undefined {
  this.db
    .prepare(
      // Why: without the status guard a late timeout overwrites a gate the user already resolved.
      "UPDATE decision_gates SET status = 'timeout', resolved_at = datetime('now') WHERE id = ? AND status = 'pending'"
    )
    .run(gateId)
  return this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(gateId) as
    | DecisionGateRow
    | undefined
}

export function listGates(
  this: OrchestrationDb,
  filter?: { taskId?: string; status?: GateStatus }
): DecisionGateRow[] {
  if (filter?.taskId && filter?.status) {
    return this.db
      .prepare('SELECT * FROM decision_gates WHERE task_id = ? AND status = ? ORDER BY created_at')
      .all(filter.taskId, filter.status) as DecisionGateRow[]
  }
  if (filter?.taskId) {
    return this.db
      .prepare('SELECT * FROM decision_gates WHERE task_id = ? ORDER BY created_at')
      .all(filter.taskId) as DecisionGateRow[]
  }
  if (filter?.status) {
    return this.db
      .prepare('SELECT * FROM decision_gates WHERE status = ? ORDER BY created_at')
      .all(filter.status) as DecisionGateRow[]
  }
  return this.db
    .prepare('SELECT * FROM decision_gates ORDER BY created_at')
    .all() as DecisionGateRow[]
}

export function getGate(this: OrchestrationDb, id: string): DecisionGateRow | undefined {
  return this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(id) as
    | DecisionGateRow
    | undefined
}

export type DecisionGateStoreMethods = {
  createGate: typeof createGate
  resolveGate: typeof resolveGate
  timeoutGate: typeof timeoutGate
  listGates: typeof listGates
  getGate: typeof getGate
}

export function attachDecisionGateStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createGate,
    resolveGate,
    timeoutGate,
    listGates,
    getGate
  })
}
