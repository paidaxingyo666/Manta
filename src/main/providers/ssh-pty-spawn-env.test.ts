import { describe, expect, it } from 'vitest'
import { buildSshPtySpawnEnv } from './ssh-pty-spawn-env'
import type { RemoteCliBridgeEnv } from './ssh-pty-provider-contract'

describe('buildSshPtySpawnEnv relay bridge', () => {
  it('prepends the CLI bin dir once and publishes the Node relay bridge', () => {
    const env = buildSshPtySpawnEnv({
      env: { PATH: '/home/me/.manta-relay/bin:/usr/bin' },
      remoteCliBridgeEnv: {
        binDir: '/home/me/.manta-relay/bin',
        relayDir: '/home/me/.manta-relay/relay-v1',
        nodePath: '/usr/bin/node',
        sockPath: '/home/me/.manta-relay/relay.sock'
      }
    })

    expect(env).toMatchObject({
      PATH: '/home/me/.manta-relay/bin:/usr/bin',
      MANTA_REMOTE_CLI_BIN_DIR: '/home/me/.manta-relay/bin',
      MANTA_RELAY_DIR: '/home/me/.manta-relay/relay-v1',
      MANTA_RELAY_NODE_PATH: '/usr/bin/node',
      MANTA_RELAY_SOCKET_PATH: '/home/me/.manta-relay/relay.sock'
    })
    expect(env).not.toHaveProperty('MANTA_RELAY_CREDENTIAL_FILE')
  })
})

const bridge: RemoteCliBridgeEnv = {
  binDir: '/remote/manta/bin',
  relayDir: '/remote/manta',
  nodePath: '/remote/node',
  sockPath: '/remote/manta/socket'
}

describe('SSH CLI path ownership', () => {
  it('replaces the client restore directory with the remote bridge', () => {
    const env = { PATH: '/usr/bin', ORCA_CLI_BIN_DIR: '/client/manta/bin' }
    const result = buildSshPtySpawnEnv({ env, remoteCliBridgeEnv: bridge })
    expect(result.ORCA_CLI_BIN_DIR).toBe(bridge.binDir)
    expect(result.PATH).toBe(`${bridge.binDir}:/usr/bin`)
    expect(env.ORCA_CLI_BIN_DIR).toBe('/client/manta/bin')
  })

  it('clears a client path when no remote bridge is available', () => {
    const result = buildSshPtySpawnEnv({ env: { ORCA_CLI_BIN_DIR: '/client/manta/bin' } })
    expect(result.ORCA_CLI_BIN_DIR).toBeUndefined()
  })

  it('does not give a POSIX wrapper a Windows bridge directory', () => {
    const result = buildSshPtySpawnEnv({
      env: { Path: 'C:\\Windows', ORCA_CLI_BIN_DIR: '/client/manta/bin' },
      remoteCliBridgeEnv: { ...bridge, binDir: 'C:\\Manta\\bin', pathDelimiter: ';' }
    })
    expect(result.ORCA_CLI_BIN_DIR).toBeUndefined()
    expect(result.Path).toBe('C:\\Manta\\bin;C:\\Windows')
  })

  it('preserves an explicitly deleted restore key', () => {
    const result = buildSshPtySpawnEnv({
      env: { PATH: '/usr/bin' },
      remoteCliBridgeEnv: bridge,
      envToDelete: ['ORCA_CLI_BIN_DIR']
    })
    expect(result.ORCA_CLI_BIN_DIR).toBeUndefined()
  })
})
