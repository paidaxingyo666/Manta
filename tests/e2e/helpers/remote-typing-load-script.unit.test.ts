import '../../../src/main/daemon/xterm-env-polyfill'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { Terminal } from '@xterm/headless'
import { expect, it } from 'vitest'
import { remoteTypingLoadScript } from './remote-typing-load-script'

it.each([12, 24, 40])(
  'keeps typed output visible through background pressure at %i rows',
  async (rows) => {
    const terminal = new Terminal({ rows, cols: 80, scrollback: 1000, allowProposedApi: true })
    const input = new EventEmitter()
    const chunks: string[] = []
    let background = (): void => {
      throw new Error('Background pressure did not start')
    }
    try {
      runInNewContext(remoteTypingLoadScript('test'), {
        process: {
          stdin: {
            isTTY: true,
            setEncoding() {},
            setRawMode() {},
            resume() {},
            on: input.on.bind(input)
          },
          stdout: { rows, write: (chunk: string) => chunks.push(chunk) },
          exit() {}
        },
        setTimeout: (callback: () => void) => callback(),
        setInterval: (callback: () => void) => {
          background = callback
          return 1
        },
        clearInterval() {}
      })
      input.emit('data', 'ab\r\ncd')
      for (let frame = 0; frame < 40; frame += 1) {
        background()
      }
      const output = chunks.join('')
      expect(output.length).toBeGreaterThan(160_000)
      await new Promise<void>((resolve) => terminal.write(output, resolve))
      const screen = Array.from(
        { length: rows },
        (_, row) =>
          terminal.buffer.active
            .getLine(terminal.buffer.active.baseY + row)
            ?.translateToString(true) ?? ''
      ).join('\n')
      expect(screen).toContain('REMOTE_KEY_test_4_d')
    } finally {
      terminal.dispose()
    }
  }
)
