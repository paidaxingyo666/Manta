import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAIN_RELEASE_REPO } from '../shared/release-channel'
import { loadUpdaterModule, warmUpdaterModule } from './updater-test-module-loader'

/**
 * A manual check on a version with nothing newer reported that the update server
 * could not be reached.
 *
 * Two faults compounded. The preflight fell through to `releases/latest/download`.
 * That URL resolves to the newest STABLE release and skips prereleases, so on a
 * channel that has only ever published prereleases it 404s: a successful
 * "nothing newer" arrived as a transport error. And the message that would have
 * explained it required releaseChannel === 'default', so prerelease users saw
 * the network text.
 *
 * The no-newer branch still runs a real check — it pins this build's own release,
 * which exists — so the rest of the flow keeps the behavior upstream's tests
 * assume.
 */

const {
  appMock,
  autoUpdaterMock,
  fetchNewerReleaseTagsMock,
  moduleFactories,
  resetUpdaterMocks
} = await vi.hoisted(async () => (await import('./updater-test-harness')).createUpdaterMocks())

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('@electron-toolkit/utils', () => moduleFactories.electronToolkitUtils())
vi.mock('./ipc/pty', () => moduleFactories.ipcPty())
vi.mock('./linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./updater-nudge', () => moduleFactories.updaterNudge())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('./local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('./local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())

const ownReleaseFeedUrl = (version: string): string =>
  `https://github.com/${MAIN_RELEASE_REPO}/releases/download/v${version}`
const MOVING_LATEST_FEED_URL = `https://github.com/${MAIN_RELEASE_REPO}/releases/latest/download`
const TRANSPORT_MESSAGE = "Couldn't reach the update server. Try again in a few minutes."
const RELEASE_NOT_READY_MESSAGE =
  "A newer release isn't available for this device yet. Check again later."

warmUpdaterModule()

describe('preflight when nothing is newer', () => {
  beforeEach(() => {
    resetUpdaterMocks()
  })

  // The version is a prerelease and the check is the plain menu one, so this is
  // the default variant on the prerelease channel — not the perf variant, which
  // has its own no-newer branch that also ends in not-available.
  it('pins this build own release and answers up to date, never the moving latest feed', async () => {
    const version = '1.3.19-rc.6'
    appMock.getVersion.mockReturnValue(version)
    fetchNewerReleaseTagsMock.mockResolvedValue({ tags: [], state: 'no-newer' })
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => autoUpdaterMock.emit('update-not-available'))
      return Promise.resolve(undefined)
    })
    const sendMock = vi.fn()
    const mainWindow = { webContents: { send: sendMock } }

    const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()

    setupAutoUpdater(mainWindow as never, { getLastUpdateCheckAt: () => Date.now() })
    // Setup pins the moving feed once; only the check's own pinning is under test.
    const feedCallsBeforeCheck = autoUpdaterMock.setFeedURL.mock.calls.length
    checkForUpdatesFromMenu()

    await vi.waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('updater:status', {
        state: 'not-available',
        userInitiated: true
      })
    })
    expect(autoUpdaterMock.setFeedURL.mock.calls.slice(feedCallsBeforeCheck)).toEqual([
      [{ provider: 'generic', url: ownReleaseFeedUrl(version) }]
    ])
    expect(autoUpdaterMock.setFeedURL.mock.calls.slice(feedCallsBeforeCheck)).not.toContainEqual([
      { provider: 'generic', url: MOVING_LATEST_FEED_URL }
    ])
    expect(sendMock).not.toHaveBeenCalledWith(
      'updater:status',
      expect.objectContaining({ state: 'error' })
    )
  })

  // Requiring the default channel meant every prerelease user got the transport
  // message for a condition that has nothing to do with transport.
  it.each([
    { channel: 'prerelease', version: '1.3.19-rc.6' },
    { channel: 'default', version: '1.4.141' }
  ])('explains a not-ready release by reason on the $channel channel', async ({ version }) => {
    appMock.getVersion.mockReturnValue(version)
    fetchNewerReleaseTagsMock.mockResolvedValue({ tags: [], state: 'not-ready', lastGoodTag: null })
    const warnMock = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sendMock = vi.fn()
    const mainWindow = { webContents: { send: sendMock } }

    const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()

    setupAutoUpdater(mainWindow as never, { getLastUpdateCheckAt: () => Date.now() })
    checkForUpdatesFromMenu()

    await vi.waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('updater:status', {
        state: 'error',
        message: RELEASE_NOT_READY_MESSAGE,
        userInitiated: true
      })
    })
    expect(sendMock).not.toHaveBeenCalledWith(
      'updater:status',
      expect.objectContaining({ message: TRANSPORT_MESSAGE })
    )
    warnMock.mockRestore()
  })
})
