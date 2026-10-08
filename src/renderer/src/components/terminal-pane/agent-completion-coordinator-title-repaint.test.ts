import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { detectAgentStatusFromTitle } from '../../../../shared/agent-detection'
import {
  createAgentCompletionCoordinator,
  resetAgentCompletionCoordinatorIdentitiesForTest
} from './agent-completion-coordinator'
import { resetAgentProcessInspectionQueueForTests } from './agent-process-inspection-queue'
import {
  isTitleCompletionRepaint,
  recordSettledAgentCompletion,
  resetSettledAgentCompletionsForTest
} from './pty-connection/title-repaint-completion'
import reconnectTrace from './__fixtures__/codex-app-server-reconnect-titles-trace.json'

const PANE = 'tab-1:leaf-1'
const IDLE = reconnectTrace.idleTitle
const SPINNING = `⠋ ${IDLE}`

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-29T02:30:00Z'))
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  resetSettledAgentCompletionsForTest()
})

afterEach(() => {
  resetAgentProcessInspectionQueueForTests()
  resetAgentCompletionCoordinatorIdentitiesForTest()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function setup(options: { repaintCheck?: boolean; hookLaneGated?: boolean } = {}) {
  const foreground: { process: string | null } = { process: 'codex' }
  const store: { row: AgentStatusEntry | undefined; lastInputAt: number | undefined } = {
    row: undefined,
    lastInputAt: undefined
  }
  const announced: string[] = []
  // Mirrors terminal-keydown-fit.ts and agent-hook-completion-notifications.ts over a simulated store.
  const pty = createAgentCompletionCoordinator({
    paneKey: PANE,
    statusLane: 'pty',
    getPtyId: () => 'pty-1',
    getSettings: () => null,
    inspectProcess: vi.fn(async () => ({
      foregroundProcess: foreground.process,
      hasChildProcesses: foreground.process !== null
    })),
    ...(options.repaintCheck === false
      ? {}
      : {
          shouldAnnounceTitleCompletion: ({ foregroundAgent }) =>
            !isTitleCompletionRepaint({
              paneKey: PANE,
              currentRow: store.row,
              foregroundAgent,
              lastUserInputAt: store.lastInputAt
            })
        }),
    dispatchCompletion: (title, meta) => {
      recordSettledAgentCompletion(PANE, meta?.agentStatus ?? store.row)
      announced.push(`pty:${title}`)
    },
    isLive: () => true
  })
  const hook = createAgentCompletionCoordinator({
    paneKey: PANE,
    statusLane: 'hook',
    getPtyId: () => 'pty-1',
    getSettings: () => null,
    inspectProcess: vi.fn(async () => ({ foregroundProcess: null, hasChildProcesses: false })),
    dispatchCompletion: (title, meta) => {
      // A pane that must see live working first (paneKeysRequiringFreshWorking) announces nothing.
      if (options.hookLaneGated) {
        return
      }
      announced.push(`hook:${title}`)
      const doneRow = store.row?.state === 'done' ? store.row : undefined
      recordSettledAgentCompletion(PANE, meta?.agentStatus ?? doneRow)
    },
    isLive: () => true
  })

  function setRow(state: 'working' | 'done', lane: 'hook' | 'pty' = 'hook'): void {
    store.row = {
      state,
      prompt: 'update and run the demo build',
      updatedAt: Date.now(),
      stateStartedAt: Date.now(),
      agentType: 'codex',
      paneKey: PANE,
      stateHistory: []
    }
    const payload = {
      state,
      prompt: store.row.prompt,
      agentType: 'codex',
      stateStartedAt: Date.now()
    }
    if (lane === 'pty') {
      // Remote runtime rows reach the pty lane's own coordinator.
      pty.observeHookStatus(payload)
      return
    }
    hook.observeHookStatus(payload)
  }

  // title-spawn-bell.ts: working titles always reach the lane; a fresh working row holds back the rest.
  function paintTitle(title: string): void {
    const working = detectAgentStatusFromTitle(title) === 'working'
    if (!working && store.row?.state === 'working') {
      return
    }
    pty.observeTitle(title)
    if (working) {
      // Main's tracker reports the same working frame as an agent-working fact.
      pty.observeTitleWorking()
    }
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(500)
    }
  }

  async function replay(titles: readonly string[]): Promise<void> {
    for (const title of titles) {
      paintTitle(title)
      await vi.advanceTimersByTimeAsync(80)
    }
    await settle()
  }

  // The turn that really happened: the hook lane announces it, the one legitimate notification.
  // Its idle title lands while the row is still working, so the pty lane never sees the turn end.
  async function finishTurn(): Promise<void> {
    paintTitle(SPINNING)
    setRow('working')
    await vi.advanceTimersByTimeAsync(30_000)
    paintTitle(IDLE)
    setRow('done')
    await settle()
  }

  return { foreground, store, announced, pty, setRow, paintTitle, settle, replay, finishTurn }
}

describe('title completion repaint', () => {
  it('replays every recorded app-server reconnect without announcing, and stays silent on exit', async () => {
    const { foreground, announced, pty, replay, settle, finishTurn } = setup()
    pty.startProcessTracking()
    await finishTurn()
    const afterTurn = [...announced]

    for (const reconnect of reconnectTrace.reconnects) {
      await vi.advanceTimersByTimeAsync(6 * 3_600_000)
      await replay(reconnect)
    }
    foreground.process = null
    await settle()

    expect(afterTurn).toEqual(['hook:codex'])
    expect(announced).toEqual(afterTurn)
  })

  it('announces each recorded reconnect run without the repaint check', async () => {
    const { announced, pty, replay, finishTurn } = setup({ repaintCheck: false })
    pty.startProcessTracking()
    await finishTurn()
    announced.length = 0

    await vi.advanceTimersByTimeAsync(6 * 3_600_000)
    await replay(reconnectTrace.reconnects[1])

    expect(announced.length).toBeGreaterThan(0)
    expect(announced.every((entry) => entry === `pty:${IDLE}` || entry === 'pty:demo-repo')).toBe(
      true
    )
  })

  it('stays silent when a reconnect paints only its opening titles after a held-back turn end', async () => {
    const { announced, pty, replay, finishTurn } = setup()
    pty.startProcessTracking()
    await finishTurn()
    announced.length = 0

    await vi.advanceTimersByTimeAsync(6 * 3_600_000)
    await replay(reconnectTrace.reconnects[2].slice(0, 2))

    expect(announced).toEqual([])
  })

  it('announces a genuine turn exactly once, even when the idle title follows the done row', async () => {
    const { announced, pty, setRow, paintTitle, settle, finishTurn } = setup()
    pty.startProcessTracking()
    await finishTurn()
    announced.length = 0

    await vi.advanceTimersByTimeAsync(3_600_000)
    paintTitle(SPINNING)
    setRow('working')
    await vi.advanceTimersByTimeAsync(20_000)
    setRow('done')
    paintTitle('Codex ready')
    await settle()

    expect(announced).toHaveLength(1)
  })

  it('announces a run the user typed into even when no hook reported it', async () => {
    const { announced, pty, store, replay, finishTurn } = setup()
    pty.startProcessTracking()
    await finishTurn()
    announced.length = 0

    await vi.advanceTimersByTimeAsync(3_600_000)
    store.lastInputAt = Date.now()
    await replay([SPINNING, SPINNING, IDLE])

    expect(announced).toEqual([`pty:${IDLE}`])
  })

  it('announces an agent that has no status row', async () => {
    const { announced, pty, replay } = setup()
    pty.startProcessTracking()

    await replay([SPINNING, SPINNING, IDLE])

    expect(announced).toEqual([`pty:${IDLE}`])
  })

  it('still announces a late done that reaches the same lane after a settled repaint', async () => {
    const { announced, pty, setRow, replay, settle } = setup()
    pty.startProcessTracking()
    setRow('done', 'pty')
    await settle()
    announced.length = 0

    await vi.advanceTimersByTimeAsync(3_600_000)
    await replay([SPINNING, SPINNING, IDLE])
    const afterRepaint = [...announced]
    setRow('done', 'pty')
    await settle()

    expect(afterRepaint).toEqual([])
    expect(announced).toHaveLength(1)
  })

  it('treats a done row replayed at startup as settled until the user types', async () => {
    const { announced, pty, store, replay } = setup()
    store.row = {
      state: 'done',
      prompt: 'p',
      updatedAt: Date.now() - 3_600_000,
      stateStartedAt: Date.now() - 3_600_000,
      agentType: 'codex',
      paneKey: PANE,
      stateHistory: []
    }
    // agent-status-event-applicator.ts settles a replayed done row.
    recordSettledAgentCompletion(PANE, store.row)
    pty.startProcessTracking()

    await replay(reconnectTrace.reconnects[0])
    const silent = [...announced]
    store.lastInputAt = Date.now()
    await replay([SPINNING, IDLE])

    expect(silent).toEqual([])
    expect(announced).toEqual([`pty:${IDLE}`])
  })

  it('announces through the pty lane when the hook lane held its done back', async () => {
    const { announced, pty, setRow, paintTitle, settle } = setup({ hookLaneGated: true })
    pty.startProcessTracking()

    paintTitle(SPINNING)
    setRow('working')
    await vi.advanceTimersByTimeAsync(20_000)
    setRow('done')
    paintTitle(IDLE)
    await settle()

    expect(announced).toEqual([`pty:${IDLE}`])
  })
})
