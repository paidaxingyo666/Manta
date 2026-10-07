// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { sayAgentSessionFailureEnglish } from '../../../../shared/agent-session-failure-copy'
import { agentSessionFailureSentence } from '../../../../shared/agent-session-failure-words'
import { agentSessionRefusalFailure } from '../../../../shared/agent-session-write-failure'
import { NativeChatLaunchRetry } from './NativeChatLaunchRetry'

afterEach(cleanup)

it('names the Command setting when it is not a program Manta can run', () => {
  const failure = agentSessionRefusalFailure({
    code: 'agent_session_operation_invalid',
    details: { reason: 'agentCommandNotRunnable' }
  })
  render(
    <NativeChatLaunchRetry
      lifecycle="failed"
      failure={failure}
      agentLabel="Claude"
      onRetry={() => {}}
    />
  )
  expect(
    screen.getByText(
      "Chat could not be started. Claude's Command in Settings → Agents must be a program path or name Manta can find, with no arguments or variables. Change it or reset it."
    )
  ).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
})

it('reads naturally where no agent name is known', () => {
  expect(
    agentSessionFailureSentence(
      { kind: 'agentCommandNotRunnable' },
      'row',
      {},
      sayAgentSessionFailureEnglish
    )
  ).toBe(
    "The agent's Command in Settings → Agents must be a program path or name Manta can find, with no arguments or variables. Change it or reset it."
  )
})
