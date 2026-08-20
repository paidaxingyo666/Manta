import { describe, expect, it } from 'vitest'
import { workspaceSortOptions } from './workspace-list-picker-options'

describe('WORKSPACE_SORT_OPTIONS', () => {
  it('keeps the persisted sort values stable for desktop compatibility', () => {
    expect(workspaceSortOptions().map((option) => option.value)).toEqual([
      'smart',
      'name',
      'recent',
      'repo',
      'manual'
    ])
  })

  it('keeps the smart sort value while showing the agent activity label', () => {
    expect(workspaceSortOptions().find((option) => option.value === 'smart')).toEqual({
      value: 'smart',
      label: 'Agent activity',
      subtitle: 'Agents that need attention, then recent activity'
    })
  })
})
