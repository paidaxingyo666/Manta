// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store'
import { getDefaultUIState } from '../../../../shared/constants'
import { UnexpectedSignoutCard } from '../UnexpectedSignoutCard'
import type { MantaProfileAuthStatus } from '../../../../shared/manta-profiles'

const status: MantaProfileAuthStatus = {
  activeProfileId: 'profile-1',
  configured: true,
  state: 'reconnect-required',
  persistence: 'none',
  cloud: {
    cloudProfileId: 'cloud-1',
    userId: 'user-1',
    email: 'user@example.com',
    displayName: 'User',
    linkedAt: 0
  }
}
const persist = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.stubEnv('DEV', false)
  persist.mockClear()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ui: { set: persist },
      updater: { getVersion: vi.fn().mockResolvedValue('1.4.197') }
    }
  })
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({
    mantaProfileAuthStatus: status,
    persistedUIReady: true,
    fetchMantaProfileAuthStatus: vi.fn().mockResolvedValue(status)
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

async function showCard(): Promise<void> {
  render(<UnexpectedSignoutCard />)
  await screen.findByRole('complementary')
}

describe('unexpected signout lifecycle', () => {
  it('records first display and stays hidden after restart and update without X', async () => {
    await showCard()
    expect(persist).toHaveBeenCalledExactlyOnceWith({
      dismissedUnexpectedSignoutVersion: '1.4.197'
    })
    expect(screen.queryByRole('complementary')).not.toBeNull()
    cleanup()
    useAppStore.setState(useAppStore.getInitialState(), true)
    useAppStore.setState({
      mantaProfileAuthStatus: status,
      persistedUIReady: true,
      dismissedUnexpectedSignoutVersion: '1.4.197',
      fetchMantaProfileAuthStatus: vi.fn().mockResolvedValue(status)
    })
    vi.mocked(window.api.updater.getVersion).mockResolvedValue('1.4.999')
    render(<UnexpectedSignoutCard />)
    await act(async () => {})
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('stamps successful sign-in and never re-arms in the same version', async () => {
    await showCard()
    act(() => useAppStore.setState({ mantaProfileAuthStatus: { ...status, state: 'connected' } }))
    await waitFor(() =>
      expect(persist).toHaveBeenCalledWith({ dismissedUnexpectedSignoutVersion: '1.4.197' })
    )
    act(() => useAppStore.setState({ mantaProfileAuthStatus: status }))
    expect(screen.queryByRole('complementary')).toBeNull()
    cleanup()
    render(<UnexpectedSignoutCard />)
    await act(async () => {})
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('records nothing for connected users until the card actually appears', async () => {
    useAppStore.setState({ mantaProfileAuthStatus: { ...status, state: 'connected' } })
    render(<UnexpectedSignoutCard />)
    await act(async () => {})
    expect(persist).not.toHaveBeenCalled()
    act(() => useAppStore.setState({ mantaProfileAuthStatus: status }))
    expect(screen.queryByRole('complementary')).not.toBeNull()
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('does not consume the notice if auth recovers before hydration finishes', async () => {
    useAppStore.setState({ persistedUIReady: false })
    render(<UnexpectedSignoutCard />)
    await act(async () => {})
    act(() => useAppStore.setState({ mantaProfileAuthStatus: { ...status, state: 'connected' } }))
    act(() => useAppStore.setState({ persistedUIReady: true }))
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(persist).not.toHaveBeenCalled()
  })

  it('keeps a failed sign-in available without recording another appearance', async () => {
    useAppStore.setState({ connectCurrentMantaProfile: vi.fn().mockResolvedValue(undefined) })
    await showCard()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Manta' }))
    await act(async () => {})
    expect(screen.queryByRole('complementary')).not.toBeNull()
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('never shows or consumes a stale card while the auth read is pending', async () => {
    let finish!: (value: typeof status) => void
    useAppStore.setState({
      fetchMantaProfileAuthStatus: vi.fn(
        () =>
          new Promise<MantaProfileAuthStatus>((resolve) => {
            finish = resolve
          })
      )
    })
    render(<UnexpectedSignoutCard />)
    await act(async () => {})
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(persist).not.toHaveBeenCalled()
    await act(async () => {
      const connected = { ...status, state: 'connected' as const }
      useAppStore.setState({ mantaProfileAuthStatus: connected })
      finish(connected)
    })
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(persist).not.toHaveBeenCalled()
  })

  it('retains a reopened dismissal through stale UI sync and a renderer remount', async () => {
    useAppStore.getState().hydratePersistedUI(
      {
        ...getDefaultUIState(),
        dismissedUnexpectedSignoutVersion: '1.4.197'
      },
      'startup'
    )
    render(<UnexpectedSignoutCard />)
    await act(async () => {})
    act(() => useAppStore.getState().hydratePersistedUI(getDefaultUIState()))
    expect(screen.queryByRole('complementary')).toBeNull()
    cleanup()
    render(<UnexpectedSignoutCard />)
    await act(async () => {})
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(persist).not.toHaveBeenCalledWith(
      expect.objectContaining({ dismissedUnexpectedSignoutVersion: expect.anything() })
    )
  })

  it('persists X dismissal and stays hidden after remount', async () => {
    await showCard()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(persist).toHaveBeenCalledWith({ dismissedUnexpectedSignoutVersion: '1.4.197' })
    cleanup()
    render(<UnexpectedSignoutCard />)
    await act(async () => {})
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it.each(['storage', 'query'])('ignores the %s preview flag in production', async (source) => {
    if (source === 'storage') {
      window.localStorage.setItem('orca-debug-show-signout-card', '1')
    } else {
      window.history.replaceState({}, '', '/?showSignoutCard=1')
    }
    useAppStore.setState({ mantaProfileAuthStatus: { ...status, state: 'local', cloud: undefined } })
    render(<UnexpectedSignoutCard />)
    await act(async () => {})
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(persist).not.toHaveBeenCalled()
  })

  it('dismisses a development preview without writing real dismissal state', async () => {
    vi.stubEnv('DEV', true)
    window.localStorage.setItem('orca-debug-show-signout-card', '1')
    useAppStore.setState({ mantaProfileAuthStatus: { ...status, state: 'local', cloud: undefined } })
    await showCard()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(persist).not.toHaveBeenCalled()
  })
})
