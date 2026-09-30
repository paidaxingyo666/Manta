// A profile whose chat records a newer Manta wrote opens read-only. The startup reconcile cannot
// write there, which is bookkeeping: startup must still finish rather than put the whole app into
// its degraded "Session restore failed" mode, and the file must be left exactly as it was.

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import {
  AGENT_SESSION_STORE_SCHEMA_VERSION,
  agentSessionStorePath
} from './agent-session-record-store-file'
import { MantaRuntimeService } from './manta-runtime'
import {
  ensureStructuredAgentSessionHost,
  stopStructuredAgentSessionRuntime
} from './structured-agent-session-runtime'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-startup-reconcile-'))
})

afterEach(async () => {
  await stopStructuredAgentSessionRuntime().catch(() => undefined)
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

/** A profile whose record store a newer Manta wrote, with one chat in it. */
async function seedNewerStore() {
  const storeDirectory = join(root, 'agent-sessions')
  const path = agentSessionStorePath(storeDirectory)
  const record = agentSessionRecordFixture()
  await mkdir(storeDirectory, { recursive: true })
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: AGENT_SESSION_STORE_SCHEMA_VERSION + 1,
      hostId: 'local',
      records: { [record.sessionId]: record },
      operations: {},
      retiredClaimKeys: [],
      unusableRecords: {}
    })
  )
  return { storeDirectory, path, sessionId: record.sessionId }
}

function startupRuntime(onError?: (input: { scope: string; error: unknown }) => void) {
  const runtime = new MantaRuntimeService()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these are the runtime's own protected members; the test roots the host at `root` and stubs the PTY daemon.
  const internal = runtime as unknown as {
    hasPersistedStructuredAgentSessionStore(): boolean
    ensureStructuredAgentSessionHost(): Promise<unknown>
    refreshMobileSessionPtyRecords(): Promise<Set<string> | null>
  }
  internal.hasPersistedStructuredAgentSessionStore = () => true
  internal.ensureStructuredAgentSessionHost = () =>
    ensureStructuredAgentSessionHost({
      stateDirectory: root,
      hostId: 'local',
      claimKeyId: 'key-1',
      resolveWorkspacePath: async () => root,
      resolveEnvironment: async () => ({}),
      resolveClaudeAuthPolicy: () => ({ stripAuthEnv: true }),
      ...(onError ? { onError } : {})
    })
  internal.refreshMobileSessionPtyRecords = async () => new Set<string>()
  return runtime
}

it('finishes startup over records a newer Manta wrote, reports it, and writes nothing', async () => {
  const { storeDirectory, path, sessionId } = await seedNewerStore()
  const bytes = await readFile(path)
  const files = await readdir(storeDirectory)
  const onError = vi.fn()
  const runtime = startupRuntime(onError)

  // What the renderer's startup awaits through `app:prepareTerminalStartupRestoration`.
  await expect(runtime.prepareStructuredAgentSessionStartupRestoration()).resolves.toBeUndefined()

  expect(onError).toHaveBeenCalledOnce()
  expect(onError).toHaveBeenCalledWith({
    scope: 'structured-agent-session-lease-reconcile',
    error: expect.objectContaining({ message: 'agent_session_legacy_required' })
  })
  expect(getStructuredAgentSessionHost()?.sessionAgent(sessionId)).toBe('claude')
  await stopStructuredAgentSessionRuntime()
  expect(await readFile(path)).toEqual(bytes)
  expect(await readdir(storeDirectory)).toEqual(files)
})

// The desktop installs its host with no error sink, so the failure is logged rather than dropped.
it('logs the failure when the host has no error sink', async () => {
  await seedNewerStore()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

  await expect(
    startupRuntime().prepareStructuredAgentSessionStartupRestoration()
  ).resolves.toBeUndefined()

  expect(warn).toHaveBeenCalledWith(
    '[structured-agent-session] reconciling chat leases failed',
    expect.objectContaining({ message: 'agent_session_legacy_required' })
  )
})
