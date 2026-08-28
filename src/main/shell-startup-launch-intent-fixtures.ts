/**
 * The two launch intents Manta's call sites choose between, resolved through the
 * real selector so tests cannot drift from the decision production makes.
 *
 * Test support only; nothing under src/main imports this at runtime.
 */
import { selectShellStartupFeatures } from './shell-startup-features'

/** A pane Manta will write a startup command into. */
export const STARTUP_COMMAND_FEATURES = selectShellStartupFeatures({
  shellPath: 'zsh',
  env: {},
  hasStartupCommand: true,
  waitsForShellReady: true,
  emitsStartupIdentity: true
})

/** A pane carrying a Manta overlay but no startup command. */
export const OVERLAY_ONLY_FEATURES = selectShellStartupFeatures({
  shellPath: 'zsh',
  env: { MANTA_CODEX_HOME: '/tmp/manta-codex-home' },
  hasStartupCommand: false,
  waitsForShellReady: false,
  emitsStartupIdentity: false
})
