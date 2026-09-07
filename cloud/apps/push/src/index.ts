import { loadPushConfig } from './config.js'
import { openPushDatabase } from './push-database.js'
import { createPushServer } from './push-server.js'

const CHALLENGE_PRUNE_INTERVAL_MS = 60_000
const SESSION_PRUNE_INTERVAL_MS = 10 * 60_000
const SEND_LOG_PRUNE_INTERVAL_MS = 30 * 60_000
const STALE_HOST_PRUNE_INTERVAL_MS = 30 * 60_000

const config = loadPushConfig()
const database = await openPushDatabase({
  ...(config.databaseUrl === undefined ? {} : { databaseUrl: config.databaseUrl }),
  dataDir: config.dataDir,
  poolMax: config.databasePoolMax,
  applicationName: 'orca-push'
})
const {
  server,
  challenges,
  sessions,
  quota,
  coalescer,
  observability,
  closeTransports,
  requestDrain
} = createPushServer(config, database)

function prune(label: string, run: () => Promise<number>, intervalMs: number): NodeJS.Timeout {
  const timer = setInterval(() => {
    void run().catch((error: unknown) => {
      console.warn(
        JSON.stringify({
          event: 'orca_push_prune_failed',
          target: label,
          error: error instanceof Error ? error.name : 'unknown'
        })
      )
    })
  }, intervalMs)
  timer.unref()
  return timer
}

const timers = [
  prune('challenges', () => challenges.pruneExpired(), CHALLENGE_PRUNE_INTERVAL_MS),
  prune('sessions', () => sessions.pruneExpired(), SESSION_PRUNE_INTERVAL_MS),
  prune('send_log', () => quota.prune(), SEND_LOG_PRUNE_INTERVAL_MS),
  prune('stale_hosts', () => challenges.pruneStaleHosts(), STALE_HOST_PRUNE_INTERVAL_MS)
]
observability.start()

server.listen(config.port, () => {
  console.log(`[orca-push] listening on ${config.publicUrl} (port ${config.port})`)
})

let stopping = false
const shutdown = (): void => {
  if (stopping) return
  stopping = true
  for (const timer of timers) clearInterval(timer)
  // Cloud Run sends SIGKILL after ten seconds; leave time for explicit cleanup.
  const deadline = setTimeout(() => process.exit(1), 9_000)
  deadline.unref()
  const requests = requestDrain.begin()
  const connections = new Promise<void>((resolve) => server.close(() => resolve()))
  void Promise.all([requests, connections])
    .then(async () => {
      await coalescer.flushAll()
      coalescer.stop()
      closeTransports()
      await database.close()
      observability.stop()
      clearTimeout(deadline)
    })
    .catch(() => {
      console.warn(JSON.stringify({ event: 'orca_push_shutdown_failed' }))
      process.exitCode = 1
    })
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
