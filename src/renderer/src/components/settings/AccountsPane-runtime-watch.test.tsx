// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { useAppStore } from '../../store'
import type * as RuntimeProviderAccountsClient from '@/runtime/runtime-provider-accounts-client'

const accountWatch = vi.hoisted(() => ({
  close: vi.fn(),
  watch: vi.fn(() => ({ close: accountWatch.close }))
}))

vi.mock('@/runtime/runtime-provider-accounts-client', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeProviderAccountsClient>()),
  watchProviderAccounts: accountWatch.watch
}))

import { AccountsPane } from './AccountsPane'

describe('AccountsPane runtime account watch', () => {
  beforeEach(() => {
    accountWatch.close.mockReset()
    accountWatch.watch.mockClear()
    useAppStore.setState({
      runtimeEnvironments: [],
      runtimeStatusByEnvironmentId: new Map([
        ['env-1', { status: null, checkedAt: 1, connectionGeneration: 1 }]
      ])
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        minimaxCredentials: { getStatus: vi.fn().mockResolvedValue({ configured: false }) }
      }
    })
  })

  afterEach(() => cleanup())

  it('replaces the account subscription when the runtime connection generation advances', async () => {
    const settings = { ...getDefaultSettings('/tmp'), activeRuntimeEnvironmentId: 'env-1' }
    render(<AccountsPane settings={settings} updateSettings={vi.fn()} />)
    expect(accountWatch.watch).toHaveBeenCalledTimes(1)

    await act(async () => {
      useAppStore.setState({
        runtimeStatusByEnvironmentId: new Map([
          ['env-1', { status: null, checkedAt: 2, connectionGeneration: 2 }]
        ])
      })
    })

    expect(accountWatch.close).toHaveBeenCalledTimes(1)
    expect(accountWatch.watch).toHaveBeenCalledTimes(2)
  })
})
