/**
 * Rebinding the transcript tail is not enough on its own.
 *
 * A compacted session opens a NEW file under a NEW id, and a backgrounded
 * session cannot say so — its hooks are muted at the script (#9236). The pane's
 * identity therefore stays pinned to a file nobody writes to again, and every
 * surface that re-derives a path from it (the seed read, pagination, the next
 * resubscribe) keeps showing the conversation that stopped. Measured once at 27
 * hours, on a chat that looked perfectly healthy the whole time.
 */
import { describe, expect, it, vi } from 'vitest'
import { AgentHookServer } from './server'

const PANE = 'tab-1:11111111-1111-4111-8111-111111111111'
const OTHER_PANE = 'tab-2:22222222-2222-4222-8222-222222222222'
const OLD = 'd7088df0-6130-486e-955a-eb08b295acce'
const NEW = '051ba680-d60e-42e8-b69d-cd73abd31eac'

function seed(server: AgentHookServer, paneKey: string, sessionId: string): void {
  server.ingestRemote(
    {
      paneKey,
      tabId: paneKey.split(':')[0],
      worktreeId: 'folder-workspace',
      source: 'claude',
      payload: { state: 'done', agentType: 'claude' },
      providerSession: { key: 'session_id', id: sessionId, transcriptPath: `/p/${sessionId}.jsonl` }
    },
    'ssh-connection'
  )
}

function sessionOf(server: AgentHookServer, paneKey: string) {
  return server.getStatusSnapshotForPane(paneKey)[0]?.providerSession
}

describe('noteSessionContinued', () => {
  it('publishes the identity mutation without renewing status freshness', () => {
    const server = new AgentHookServer()
    seed(server, PANE, OLD)
    const before = server.getStatusSnapshotForPane(PANE)[0]
    const identities = vi.fn()
    const mutations = vi.fn()
    const freshness = vi.fn()
    const enriched = vi.fn()
    server.subscribeProviderSessionChanges(identities)
    server.subscribeStatusRowMutations(mutations)
    server.subscribeStatusFreshness(freshness)
    server.subscribeEnrichedStatus(enriched)

    server.noteSessionContinued(OLD, { sessionId: NEW, transcriptPath: `/p/${NEW}.jsonl` })

    expect(identities).toHaveBeenCalledExactlyOnceWith([
      {
        paneKey: PANE,
        sessionId: NEW,
        transcriptPath: `/p/${NEW}.jsonl`,
        worktreeId: 'folder-workspace'
      }
    ])
    expect(mutations).toHaveBeenCalledExactlyOnceWith({
      before: { paneKey: PANE, worktreeId: 'folder-workspace' },
      after: { paneKey: PANE, worktreeId: 'folder-workspace' }
    })
    expect(server.getStatusSnapshotForPane(PANE)[0]).toMatchObject({
      receivedAt: before?.receivedAt,
      stateStartedAt: before?.stateStartedAt,
      connectionId: 'ssh-connection',
      agentType: 'claude',
      state: 'done'
    })
    expect(freshness).not.toHaveBeenCalled()
    expect(enriched).not.toHaveBeenCalled()
    server.noteSessionContinued(OLD, { sessionId: NEW, transcriptPath: `/p/${NEW}.jsonl` })
    expect(identities).toHaveBeenCalledTimes(1)
    expect(mutations).toHaveBeenCalledTimes(1)
  })

  it('moves the pane onto the file its session continued into', () => {
    const server = new AgentHookServer()
    seed(server, PANE, OLD)

    server.noteSessionContinued(OLD, { sessionId: NEW, transcriptPath: `/p/${NEW}.jsonl` })

    expect(sessionOf(server, PANE)).toMatchObject({
      id: NEW,
      transcriptPath: `/p/${NEW}.jsonl`
    })
  })

  // The pane's own key field must survive; consumers read it to tell agents apart.
  it('keeps the rest of the provider session intact', () => {
    const server = new AgentHookServer()
    seed(server, PANE, OLD)

    server.noteSessionContinued(OLD, { sessionId: NEW, transcriptPath: `/p/${NEW}.jsonl` })

    expect(sessionOf(server, PANE)?.key).toBe('session_id')
  })

  it('leaves panes running a different session alone', () => {
    const server = new AgentHookServer()
    seed(server, PANE, OLD)
    seed(server, OTHER_PANE, 'someone-else')

    server.noteSessionContinued(OLD, { sessionId: NEW, transcriptPath: `/p/${NEW}.jsonl` })

    expect(sessionOf(server, OTHER_PANE)?.id).toBe('someone-else')
  })

  it('ignores a move that names the session it already has', () => {
    const server = new AgentHookServer()
    seed(server, PANE, OLD)

    server.noteSessionContinued(OLD, { sessionId: OLD, transcriptPath: '/p/other.jsonl' })

    expect(sessionOf(server, PANE)?.transcriptPath).toBe(`/p/${OLD}.jsonl`)
  })

  it('does nothing for a session no pane is running', () => {
    const server = new AgentHookServer()
    seed(server, PANE, OLD)

    server.noteSessionContinued('unknown-session', {
      sessionId: NEW,
      transcriptPath: `/p/${NEW}.jsonl`
    })

    expect(sessionOf(server, PANE)?.id).toBe(OLD)
  })

  it('ignores a blank id on either side', () => {
    const server = new AgentHookServer()
    seed(server, PANE, OLD)

    server.noteSessionContinued('  ', { sessionId: NEW, transcriptPath: '/p/x.jsonl' })
    server.noteSessionContinued(OLD, { sessionId: '  ', transcriptPath: '/p/x.jsonl' })

    expect(sessionOf(server, PANE)?.id).toBe(OLD)
  })
})
