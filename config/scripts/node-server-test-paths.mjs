/** Mirrors ORCA_REQUIRED_TEST_INPUTS_ENV in src/main/mantad/mantad-node-slot-fixture.ts. */
export const REQUIRED_TEST_INPUTS_ENV = 'ORCA_REQUIRED_TEST_INPUTS'

// Need Bun 1.4.2 and the last Bun mantad slot beside the built Node slot (design D7).
export const CROSS_RUNTIME_TEST_PATHS = [
  'src/main/mantad/mantad-cross-runtime-daemon-adoption.integration.test.ts',
  'src/main/persistence/profile-state/profile-state-cross-runtime.integration.test.ts'
]

export function nodeServerTestPaths({ artifact = false, crossRuntime = false } = {}) {
  return [
    'src/main/persistence/profile-state',
    'src/main/persistence/loading-store/profile-state',
    'src/main/sqlite',
    'src/main/mantad/mantad-entry.test.ts',
    'src/main/mantad/mantad-push-startup.test.ts',
    // The mantad server's identity and stop path, which Windows SSH hosts rely on (W2).
    'src/main/mantad/mantad-instance-lock.test.ts',
    'src/main/mantad/mantad-process-start-time.test.ts',
    'src/main/mantad/mantad-stop-request-listener.test.ts',
    'src/main/mantad/mantad-managed-stop.test.ts',
    'src/main/mantad/mantad-managed-stop-cancellation.test.ts',
    // The directory, not a prefix: its siblings are POSIX-host unit tests pr.yml already runs.
    'src/main/daemon/pty-subprocess/',
    'src/main/daemon/pty-subprocess-spawn-file-foreground.test.ts',
    'src/main/daemon/pty-subprocess-io-failure-native.test.ts',
    ...(artifact
      ? [
          'tests/e2e/daemon-running-work-probe.unit.test.ts',
          'src/shared/pty-running-work-probe.test.ts',
          'src/main/mantad/mantad-packaged-node-pty.integration.test.ts',
          'src/main/providers/agent-foreground-process-git-bash.win32.test.ts',
          'src/main/mantad/mantad-node-launcher.integration.test.ts',
          'src/main/mantad/mantad-stop-request-shutdown.integration.test.ts',
          'src/main/mantad/mantad-windows-conpty-breakaway.integration.test.ts',
          'src/main/mantad/mantad-serve-parity.integration.test.ts',
          'config/scripts/zip-extractor-command.test.mjs'
        ]
      : []),
    ...(crossRuntime ? CROSS_RUNTIME_TEST_PATHS : [])
  ]
}
