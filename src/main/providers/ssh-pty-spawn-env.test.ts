import { describe, expect, it } from 'vitest'
import { buildSshPtySpawnEnv } from './ssh-pty-spawn-env'

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
