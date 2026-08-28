import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()
const originalCliCommand = process.env.MANTA_CLI_COMMAND
const originalPackagedLauncher = process.env.MANTA_WINDOWS_PACKAGED_CLI_LAUNCHER
const originalTerminalHandle = process.env.MANTA_TERMINAL_HANDLE
const originalExitCode = process.exitCode

vi.mock('../format', () => ({ printResult: vi.fn() }))
vi.mock('../selectors', () => ({ getTerminalHandle: vi.fn() }))

import { ORCHESTRATION_HANDLERS } from './orchestration'

describe('packaged Windows legacy ask protocol', () => {
  beforeEach(() => {
    callMock.mockReset()
    process.env.MANTA_WINDOWS_PACKAGED_CLI_LAUNCHER = '1'
    process.env.MANTA_TERMINAL_HANDLE = 'term_worker'
    process.exitCode = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = originalExitCode
    restoreEnv('MANTA_CLI_COMMAND', originalCliCommand)
    restoreEnv('MANTA_WINDOWS_PACKAGED_CLI_LAUNCHER', originalPackagedLauncher)
    restoreEnv('MANTA_TERMINAL_HANDLE', originalTerminalHandle)
  })

  it.each(['manta', 'manta-ide'] as const)(
    'commits with the %s launcher and exits 75 before resume',
    async (command) => {
      process.env.MANTA_CLI_COMMAND = command
      callMock.mockResolvedValue({
        result: {
          answer: null,
          messageId: 'msg_question',
          threadId: 'msg_question',
          timedOut: false,
          legacyCompatibility: {
            resumeRequired: true,
            resumeCommand: `${command} orchestration ask --resume msg_question`
          }
        }
      })
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})

      await invokeAsk(new Map([['question', 'Proceed?']]))

      expect(callMock).toHaveBeenCalledWith(
        'orchestration.ask',
        expect.objectContaining({
          question: 'Proceed?',
          resume: undefined,
          compatibilityWindowsCommand: command
        }),
        expect.any(Object)
      )
      expect(log.mock.calls.map(([line]) => line)).toEqual([
        'Question msg_question committed.',
        `Resume with: ${command} orchestration ask --resume msg_question`
      ])
      expect(process.exitCode).toBe(75)
    }
  )

  it('resumes the committed question without another exit-75 handoff', async () => {
    process.env.MANTA_CLI_COMMAND = 'manta'
    callMock.mockResolvedValue({
      result: {
        answer: 'yes',
        messageId: 'msg_question',
        threadId: 'msg_question',
        timedOut: false
      }
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await invokeAsk(new Map([['resume', 'msg_question']]))

    expect(callMock).toHaveBeenCalledWith(
      'orchestration.ask',
      expect.objectContaining({
        question: undefined,
        resume: 'msg_question',
        compatibilityWindowsCommand: 'manta'
      }),
      expect.any(Object)
    )
    expect(log).toHaveBeenCalledWith('yes')
    expect(process.exitCode).toBeUndefined()
  })
})

function invokeAsk(flags: Map<string, string | boolean>): Promise<void> {
  return ORCHESTRATION_HANDLERS['orchestration ask']({
    flags,
    client: { call: callMock },
    cwd: '/tmp/repo',
    json: false
  } as never)
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
