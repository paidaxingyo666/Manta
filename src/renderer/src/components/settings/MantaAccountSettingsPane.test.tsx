// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  fetchAuthStatus: vi.fn(),
  signOut: vi.fn(),
  fetchRelayHosts: vi.fn(),
  forgetRelayHost: vi.fn(),
  fetchSignInMethods: vi.fn(),
  state: {
    mantaProfileAuthStatus: {
      configured: true,
      state: 'connected',
      cloud: { displayName: 'Ada Lovelace', email: 'ada@example.com' }
    } as Record<string, unknown> | null,
    mantaProfileConnecting: false,
    mantaRelayHosts: [] as Record<string, unknown>[],
    mantaRelayHostsLoading: false,
    mantaRelayHostsState: 'ok' as string | null,
    mantaRelaySignInMethods: { accounts: 'per-user', enrollmentSecretRequired: true } as {
      accounts: string
      enrollmentSecretRequired: boolean
    } | null
  }
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    options
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options[name] ?? ''))
      : fallback
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      ...mocks.state,
      connectCurrentMantaProfile: mocks.connect,
      fetchMantaProfileAuthStatus: mocks.fetchAuthStatus,
      signOutCurrentMantaProfile: mocks.signOut,
      fetchMantaRelayHosts: mocks.fetchRelayHosts,
      forgetMantaRelayHost: mocks.forgetRelayHost,
      fetchMantaRelaySignInMethods: mocks.fetchSignInMethods
    })
}))

vi.mock('../manta-profiles/MantaProfileSignOutConfirmDialog', () => ({
  MantaProfileSignOutConfirmDialog: ({
    open,
    onConfirm
  }: {
    open: boolean
    onConfirm: () => void
    children?: ReactNode
  }) => (open ? <button onClick={onConfirm}>Confirm sign out</button> : null)
}))

import { MantaAccountSettingsPane } from './MantaAccountSettingsPane'

describe('MantaAccountSettingsPane', () => {
  beforeEach(() => {
    for (const mock of [
      mocks.connect,
      mocks.fetchAuthStatus,
      mocks.signOut,
      mocks.fetchRelayHosts,
      mocks.forgetRelayHost,
      mocks.fetchSignInMethods
    ]) {
      mock.mockReset()
    }
    mocks.signOut.mockResolvedValue({ status: 'signed-out' })
    mocks.connect.mockResolvedValue({ status: 'connected' })
    mocks.state.mantaProfileAuthStatus = {
      configured: true,
      state: 'connected',
      cloud: { displayName: 'Ada Lovelace', email: 'ada@example.com' }
    }
    mocks.state.mantaProfileConnecting = false
    mocks.state.mantaRelayHosts = []
    mocks.state.mantaRelayHostsState = 'ok'
    mocks.state.mantaRelaySignInMethods = { accounts: 'per-user', enrollmentSecretRequired: true }
  })

  afterEach(cleanup)

  it('shows the connected identity and confirms sign out', async () => {
    const user = userEvent.setup()
    render(<MantaAccountSettingsPane />)

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(screen.getByText('Artifact sharing')).toBeInTheDocument()
    expect(screen.getByText('Manta Relay')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await user.click(screen.getByRole('button', { name: 'Confirm sign out' }))
    expect(mocks.signOut).toHaveBeenCalledOnce()
  })

  it('lists the machines on the account once connected', () => {
    mocks.state.mantaRelayHosts = [
      { relayHostId: 'aaaaaaaaaaaaaaaa', displayName: 'Studio', online: true, isThisMachine: true },
      {
        relayHostId: 'bbbbbbbbbbbbbbbb',
        displayName: 'Laptop',
        online: false,
        isThisMachine: false
      }
    ]
    render(<MantaAccountSettingsPane />)

    expect(screen.getByText('Studio')).toBeInTheDocument()
    expect(screen.getByText('Laptop')).toBeInTheDocument()
    expect(screen.getByText('This machine')).toBeInTheDocument()
  })

  it('signs in with an email and password against the configured relay', async () => {
    const user = userEvent.setup()
    mocks.state.mantaProfileAuthStatus = { configured: true, state: 'local' }
    render(<MantaAccountSettingsPane />)

    expect(
      screen.getByText(
        'Sign in to extend Manta with cloud features, including Artifacts and Manta Relay.'
      )
    ).toBeInTheDocument()
    // Nothing typed yet: submitting an empty form would post a blank password.
    expect(screen.getByRole('button', { name: 'Sign in to Manta' })).toBeDisabled()

    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: 'Sign in to Manta' }))

    expect(mocks.connect).toHaveBeenCalledWith({
      credentials: { email: 'ada@example.com', password: 'correct-horse', mode: 'sign-in' }
    })
  })

  it('offers a plain sign-in and no form on a shared relay', async () => {
    // The relay decides: there are no per-person credentials to ask for, so a
    // password form would ask for something that does not exist.
    const user = userEvent.setup()
    mocks.state.mantaProfileAuthStatus = { configured: true, state: 'local' }
    mocks.state.mantaRelaySignInMethods = { accounts: 'shared', enrollmentSecretRequired: true }
    render(<MantaAccountSettingsPane />)

    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in to Manta' }))
    expect(mocks.connect).toHaveBeenCalledWith()
  })

  it('hides the machine list on a shared relay', () => {
    // The endpoint is absent by design there, and the section would report that
    // as "this relay is too old to list machines" — which is not true.
    mocks.state.mantaRelaySignInMethods = { accounts: 'shared', enrollmentSecretRequired: true }
    mocks.state.mantaRelayHosts = [
      { relayHostId: 'aaaaaaaaaaaaaaaa', displayName: 'Studio', online: true, isThisMachine: true }
    ]
    render(<MantaAccountSettingsPane />)

    expect(screen.queryByText('Your machines')).not.toBeInTheDocument()
    expect(screen.queryByText('Studio')).not.toBeInTheDocument()
  })

  it('lets a signed-in person switch to another account without signing out', async () => {
    // Hiding the form until you signed out made the shared identity a one-way
    // door: you clicked sign in, became someone else, and had no way back.
    const user = userEvent.setup()
    render(<MantaAccountSettingsPane />)

    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use another account' }))
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('loads account status when it is not hydrated yet', () => {
    mocks.state.mantaProfileAuthStatus = null
    render(<MantaAccountSettingsPane />)

    expect(mocks.fetchAuthStatus).toHaveBeenCalledOnce()
    // No relay is known to be configured yet, so neither way in is offered.
    // Nothing is known about the relay yet, so neither screen is drawn.
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })
})
