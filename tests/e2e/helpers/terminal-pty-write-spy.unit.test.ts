import { afterEach, expect, it, vi } from 'vitest'
import { setTerminalPtyWriteDelay } from './terminal-pty-write-spy'

afterEach(() => vi.unstubAllGlobals())

it('sets and clears paste backpressure using the main-process evaluate argument', async () => {
  vi.stubGlobal('__terminalPtyWriteDelayMs', 0)
  const evaluate = vi.fn()
  evaluate.mockImplementation(
    (callback: (electron: object, argument: number) => void, delay: number) => callback({}, delay)
  )
  const app = { evaluate }

  await setTerminalPtyWriteDelay(app, 35)
  expect(Reflect.get(globalThis, '__terminalPtyWriteDelayMs')).toBe(35)
  await setTerminalPtyWriteDelay(app, 0)
  expect(Reflect.get(globalThis, '__terminalPtyWriteDelayMs')).toBe(0)
})
