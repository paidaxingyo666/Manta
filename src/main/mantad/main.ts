/** Executable entry for `mantad`. See `./mantad-entry.ts`. */
import process from 'node:process'
import { main, resolveMantadExitCode } from './mantad-entry'
import { runMantadNativePreflight } from './mantad-native-preflight'
import {
  ORCAD_PROFILE_PREFLIGHT_FLAG,
  ORCAD_STARTUP_PREFLIGHT_FLAG
} from '../../shared/mantad-profile-preflight'
import { preflightBundledOrcadStartup, runOrcadProfilePreflight } from './mantad-profile-preflight'
import { handoffToBundledOrcad } from './mantad-bundled-runtime'
import {
  ORCAD_CANCEL_MANAGED_STOP_FLAG,
  ORCAD_COMPLETE_MANAGED_STOP_FLAG
} from '../../shared/orcad-stop-request'

// Why exit before the preflight: reaching this line means the whole module graph resolved
// under plain Node, which is all the build guard needs to prove. Probing natives or
// starting a server to prove it would bind a port and take a data-root lock on a build
// machine.
if (process.argv.includes('--mantad-smoke-load-check')) {
  process.exit(0)
}

// Why here and not inside startMantad: this must run before anything requires node-pty,
// and `mantad-entry` reaches it through `await import('../ipc/pty')`. Static imports are
// evaluated before this statement, so the guarantee is that no module in the graph
// requires node-pty at import time — which the bundle's lazy `require("node-pty")` in
// local-pty-provider satisfies. See ./node-pty-precondition.ts for why a child process.
function failStartup(error: unknown): void {
  console.error('mantad: failed to start:', error)
  // Why a resolved code and not a bare 1: a data-root or bind-address refusal is a
  // configuration fault that restarting cannot fix, and a supervisor needs to tell the two
  // apart to avoid restart-spinning on it.
  process.exit(resolveMantadExitCode(error))
}

// Why before the bundled handoff and preflights: completing a stop must not start a runtime.
if (
  process.argv[2] === ORCAD_COMPLETE_MANAGED_STOP_FLAG ||
  process.argv[2] === ORCAD_CANCEL_MANAGED_STOP_FLAG
) {
  void import('./orcad-managed-stop-command').then(({ runOrcadManagedStopCommandAndExit }) =>
    runOrcadManagedStopCommandAndExit(process.argv.slice(2))
  )
} else {
  startOrcadProcess()
}

function startOrcadProcess(): void {
  try {
    if (!handoffToBundledOrcad()) {
      const flag = process.argv[2]
      if (
        (flag === ORCAD_PROFILE_PREFLIGHT_FLAG || flag === ORCAD_STARTUP_PREFLIGHT_FLAG) &&
        process.argv.length === 4
      ) {
        void runOrcadProfilePreflight(process.argv[3], {
          nativeFeatures: flag === ORCAD_PROFILE_PREFLIGHT_FLAG
        })
          // Why exit: the owner reads to EOF, so a lingering native handle must not hold the probe open.
          .then(() => process.stdout.write('', () => process.exit(0)))
          .catch(failStartup)
      } else {
        void preflightBundledOrcadStartup()
          .then(() => {
            runMantadNativePreflight()
            return main()
          })
          .catch(failStartup)
      }
    }
  } catch (error) {
    failStartup(error)
  }
}
