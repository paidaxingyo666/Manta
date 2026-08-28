import { describe, expect, it } from 'vitest'
import {
  appendMantaRpcOutput,
  resolveMantaCliCommand,
  resolveMantaCliInvocation
} from './live-remote-freeze-rpc.mjs'

describe('live remote freeze RPC', () => {
  it('resolves the Manta CLI for managed, dev, Linux, and default runtimes', () => {
    expect(resolveMantaCliCommand({ env: { MANTA_CLI_COMMAND: 'custom-manta' } })).toBe('custom-manta')
    expect(resolveMantaCliCommand({ env: { MANTA_DEV_REPO_ROOT: '/repo' } })).toBe('manta-dev')
    expect(resolveMantaCliCommand({ env: {}, platform: 'linux' })).toBe('manta-ide')
    expect(resolveMantaCliCommand({ env: {}, platform: 'win32' })).toBe('manta')
  })

  it('bypasses the Windows dev cmd shim with the built Node CLI', () => {
    const invocation = resolveMantaCliInvocation({
      env: {
        APPDATA: 'C:\\Users\\dev\\AppData\\Roaming',
        MANTA_CLI_COMMAND: 'C:\\repo\\out\\bin\\manta-dev.cmd',
        MANTA_DEV_REPO_ROOT: 'C:\\repo'
      },
      platform: 'win32',
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe'
    })

    expect(invocation).toMatchObject({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      prefixArgs: ['C:\\repo\\out\\cli\\index.js'],
      env: {
        MANTA_USER_DATA_PATH: 'C:\\Users\\dev\\AppData\\Roaming\\manta-dev',
        MANTA_DEV_CLI_INVOCATION: '1',
        MANTA_APP_EXECUTABLE: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
        MANTA_APP_EXECUTABLE_NEEDS_APP_ROOT: '1'
      }
    })
  })

  it('caps combined asynchronous output before retaining the overflow chunk', () => {
    const first = appendMantaRpcOutput('', '1234', 0, 5)
    expect(first).toEqual({ output: '1234', bytes: 4, exceeded: false })

    const overflow = appendMantaRpcOutput(first.output, '67', first.bytes, 5)
    expect(overflow).toEqual({ output: '1234', bytes: 6, exceeded: true })
  })
})
