// The lease reconcile is bookkeeping: a lock that gives up or a store this build may not write is
// reported, and startup and every read carry on. Nothing is owed after it, because an unreconciled
// lease grants no writer and the next send reconciles every lease again before it acts.

import { cp, readdir, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type * as FileTransactionLock from '../../file-transaction-lock'
import { AGENT_SESSION_STORE_SCHEMA_VERSION } from '../../runtime/agent-session-record-store-file'
import {
  editPersistedTestAgentSessionStore,
  openTestAgentSessionRecordStore,
  type PersistedTestAgentSessionStore,
  testAgentSessionStoreFilePath
} from '../../runtime/agent-session-record-store-test-harness'
import {
  StructuredAgentSessionHost,
  type StructuredAgentSessionHostDeps
} from './structured-agent-session-host'
import {
  adapter,
  attach,
  CALLER,
  envelope,
  hostTestState,
  replaceHostTestState
} from './structured-agent-session-host-test-harness'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION,
  hostTestMessage
} from './structured-agent-session-host-test-data'
import { openTestJournalHostDatabase } from '../agent-session-journal/journal-host-database-test-support'

const lock = vi.hoisted(() => ({ failing: false }))

vi.mock('../../file-transaction-lock', async (importOriginal) => {
  const actual = await importOriginal<typeof FileTransactionLock>()
  return {
    ...actual,
    withFileTransactionLock: (...args: Parameters<typeof actual.withFileTransactionLock>) =>
      lock.failing
        ? // What proper-lockfile throws once its retries give up.
          Promise.reject(
            Object.assign(new Error('Lock file is already being held'), { code: 'ELOCKED' })
          )
        : actual.withFileTransactionLock(...args)
  }
})

const relaunchedRoots: string[] = []

afterEach(async () => {
  lock.failing = false
  await Promise.all(
    relaunchedRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

/** A host with one chat, relaunched over a copy of its files; `rewrite` edits the copied store. */
async function relaunch(
  rewrite?: (persisted: PersistedTestAgentSessionStore) => void,
  probeOwner: StructuredAgentSessionHostDeps['probeOwner'] = async () => ({
    outcome: 'pid-absent'
  })
) {
  const dying = hostTestState()
  await attach()
  // An empty renewal queues behind every record write, so they are on disk.
  await dying.store.renewLeases([])
  const relaunched = `${dying.root}-relaunched`
  relaunchedRoots.push(relaunched)
  // A dead process holds no lock.
  await cp(dying.root, relaunched, {
    recursive: true,
    filter: (source) => !source.includes('.lock')
  })
  const storePath = testAgentSessionStoreFilePath(relaunched)
  if (rewrite) {
    await editPersistedTestAgentSessionStore(relaunched, rewrite)
  }
  const store = await openTestAgentSessionRecordStore(relaunched)
  const onLeaseReconcileFailure = vi.fn()
  const host = new StructuredAgentSessionHost({
    store,
    adapter: adapter(),
    journalDatabase: openTestJournalHostDatabase(relaunched),
    claimKeyId: 'key-1',
    mintSpawnToken: () => 'spawn-next',
    probeOwner,
    stopOwnerProcess: () => {
      throw new Error('an owner not proven alive must not be stopped')
    },
    now: () => NOW,
    onLeaseReconcileFailure
  })
  replaceHostTestState({ store, host })
  return { host, store, storePath, onLeaseReconcileFailure }
}

it('reports a startup reconcile whose store write fails, and does not reject', async () => {
  const { host, store, onLeaseReconcileFailure } = await relaunch()

  lock.failing = true
  await expect(host.reconcileRestartLeases()).resolves.toBeUndefined()

  expect(onLeaseReconcileFailure).toHaveBeenCalledOnce()
  expect(onLeaseReconcileFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'ELOCKED' }))
  // Nothing was adjudicated, so the lease still grants no writer.
  expect(store.getRecord(SESSION)?.lease.unreconciled).toBe(true)
})

it('reconciles the chat on its next send once the store can be written again', async () => {
  const { host, store, onLeaseReconcileFailure } = await relaunch()
  lock.failing = true
  await host.reconcileRestartLeases()
  expect(onLeaseReconcileFailure).toHaveBeenCalledOnce()
  lock.failing = false

  const body = hostTestMessage('sent after a startup reconcile failed')
  await expect(
    host.send(CALLER, { envelope: envelope('agentSession.send', { body }), body })
  ).resolves.toMatchObject({ ok: true })

  // The send is queued; delivering it starts the agent, and that start reconciles the lease.
  await vi.waitFor(() => expect(hostTestState().dispatch).toHaveBeenCalledOnce(), {
    timeout: 10_000
  })
  expect(store.getRecord(SESSION)?.lease.unreconciled).toBe(false)
  expect(onLeaseReconcileFailure).toHaveBeenCalledOnce()
  // Before the relaunched directory is removed, so the child's wind-down can write its lease.
  await host.flushAllStreamedEvents()
})

it('reports a store a newer Manta wrote without writing it, and does not reject', async () => {
  const { host, store, storePath, onLeaseReconcileFailure } = await relaunch((persisted) => {
    persisted.schemaVersion = AGENT_SESSION_STORE_SCHEMA_VERSION + 1
  })
  expect(store.readOnly).toBe(true)
  const bytes = await readFile(storePath)
  const files = await readdir(dirname(storePath))

  await expect(host.reconcileRestartLeases()).resolves.toBeUndefined()

  expect(onLeaseReconcileFailure).toHaveBeenCalledOnce()
  expect(onLeaseReconcileFailure).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'agent_session_legacy_required' })
  )
  expect(store.listRecords().map((record) => record.sessionId)).toEqual([SESSION])
  expect(await readFile(storePath)).toEqual(bytes)
  expect(await readdir(dirname(storePath))).toEqual(files)
})

it('restores a chat for reading while the reconcile keeps failing, and reports it once', async () => {
  const { host, store, onLeaseReconcileFailure } = await relaunch()
  lock.failing = true
  await host.reconcileRestartLeases()

  await expect(host.restoreReadableSessions([SESSION])).resolves.toBeUndefined()

  expect(host.hasSession(SESSION)).toBe(true)
  expect(store.getRecord(SESSION)?.lease.unreconciled).toBe(true)
  expect(onLeaseReconcileFailure).toHaveBeenCalledOnce()
  expect(onLeaseReconcileFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'ELOCKED' }))
})

it('restores a chat for reading from a store a newer Manta wrote', async () => {
  const { host, storePath, onLeaseReconcileFailure } = await relaunch((persisted) => {
    persisted.schemaVersion = AGENT_SESSION_STORE_SCHEMA_VERSION + 1
  })
  const bytes = await readFile(storePath)

  await expect(host.restoreReadableSessions([SESSION])).resolves.toBeUndefined()

  expect(host.hasSession(SESSION)).toBe(true)
  expect(onLeaseReconcileFailure).toHaveBeenCalledOnce()
  expect(await readFile(storePath)).toEqual(bytes)
})

// A chat whose owner could not be proven gone is left recovering; the next attach or send retries it.
it('restores a chat for reading when resolving its recovery cannot write the store', async () => {
  const { host, store, onLeaseReconcileFailure } = await relaunch(undefined, async () => ({
    outcome: 'indeterminate',
    reason: 'probe'
  }))
  await host.reconcileRestartLeases()
  expect(store.getRecord(SESSION)?.lease.handoffStage).toBe('recovering')
  lock.failing = true

  await expect(host.restoreReadableSessions([SESSION])).resolves.toBeUndefined()

  expect(host.hasSession(SESSION)).toBe(true)
  expect(store.getRecord(SESSION)?.lease.handoffStage).toBe('recovering')
  expect(onLeaseReconcileFailure).toHaveBeenCalledOnce()
  expect(onLeaseReconcileFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'ELOCKED' }))
})

it.each([
  ['startup reconcile', (host: StructuredAgentSessionHost) => host.reconcileRestartLeases()],
  ['read restore', (host: StructuredAgentSessionHost) => host.restoreReadableSessions([SESSION])]
])('keeps the %s resolving when the failure sink throws', async (_step, read) => {
  const { host, onLeaseReconcileFailure } = await relaunch()
  const sinkError = new Error('error sink failed')
  onLeaseReconcileFailure.mockImplementation(() => {
    throw sinkError
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  lock.failing = true
  try {
    await expect(read(host)).resolves.toBeUndefined()

    expect(onLeaseReconcileFailure).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('reporting a lease bookkeeping failure failed'),
      expect.objectContaining({ failure: expect.objectContaining({ code: 'ELOCKED' }), sinkError })
    )
  } finally {
    warn.mockRestore()
  }
})
