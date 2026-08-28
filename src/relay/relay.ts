#!/usr/bin/env node

// Manta Relay — remote-host daemon and reconnect bridge entry point.

import { parseRelayLaunchOptions, readRelayEndpointCredential } from './relay-launch-options'
import { runRelayConnectChannel } from './relay-connect-channel'
import { runRelayMantaCliChannel } from './relay-manta-cli-channel'
import { runRelayDaemon } from './relay-daemon'
import { relayLogLine } from './relay-diagnostic-log'

async function main(): Promise<void> {
  const options = parseRelayLaunchOptions(process.argv)
  const endpointCredential = readRelayEndpointCredential(options.credentialFile)
  if (options.connectMode) {
    runRelayConnectChannel(options.sockPath, endpointCredential)
    return
  }
  if (options.cliMode) {
    const marker = process.argv.indexOf('--manta-cli')
    await runRelayMantaCliChannel(
      options.sockPath,
      marker === -1 ? [] : process.argv.slice(marker + 1),
      endpointCredential
    )
    return
  }
  await runRelayDaemon(options, endpointCredential)
}

void main().catch((error) => {
  relayLogLine(
    `[relay] Fatal startup error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
  )
  process.exit(1)
})
