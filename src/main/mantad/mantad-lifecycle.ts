import { setRuntimeBrowserCommandsFactory } from '../runtime/runtime-browser-commands-factory'
import { resolveMantadBrowserProvider } from './mantad-browser-provider'
import { acquireMantadInstanceLock } from './mantad-instance-lock'
import { ORCAD_BUNDLED_LAUNCHER_ENV } from './mantad-bundled-runtime'
import { resolveMantadExitCode } from './mantad-exit-code'
import {
  acquireProfileStateRuntimeAdmission,
  type ProfileStateRuntimeAdmission
} from '../persistence/profile-state/profile-state-access'

const bundledLauncherChannel = process.env[ORCAD_BUNDLED_LAUNCHER_ENV] === '1'
delete process.env[ORCAD_BUNDLED_LAUNCHER_ENV]

function createIdempotentOrcadCleanup(cleanup: () => Promise<void>): () => Promise<void> {
  let completion: Promise<void> | null = null
  return () => {
    completion ??= Promise.resolve().then(cleanup)
    return completion
  }
}

export const MANTAD_SHUTDOWN_DEADLINE_MS = 15_000

/** A launcher and its child can both receive the same process-group or service stop signal. */
export function installOrcadShutdownSignals(
  stop: () => Promise<void>,
  deadlineMs = MANTAD_SHUTDOWN_DEADLINE_MS
): void {
  let stopping = false
  const shutdown = (signal: string): void => {
    if (stopping) {
      return
    }
    stopping = true
    setTimeout(() => {
      console.error(`mantad: shutdown after ${signal} exceeded ${deadlineMs}ms — exiting`)
      process.exit(1)
    }, deadlineMs)
    stop()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(`mantad: shutdown after ${signal} failed:`, error)
        process.exit(resolveMantadExitCode(error))
      })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  // Headless runtimes survive terminal hangups; INT/TERM are the graceful stop contract.
  if (process.platform !== 'win32') {
    process.on('SIGHUP', () => {})
  }
  if (bundledLauncherChannel && typeof process.send === 'function') {
    process.once('disconnect', () => shutdown('launcher disconnect'))
    if (!process.connected) {
      shutdown('launcher disconnect')
    }
  }
}

export async function startOrcadWithLifecycle<T extends object>(
  start: (registerRuntimeCleanup: (cleanup: () => Promise<void>) => void) => Promise<T>,
  cleanupHost: (runtimeCleanupSucceeded: boolean) => Promise<void>
): Promise<T & { stop(): Promise<void> }> {
  let cleanupRuntime = async (): Promise<void> => {}
  const cleanup = createIdempotentOrcadCleanup(async () => {
    let runtimeCleanupSucceeded = false
    try {
      await cleanupRuntime()
      runtimeCleanupSucceeded = true
    } finally {
      await cleanupHost(runtimeCleanupSucceeded)
    }
  })
  try {
    const handle = await start((nextCleanup) => {
      cleanupRuntime = nextCleanup
    })
    return { ...handle, stop: cleanup }
  } catch (error) {
    try {
      await cleanup()
    } catch (cleanupError) {
      // Keep the launch failure as the supervisor-facing verdict; cleanup still needs a breadcrumb.
      console.error('[mantad] startup cleanup failed:', cleanupError)
    }
    throw error
  }
}

/** Keep profile admission until every runtime writer has stopped. */
export async function startOrcadWithHost<T extends object>(
  userDataPath: string,
  start: (registerCleanup: (cleanup: () => Promise<void>) => void) => Promise<T>,
  runQuitHandlers: () => void
): Promise<T & { stop(): Promise<void> }> {
  const instanceLock = acquireMantadInstanceLock(userDataPath)
  let admission: ProfileStateRuntimeAdmission | undefined
  let browserProvider: Awaited<ReturnType<typeof resolveMantadBrowserProvider>> | undefined
  return startOrcadWithLifecycle(
    async (registerCleanup) => {
      admission = acquireProfileStateRuntimeAdmission(userDataPath)
      browserProvider = await resolveMantadBrowserProvider({ userDataPath })
      const provider = browserProvider
      setRuntimeBrowserCommandsFactory(provider?.factory ?? null, {
        headless: provider !== null,
        ...(provider ? { isAvailable: () => provider.isAvailable() } : {})
      })
      return start(registerCleanup)
    },
    async (runtimeCleanupSucceeded) => {
      try {
        await browserProvider?.stop()
      } finally {
        setRuntimeBrowserCommandsFactory(null)
        runQuitHandlers()
        try {
          // Failed teardown excludes recovery until the process actually exits.
          if (runtimeCleanupSucceeded) {
            admission?.release()
          }
        } finally {
          instanceLock.release()
        }
      }
    }
  )
}

export async function flushOrcadProfileStoreForShutdown(store: {
  flushFinalOrThrowAsync(): Promise<void>
  freezeWritesAsync(): Promise<void>
}): Promise<void> {
  try {
    await store.flushFinalOrThrowAsync()
  } finally {
    await store.freezeWritesAsync()
  }
}
