// With native chat on, the renderer's startup also awaits the chat tab restore (`session.tabs.listAll`),
// which reads every chat whose tab was open at quit. That read must not wait on record-store
// bookkeeping: with a saved tab index it writes nothing, and a store that cannot be written costs
// a bounded number of lock waits, not one per chat.

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { RuntimeMobileSessionTabsSnapshot } from '../../shared/runtime-types'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../shared/agent-session-record.test-fixture'
import type * as FileTransactionLock from '../file-transaction-lock'
import { JournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database'
import { openAgentSessionJournal } from '../native-chat/agent-session-journal/journal-store-factory'
import { journalIdentityFor } from '../native-chat/agent-session-wire/structured-agent-session-attach'
import { attachParamsForRecord } from '../native-chat/agent-session-wire/structured-agent-session-conversation-open'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { AgentSessionRecordStore } from './agent-session-record-store'
import {
  AGENT_SESSION_STORE_SCHEMA_VERSION,
  agentSessionStorePath
} from './agent-session-record-store-file'
import { MantaRuntimeService } from './manta-runtime'
import {
  ensureStructuredAgentSessionHost,
  stopStructuredAgentSessionRuntime
} from './structured-agent-session-runtime'

// `failing` refuses every take; `grants` lets that many more through, then refuses.
const lock = vi.hoisted(() => ({ failing: false, grants: Infinity, refused: 0 }))

vi.mock('../file-transaction-lock', async (importOriginal) => {
  const actual = await importOriginal<typeof FileTransactionLock>()
  return {
    ...actual,
    withFileTransactionLock: (...args: Parameters<typeof actual.withFileTransactionLock>) => {
      if (lock.failing || lock.grants <= 0) {
        lock.refused += 1
        // What proper-lockfile throws once its retries give up, about 3 s later.
        return Promise.reject(
          Object.assign(new Error('Lock file is already being held'), { code: 'ELOCKED' })
        )
      }
      lock.grants -= 1
      return actual.withFileTransactionLock(...args)
    }
  }
})

const PROMPT = 'add a retry'
const CHAT_A = 'chat-a-0001'
const CHAT_B = 'chat-b-0002'
const CLEARED = 'chat-s-0003'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-startup-tab-restore-'))
})

afterEach(async () => {
  Object.assign(lock, { failing: false, grants: Infinity, refused: 0 })
  await stopStructuredAgentSessionRuntime().catch(() => undefined)
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

/** A released chat, so no startup probe looks for a live owner. */
function chatRecord(
  sessionId: string,
  options: { codex?: boolean; clearedInto?: string } = {}
): AgentSessionRecord {
  const record = agentSessionRecordFixture(
    agentSessionLeaseFixture({
      sessionId,
      ownerProcess: null,
      reservedSpawnToken: null,
      claimStatus: 'released'
    })
  )
  const codex = options.codex
    ? {
        provider: 'codex' as const,
        providerHandleChain: record.providerHandleChain.map((link) => ({
          ...link,
          handle: { provider: 'codex' as const, threadId: `thread-${sessionId}` }
        })),
        accountHome: { variable: 'CODEX_HOME' as const, path: join(root, 'codex-home') }
      }
    : {}
  const clear = options.clearedInto
    ? {
        conversationCommand: {
          command: 'clear' as const,
          state: 'completed' as const,
          phase: 'committed' as const,
          operationId: `clear-${sessionId}`,
          callerKey: 'client-1',
          replacementSessionId: options.clearedInto
        }
      }
    : {}
  return { ...record, ...codex, ...clear }
}

/** Writes the record store; `visible` is the saved tab index, absent on a legacy profile. */
async function seedStore(
  records: AgentSessionRecord[],
  options: { newer?: boolean; visible?: string[] } = {}
) {
  const storeDirectory = join(root, 'agent-sessions')
  const path = agentSessionStorePath(storeDirectory)
  await mkdir(storeDirectory, { recursive: true })
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: AGENT_SESSION_STORE_SCHEMA_VERSION + (options.newer ? 1 : 0),
      hostId: 'local',
      records: Object.fromEntries(records.map((record) => [record.sessionId, record])),
      operations: {},
      retiredClaimKeys: [],
      unusableRecords: {},
      ...(options.visible ? { visibleSessionIds: options.visible } : {})
    })
  )
  return { storeDirectory, path }
}

/** Each chat's history as the last run left it: one prompt, accepted, so nothing is left to send. */
async function seedHistory(records: AgentSessionRecord[]): Promise<void> {
  const database = JournalHostDatabase.open(root)
  for (const record of records) {
    const fence = record.lease.runtimeFence
    const journal = await openAgentSessionJournal({
      identity: journalIdentityFor(
        record,
        attachParamsForRecord(record, { clientOperationId: 'seed', expectedRuntimeFence: fence })
      ),
      database
    })
    await journal.appendSubmission({
      clientMessageId: 'client-1',
      payloadFingerprint: 'fp-1',
      body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: PROMPT }] },
      fence,
      handoverRecorded: true
    })
    await journal.resolveDispatch({
      clientMessageId: 'client-1',
      fence,
      state: 'accepted',
      providerIdentity: null
    })
    await journal.close()
  }
  database.close()
}

function startupRuntime(options: { afterInstall?: () => void; profileChats?: string[] } = {}) {
  const onError = vi.fn()
  const runtime = new MantaRuntimeService()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these are the runtime's own protected members; the test roots the host at `root`, stubs the PTY daemon and gives it a profile.
  const internal = runtime as unknown as {
    hasPersistedStructuredAgentSessionStore(): boolean
    ensureStructuredAgentSessionHost(): Promise<unknown>
    refreshMobileSessionPtyRecords(): Promise<Set<string> | null>
    mobileSessionTabsByWorktree: Map<string, RuntimeMobileSessionTabsSnapshot>
    store: { getWorkspaceSession: () => unknown }
  }
  internal.hasPersistedStructuredAgentSessionStore = () => true
  internal.ensureStructuredAgentSessionHost = async () => {
    const installed = await ensureStructuredAgentSessionHost({
      stateDirectory: root,
      hostId: 'local',
      claimKeyId: 'key-1',
      resolveWorkspacePath: async () => root,
      resolveEnvironment: async () => ({}),
      resolveClaudeAuthPolicy: () => ({ stripAuthEnv: true }),
      onError
    })
    options.afterInstall?.()
    return installed
  }
  internal.refreshMobileSessionPtyRecords = async () => new Set<string>()
  // A legacy profile's saved chat tabs, which a store with no tab index restores from.
  internal.store = {
    getWorkspaceSession: () => ({
      activeRepoId: null,
      activeWorktreeId: 'workspace-1',
      activeTabId: null,
      tabsByWorktree: {},
      terminalLayoutsByTabId: {},
      unifiedTabs: {
        'workspace-1': (options.profileChats ?? []).map((sessionId, index) => ({
          id: `agent-session:${sessionId}`,
          entityId: sessionId,
          groupId: 'group-1',
          worktreeId: 'workspace-1',
          contentType: 'agent-session',
          label: 'Codex Chat',
          customLabel: null,
          color: null,
          sortOrder: index,
          createdAt: 1
        }))
      }
    })
  }
  return {
    runtime,
    onError,
    published: () => internal.mobileSessionTabsByWorktree.get('workspace-1')?.tabs ?? []
  }
}

async function expectHistory(sessionId: string): Promise<void> {
  const host = getStructuredAgentSessionHost()
  expect(JSON.stringify((await host!.journalSnapshot(sessionId)).items)).toContain(PROMPT)
}

function spyOnTabWrites() {
  return {
    visibility: vi.spyOn(AgentSessionRecordStore.prototype, 'setSessionTabVisibility'),
    seed: vi.spyOn(AgentSessionRecordStore.prototype, 'showSessionTabs')
  }
}

async function tabIndexOnDisk(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf-8')).visibleSessionIds
}

describe('restoring the chat tabs open at quit', () => {
  it.each([
    { store: 'records a newer Manta wrote', newer: true, lockFails: false },
    { store: 'a lock that keeps failing', newer: false, lockFails: true }
  ])('lists and reads every chat from $store, and writes nothing', async ({ newer, lockFails }) => {
    const records = [
      chatRecord(CHAT_A),
      chatRecord(CHAT_B),
      chatRecord(CLEARED, { clearedInto: CHAT_A })
    ]
    const { storeDirectory, path } = await seedStore(records, { newer, visible: [CHAT_A, CHAT_B] })
    await seedHistory(records.slice(0, 2))
    const bytes = await readFile(path)
    const files = await readdir(storeDirectory)
    const writes = spyOnTabWrites()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // Free when the store opens, then held for good.
    const { runtime, onError, published } = startupRuntime({
      afterInstall: () => {
        lock.failing = lockFails
      }
    })

    await expect(runtime.restoreStructuredAgentSessionTabs()).resolves.toBeUndefined()

    expect(published().map((tab) => tab.id)).toEqual([
      `agent-session:${CHAT_A}`,
      `agent-session:${CHAT_B}`
    ])
    expect(published()[0]).toMatchObject({ replacesSessionId: CLEARED })
    await expectHistory(CHAT_A)
    await expectHistory(CHAT_B)
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith({
      scope: 'structured-agent-session-lease-reconcile',
      error: expect.objectContaining(
        newer ? { message: 'agent_session_legacy_required' } : { code: 'ELOCKED' }
      )
    })
    expect(writes.visibility).not.toHaveBeenCalled()
    expect(writes.seed).not.toHaveBeenCalled()
    await stopStructuredAgentSessionRuntime()
    if (newer) {
      expect(await readFile(path)).toEqual(bytes)
      expect(await readdir(storeDirectory)).toEqual(files)
    }
  })

  // Each refused take stands for one lock wait of about 3 s.
  it.each([1, 4, 8])(
    'waits on a held lock once per startup step with %i chats open',
    async (count) => {
      const chats = Array.from({ length: count }, (_, index) => `chat-${index}-000${index}`)
      const records = chats.map((sessionId) => chatRecord(sessionId))
      await seedStore(records, { visible: chats })
      await seedHistory(records)
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const { runtime, published } = startupRuntime({
        afterInstall: () => {
          lock.failing = true
        }
      })

      await runtime.prepareStructuredAgentSessionStartupRestoration()
      const prepared = lock.refused
      await runtime.restoreStructuredAgentSessionTabs()

      expect(published()).toHaveLength(count)
      expect(prepared).toBe(1)
      expect(lock.refused - prepared).toBe(1)
    }
  )

  describe('on a legacy profile, with no tab index yet', () => {
    const legacyChats = () => [
      chatRecord(CHAT_A, { codex: true }),
      chatRecord(CHAT_B, { codex: true })
    ]

    it('records every restored chat in one write', async () => {
      const records = legacyChats()
      const { path } = await seedStore(records)
      await seedHistory(records)
      const writes = spyOnTabWrites()
      const { runtime, published } = startupRuntime({ profileChats: [CHAT_A, CHAT_B] })
      await runtime.prepareStructuredAgentSessionStartupRestoration()
      // One more take, then held: a seed written chat by chat would stop part way.
      lock.grants = 1

      await runtime.restoreStructuredAgentSessionTabs()

      expect(published().map((tab) => tab.id)).toEqual([
        `agent-session:${CHAT_A}`,
        `agent-session:${CHAT_B}`
      ])
      expect(await tabIndexOnDisk(path)).toEqual([CHAT_A, CHAT_B])
      expect(writes.seed).toHaveBeenCalledOnce()
      expect(writes.visibility).not.toHaveBeenCalled()
    })

    it('waits on a held lock once more, for that one write', async () => {
      const records = legacyChats()
      await seedStore(records)
      await seedHistory(records)
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const { runtime, published } = startupRuntime({
        profileChats: [CHAT_A, CHAT_B],
        afterInstall: () => {
          lock.failing = true
        }
      })

      await runtime.prepareStructuredAgentSessionStartupRestoration()
      const prepared = lock.refused
      await runtime.restoreStructuredAgentSessionTabs()

      expect(published()).toHaveLength(2)
      expect(prepared).toBe(1)
      // The restore's lease check and the seed.
      expect(lock.refused - prepared).toBe(2)
    })

    it('still lists the chats when that write fails, and leaves the index absent', async () => {
      const records = legacyChats()
      const { path } = await seedStore(records)
      await seedHistory(records)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const { runtime, published } = startupRuntime({ profileChats: [CHAT_A, CHAT_B] })
      await runtime.prepareStructuredAgentSessionStartupRestoration()
      lock.failing = true

      await expect(runtime.restoreStructuredAgentSessionTabs()).resolves.toBeUndefined()

      expect(published()).toHaveLength(2)
      await expectHistory(CHAT_A)
      expect(warn).toHaveBeenCalledWith(
        '[structured-agent-session] recording restored chat tabs failed',
        { sessionIds: [CHAT_A, CHAT_B], error: expect.objectContaining({ code: 'ELOCKED' }) }
      )
      expect(await tabIndexOnDisk(path)).toBeUndefined()
    })
  })
})
