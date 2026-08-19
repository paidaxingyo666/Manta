/** Process entry point: load configuration, start the relay, wire signals. */
import { loadConfig } from './config.js'
import { createRelay } from './relay.js'
import { Logger } from './shared/log.js'

/**
 * A configuration mistake is the most likely reason this process ever fails to
 * start, and the person reading the output is looking at journalctl. They need
 * the sentence, not a V8 stack trace into config.js.
 */
function fatalConfig(error: Error): never {
  process.stderr.write(`manta-relay: ${error.message}\n`)
  // EX_CONFIG, so a supervisor can tell "misconfigured" from "crashed".
  process.exit(78)
}

const config = (() => {
  try {
    return loadConfig()
  } catch (error) {
    return fatalConfig(error as Error)
  }
})()
const logger = new Logger(config.logLevel)
const relay = createRelay(config, logger)

await relay.listen()
logger.info('relay.listening', {
  host: config.host,
  port: config.port,
  publicUrl: config.publicUrl,
  dataDir: config.dataDir,
  trustedProxies: config.trustedProxies || '(none)',
  metrics: config.metricsToken ? 'enabled' : 'disabled'
})

// Misconfigurations that only show up as a silent pairing failure much later
// are worth a loud line at startup.
if (!config.publicUrl.startsWith('https://')) {
  logger.warn('relay.insecure_origin', {
    detail:
      'public origin is not https — phones force wss:// and will refuse to connect. ' +
      'Terminate TLS in front of this process.'
  })
}
if (config.ephemeralSecret) {
  logger.warn('relay.ephemeral_secret', {
    detail:
      'MANTA_RELAY_TOKEN_SECRET is unset; an ephemeral one was generated. ' +
      'Every restart signs the desktop out. Set it to a persistent value.'
  })
}
if (!config.dataDir) {
  logger.warn('relay.no_data_dir', {
    detail:
      'MANTA_RELAY_DATA_DIR is unset; credentials live in memory only and every phone ' +
      'must re-pair after a restart.'
  })
}
if (config.publicUrl.startsWith('https://') && !config.trustedProxies) {
  logger.warn('relay.no_trusted_proxies', {
    detail:
      'MANTA_RELAY_TRUSTED_PROXIES is unset behind an https origin. If a reverse proxy ' +
      'terminates TLS, every client shares one rate-limit bucket.'
  })
}

let exiting = false
async function stop(signal: string, code: number): Promise<void> {
  if (exiting) {
    // A second signal means the operator is done waiting for the grace window.
    process.exit(code)
  }
  exiting = true
  await relay.shutdown(signal)
  process.exit(code)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void stop(signal, 0))
}

// A crash in a callback must not leave a half-dead process behind a health
// check that still answers 200.
process.on('uncaughtException', (error) => {
  logger.error('process.uncaught_exception', { error })
  void stop('uncaughtException', 1)
})
process.on('unhandledRejection', (reason) => {
  logger.error('process.unhandled_rejection', { error: reason as Error })
})
