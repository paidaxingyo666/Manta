// @vitest-environment happy-dom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { CliInstallStatus } from '../../../../shared/cli-install-types'
import { CliSection } from './CliSection'

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
const dialog = vi.hoisted(() => ({
  props: null as null | { onInstall: () => Promise<void>; open: boolean }
}))

vi.mock('sonner', () => ({ toast: toasts }))

vi.mock('@/hooks/useInstalledAgentSkills', () => ({
  GLOBAL_AGENT_SKILL_SOURCE_KINDS: ['global'],
  useInstalledAgentSkill: () => ({
    installed: false,
    loading: false,
    error: null,
    refresh: vi.fn()
  })
}))

vi.mock('@/hooks/useActiveProjectSkillRuntime', () => ({
  useActiveProjectSkillRuntime: () => ({ canUseLocalSkillFreshness: true })
}))

vi.mock('./AgentSkillSetupPanel', () => ({
  AgentSkillSetupPanel: () => <div data-testid="agent-skill-setup-panel" />
}))

vi.mock('./WslCliRegistration', () => ({ WslCliRegistration: () => null }))

vi.mock('./CliRegistrationDialog', () => ({
  CliRegistrationDialog: function CliRegistrationDialog(props: {
    onInstall: () => Promise<void>
    open: boolean
  }) {
    dialog.props = props
    return null
  }
}))

function notInstalledStatus(overrides: Partial<CliInstallStatus> = {}): CliInstallStatus {
  return {
    platform: 'darwin',
    commandName: 'manta',
    commandPath: '/usr/local/bin/manta',
    pathDirectory: '/usr/local/bin',
    pathConfigured: true,
    launcherPath: '/Applications/Manta.app/Contents/Resources/bin/manta',
    installMethod: 'symlink',
    supported: true,
    state: 'not_installed',
    currentTarget: null,
    unsupportedReason: null,
    detail: 'Register /usr/local/bin/manta to use Manta from the terminal.',
    ...overrides
  }
}

async function renderCliSectionAndInstall(install: () => Promise<CliInstallStatus>): Promise<void> {
  Object.assign(window, {
    api: {
      cli: {
        getInstallStatus: vi.fn().mockResolvedValue(notInstalledStatus()),
        getWslInstallStatus: vi.fn(),
        install: vi.fn(install),
        remove: vi.fn()
      },
      shell: { openPath: vi.fn() }
    }
  })

  render(<CliSection currentPlatform="darwin" settings={getDefaultSettings('/tmp')} />)
  await screen.findByRole('switch')
  await act(async () => {
    await dialog.props?.onInstall()
  })
}

afterEach(() => {
  cleanup()
  dialog.props = null
  toasts.error.mockReset()
  toasts.success.mockReset()
})

describe('CliSection install failure surfacing', () => {
  it('shows the thrown conflict reason and its remedy instead of a success toast', async () => {
    await renderCliSectionAndInstall(async () => {
      throw new Error(
        "Error invoking remote method 'cli:install': Error: Refusing to replace non-Manta " +
          'command at /usr/local/bin/manta. Remove it and register again if it is no longer needed.'
      )
    })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Failed to register `manta` in PATH.')
    expect(alert.textContent).toContain(
      'Refusing to replace non-Manta command at /usr/local/bin/manta.'
    )
    expect(alert.textContent).toContain('Remove it and register again if it is no longer needed.')
    // The Electron transport wrapper must not leak into the panel.
    expect(alert.textContent).not.toContain('invoking remote method')
    expect(toasts.success).not.toHaveBeenCalled()
    expect(toasts.error).toHaveBeenCalledTimes(1)
  })

  it('names the path and the remedy when install resolves with a conflict', async () => {
    await renderCliSectionAndInstall(async () =>
      notInstalledStatus({
        state: 'conflict',
        detail: '/usr/local/bin/manta exists but is not a Manta symlink.'
      })
    )

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('/usr/local/bin/manta exists but is not a Manta symlink.')
    expect(alert.textContent).toContain(
      'Remove /usr/local/bin/manta and register again if it is no longer needed.'
    )
    expect(toasts.success).not.toHaveBeenCalled()
  })

  it('does not claim success when install resolves without registering', async () => {
    await renderCliSectionAndInstall(async () =>
      notInstalledStatus({
        state: 'unsupported',
        supported: false,
        unsupportedReason: 'launcher_missing',
        detail: 'The bundled CLI launcher is missing from this Manta build.'
      })
    )

    expect(screen.getByRole('alert').textContent).toContain(
      'The bundled CLI launcher is missing from this Manta build.'
    )
    expect(toasts.success).not.toHaveBeenCalled()
    expect(toasts.error).toHaveBeenCalledTimes(1)
  })

  it('keeps the success toast and shows no failure notice when registration lands', async () => {
    await renderCliSectionAndInstall(async () =>
      notInstalledStatus({ state: 'installed', detail: null })
    )

    expect(screen.queryByRole('alert')).toBeNull()
    expect(toasts.success).toHaveBeenCalledTimes(1)
    expect(toasts.error).not.toHaveBeenCalled()
  })
})
