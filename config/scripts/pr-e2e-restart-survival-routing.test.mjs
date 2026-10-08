import { describe, expect, it } from 'vitest'
import { PR_E2E_SOURCE_ROUTES } from './pr-e2e-source-routing.mjs'

/** The route that sends a change to the two-Electron restart-survival spec. */
const restartSurvivalRoute = PR_E2E_SOURCE_ROUTES.find(
  (route) => route.id === 'client-hosted-browser.restart-survival'
)

describe('restart-survival E2E routing', () => {
  // Every file below carries behavior the restart spec is the only test that exercises end to end.
  it.each([
    'src/main/runtime/manta-runtime.ts',
    'src/main/runtime/manta-runtime-browser.ts',
    'src/main/runtime/client-hosted-page-reconciliation-window.ts',
    'src/main/runtime/runtime-browser-client-page-adoption.ts',
    'src/main/runtime/runtime-browser-client-page-recovery.ts',
    'src/main/runtime/browser-host-client-page-adoption.ts',
    'src/main/runtime/browser-host-page-reconciliation-orchestration.ts',
    'src/main/runtime/rpc/methods/browser-client-host.ts',
    'src/main/browser/browser-client-host-authority-replacement-wait.ts',
    'src/main/browser/paired-runtime-browser-client-host-composition.ts',
    'src/renderer/src/runtime/web-session-tabs-sync.ts',
    'src/renderer/src/runtime/host-session-snapshot-authority.ts',
    'src/renderer/src/runtime/restored-client-hosted-browser-host-attach.ts',
    'src/renderer/src/store/slices/runtime-status.ts',
    'src/shared/runtime-types.ts',
    'src/shared/browser-client-host-protocol.ts'
  ])('routes %s', (path) => {
    expect(restartSurvivalRoute.matches(path)).toBe(true)
  })

  // The pattern is deliberately not "anything under src": routing every PR at a two-Electron spec
  // is the cost the filter exists to avoid.
  it.each([
    'src/main/git/git-status.ts',
    'src/renderer/src/components/tab-bar/BrowserTab.tsx',
    'src/main/terminal/pty-manager.ts',
    // The status/types entries name whole files, not a suffix any longer name may end with.
    'src/shared/computer-use-runtime-types.ts'
  ])('does not route %s', (path) => {
    expect(restartSurvivalRoute.matches(path)).toBe(false)
  })
})
