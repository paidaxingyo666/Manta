// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jiraSearchUsers } from '@/runtime/runtime-jira-client'
import { JiraUserPicker } from './jira-user-picker'

vi.mock('@/runtime/runtime-jira-client', () => ({ jiraSearchUsers: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('JiraUserPicker', () => {
  it('searches and selects users through the command list', async () => {
    vi.useFakeTimers()
    vi.mocked(jiraSearchUsers).mockResolvedValue([
      { accountId: 'ada-1', displayName: 'Ada Lovelace' }
    ])
    const onSelect = vi.fn()

    render(
      <JiraUserPicker
        providerSettings={null}
        value=""
        selectedUser={null}
        onSelect={onSelect}
        label="Reporter"
      />
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Reporter' }))
    fireEvent.change(screen.getByPlaceholderText('Search users'), { target: { value: 'Ada' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(jiraSearchUsers).toHaveBeenCalledWith(null, 'Ada', undefined)
    fireEvent.click(screen.getByText('Ada Lovelace'))
    expect(onSelect).toHaveBeenCalledWith({ accountId: 'ada-1', displayName: 'Ada Lovelace' })
  })
})
