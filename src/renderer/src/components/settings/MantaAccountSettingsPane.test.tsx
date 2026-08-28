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
  state: {
    mantaProfileAuthStatus: {
      configured: true,
      state: 'connected',
      cloud: { displayName: 'Ada Lovelace', email: 'ada@example.com' }
    } as Record<string, unknown> | null,
    mantaProfileConnecting: false
  }
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      ...mocks.state,
      connectCurrentMantaProfile: mocks.connect,
      fetchMantaProfileAuthStatus: mocks.fetchAuthStatus,
      signOutCurrentMantaProfile: mocks.signOut
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
    mocks.connect.mockReset()
    mocks.fetchAuthStatus.mockReset()
    mocks.signOut.mockReset()
    mocks.signOut.mockResolvedValue({ status: 'signed-out' })
    mocks.state.mantaProfileAuthStatus = {
      configured: true,
      state: 'connected',
      cloud: { displayName: 'Ada Lovelace', email: 'ada@example.com' }
    }
    mocks.state.mantaProfileConnecting = false
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

  it('offers sign in for a local profile', async () => {
    const user = userEvent.setup()
    mocks.state.mantaProfileAuthStatus = { configured: true, state: 'local' }
    render(<MantaAccountSettingsPane />)

    expect(
      screen.getByText(
        'Sign in to extend Manta with cloud features, including Artifacts and Manta Relay.'
      )
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in to Manta' }))
    expect(mocks.connect).toHaveBeenCalledOnce()
  })

  it('loads account status when it is not hydrated yet', () => {
    mocks.state.mantaProfileAuthStatus = null
    render(<MantaAccountSettingsPane />)

    expect(mocks.fetchAuthStatus).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Sign in to Manta' })).toBeDisabled()
  })
})
