/**
 * The identity fence refused the child's agentType but let its session through.
 *
 * A subagent inherits MANTA_PANE_KEY from the terminal that spawned it, so its
 * hook posts under the parent's pane. resolveAgentStatusIdentity already refuses
 * to let that rewrite the pane's visible agent — but providerSession rides the
 * envelope, not the payload, so it reached lastStatusByPaneKey untouched and
 * repointed the pane's chat at the child's own transcript. Observed live: a
 * codex review helper moved a Claude pane onto rollout-…jsonl.
 *
 * Carried forward, never blanked: blanking would disarm the fence for the next
 * post and strand the pane for noteSessionContinued, which finds panes by their
 * current session id.
 */
import { describe, expect, it } from 'vitest'
import { makePaneKey } from '../../shared/stable-pane-id'
import { AgentHookServer } from './server'

const PANE = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')
const CONNECTION = 'conn-1'
const CLAUDE_SESSION = {
  key: 'session_id',
  id: 'claude-session',
  transcriptPath: '/p/claude.jsonl'
}
const CODEX_SESSION = {
  key: 'session_id',
  id: 'codex-session',
  transcriptPath: '/p/rollout-codex.jsonl'
}

function post(
  server: AgentHookServer,
  source: 'claude' | 'codex',
  state: 'working' | 'done',
  providerSession: unknown
): void {
  server.ingestRemote(
    {
      paneKey: PANE,
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      source,
      hookEventName: state === 'done' ? 'Stop' : 'UserPromptSubmit',
      providerSession,
      payload: { state, agentType: source }
    },
    CONNECTION
  )
}

function paneSession(server: AgentHookServer): Record<string, unknown> | undefined {
  const state = (
    server as unknown as {
      state: { lastStatusByPaneKey: Map<string, { providerSession?: Record<string, unknown> }> }
    }
  ).state
  return state.lastStatusByPaneKey.get(PANE)?.providerSession
}

function paneAgent(server: AgentHookServer): unknown {
  const state = (
    server as unknown as {
      state: { lastStatusByPaneKey: Map<string, { payload?: { agentType?: unknown } }> }
    }
  ).state
  return state.lastStatusByPaneKey.get(PANE)?.payload?.agentType
}

describe('a fenced post cannot take the pane’s session', () => {
  it('keeps the pane’s own session when the fence refuses a child agent', () => {
    const server = new AgentHookServer()
    post(server, 'claude', 'working', CLAUDE_SESSION)

    post(server, 'codex', 'working', CODEX_SESSION)

    expect(paneAgent(server)).toBe('claude')
    expect(paneSession(server)).toMatchObject({ id: 'claude-session' })
  })

  /**
   * The load-bearing half. Blanking instead of carrying forward would leave the
   * next codex post with no incumbent session to be refused against, and would
   * cost the pane its only handle for a later transcript rebind.
   */
  it('still holds on the child’s second post', () => {
    const server = new AgentHookServer()
    post(server, 'claude', 'working', CLAUDE_SESSION)
    post(server, 'codex', 'working', CODEX_SESSION)

    post(server, 'codex', 'working', CODEX_SESSION)

    expect(paneSession(server)).toMatchObject({ id: 'claude-session' })
  })

  it('lets the pane’s own agent keep updating its session', () => {
    const server = new AgentHookServer()
    post(server, 'claude', 'working', CLAUDE_SESSION)

    const rolled = { ...CLAUDE_SESSION, id: 'claude-rolled', transcriptPath: '/p/rolled.jsonl' }
    post(server, 'claude', 'working', rolled)

    expect(paneSession(server)).toMatchObject({ id: 'claude-rolled' })
  })

  // Nothing to carry forward is not the same as something to erase.
  it('leaves a session-less pane session-less', () => {
    const server = new AgentHookServer()
    post(server, 'claude', 'working', undefined)

    post(server, 'codex', 'working', CODEX_SESSION)

    expect(paneAgent(server)).toBe('claude')
    expect(paneSession(server)).toBeUndefined()
  })
})
